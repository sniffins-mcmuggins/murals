package festival

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

// ─── response types ───────────────────────────────────────────────────────────

type spotResponse struct {
	ID         string   `json:"id"`
	Number     int32    `json:"number"`
	Lat        float64  `json:"lat"`
	Lng        float64  `json:"lng"`
	W3W        *string  `json:"w3w"`
	WidthM     *float64 `json:"width_m"`
	HeightM    *float64 `json:"height_m"`
	Notes      *string  `json:"notes"`
	ArtistID   *string  `json:"artist_id"`
	ArtistName *string  `json:"artist_name"`
}

type unassignedArtistResponse struct {
	ArtistID string `json:"artist_id"`
	Name     string `json:"name"`
}

type getSpotsResponse struct {
	Spots             []spotResponse             `json:"spots"`
	UnassignedArtists []unassignedArtistResponse `json:"unassigned_artists"`
}

// ─── numeric helpers ──────────────────────────────────────────────────────────

func numericFromFloat(f float64) (pgtype.Numeric, error) {
	var n pgtype.Numeric
	return n, n.Scan(strconv.FormatFloat(f, 'f', -1, 64))
}

// optFloatToNumeric converts *float64 to pgtype.Numeric.
// Returns a zero (invalid) Numeric when f is nil (NULL in DB).
func optFloatToNumeric(f *float64) pgtype.Numeric {
	if f == nil {
		return pgtype.Numeric{}
	}
	var n pgtype.Numeric
	if err := n.Scan(strconv.FormatFloat(*f, 'f', -1, 64)); err != nil {
		return pgtype.Numeric{}
	}
	return n
}

func numericToFloat64(n pgtype.Numeric) float64 {
	v, _ := n.Float64Value()
	return v.Float64
}

func optNumericToFloat64(n pgtype.Numeric) *float64 {
	if !n.Valid {
		return nil
	}
	v, err := n.Float64Value()
	if err != nil || !v.Valid {
		return nil
	}
	return &v.Float64
}

func optUUIDToStringPtr(u pgtype.UUID) *string {
	if !u.Valid {
		return nil
	}
	s := u.String()
	return &s
}

// ─── response builders ────────────────────────────────────────────────────────

func toSpotResponse(row sqlcdb.GetFestivalSpotRow) spotResponse {
	return spotResponse{
		ID:         row.ID.String(),
		Number:     row.Number,
		Lat:        numericToFloat64(row.Lat),
		Lng:        numericToFloat64(row.Lng),
		W3W:        row.W3w,
		WidthM:     optNumericToFloat64(row.WidthM),
		HeightM:    optNumericToFloat64(row.HeightM),
		Notes:      row.Notes,
		ArtistID:   optUUIDToStringPtr(row.ArtistID),
		ArtistName: row.ArtistName,
	}
}

func toSpotResponseFromListRow(row sqlcdb.GetFestivalSpotsRow) spotResponse {
	return spotResponse{
		ID:         row.ID.String(),
		Number:     row.Number,
		Lat:        numericToFloat64(row.Lat),
		Lng:        numericToFloat64(row.Lng),
		W3W:        row.W3w,
		WidthM:     optNumericToFloat64(row.WidthM),
		HeightM:    optNumericToFloat64(row.HeightM),
		Notes:      row.Notes,
		ArtistID:   optUUIDToStringPtr(row.ArtistID),
		ArtistName: row.ArtistName,
	}
}

// ─── shared auth + ownership guard ───────────────────────────────────────────

func requireFestivalOwner(r *http.Request, w http.ResponseWriter, q *sqlcdb.Queries, festivalID string) (pgtype.UUID, bool) {
	principal, err := auth.User(r.Context())
	if err != nil {
		httperr.Unauthorized(w)
		return pgtype.UUID{}, false
	}
	festUUID, err := pgUUIDFromString(festivalID)
	if err != nil {
		httperr.BadRequest(w, "invalid festivalID")
		return pgtype.UUID{}, false
	}
	fest, err := q.GetFestivalByID(r.Context(), festUUID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httperr.NotFound(w)
		} else {
			httperr.InternalServerError(w)
		}
		return pgtype.UUID{}, false
	}
	if fest.OrganiserID.String() != principal.UserID {
		httperr.Forbidden(w)
		return pgtype.UUID{}, false
	}
	return festUUID, true
}

// ─── handlers ────────────────────────────────────────────────────────────────

// GetSpotsHandler handles GET /festivals/{festivalID}/spots.
func GetSpotsHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := sqlcdb.New(pool)
		festUUID, ok := requireFestivalOwner(r, w, q, chi.URLParam(r, "festivalID"))
		if !ok {
			return
		}
		spots, err := q.GetFestivalSpots(r.Context(), festUUID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}
		artists, err := q.GetUnassignedSpotEligibleArtists(r.Context(), festUUID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}
		spotResps := make([]spotResponse, len(spots))
		for i, s := range spots {
			spotResps[i] = toSpotResponseFromListRow(s)
		}
		artistResps := make([]unassignedArtistResponse, len(artists))
		for i, a := range artists {
			artistResps[i] = unassignedArtistResponse{ArtistID: a.ArtistID.String(), Name: a.Name}
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(getSpotsResponse{
			Spots:             spotResps,
			UnassignedArtists: artistResps,
		})
	}
}

// CreateSpotHandler handles POST /festivals/{festivalID}/spots.
func CreateSpotHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := sqlcdb.New(pool)
		festUUID, ok := requireFestivalOwner(r, w, q, chi.URLParam(r, "festivalID"))
		if !ok {
			return
		}
		var req struct {
			Lat     float64  `json:"lat"`
			Lng     float64  `json:"lng"`
			W3W     *string  `json:"w3w"`
			WidthM  *float64 `json:"width_m"`
			HeightM *float64 `json:"height_m"`
			Notes   *string  `json:"notes"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.BadRequest(w, "invalid request body")
			return
		}
		if req.Lat < -90 || req.Lat > 90 {
			httperr.BadRequest(w, "lat must be between -90 and 90")
			return
		}
		if req.Lng < -180 || req.Lng > 180 {
			httperr.BadRequest(w, "lng must be between -180 and 180")
			return
		}
		lat, err := numericFromFloat(req.Lat)
		if err != nil {
			httperr.BadRequest(w, "invalid lat")
			return
		}
		lng, err := numericFromFloat(req.Lng)
		if err != nil {
			httperr.BadRequest(w, "invalid lng")
			return
		}
		spot, err := q.CreateFestivalSpot(r.Context(), sqlcdb.CreateFestivalSpotParams{
			FestivalID: festUUID,
			Lat:        lat,
			Lng:        lng,
			W3w:        req.W3W,
			WidthM:     optFloatToNumeric(req.WidthM),
			HeightM:    optFloatToNumeric(req.HeightM),
			Notes:      req.Notes,
		})
		if err != nil {
			if isUniqueViolation(err) {
				httperr.Write(w, http.StatusConflict, "Conflict", "spot number conflict — please try again")
				return
			}
			httperr.InternalServerError(w)
			return
		}
		full, err := q.GetFestivalSpot(r.Context(), sqlcdb.GetFestivalSpotParams{
			ID: spot.ID, FestivalID: festUUID,
		})
		if err != nil {
			httperr.InternalServerError(w)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(toSpotResponse(full))
	}
}

// UpdateSpotHandler handles PATCH /festivals/{festivalID}/spots/{spotID}.
func UpdateSpotHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := sqlcdb.New(pool)
		festUUID, ok := requireFestivalOwner(r, w, q, chi.URLParam(r, "festivalID"))
		if !ok {
			return
		}
		spotUUID, err := pgUUIDFromString(chi.URLParam(r, "spotID"))
		if err != nil {
			httperr.BadRequest(w, "invalid spotID")
			return
		}
		var req struct {
			Lat     *float64 `json:"lat"`
			Lng     *float64 `json:"lng"`
			W3W     *string  `json:"w3w"`
			WidthM  *float64 `json:"width_m"`
			HeightM *float64 `json:"height_m"`
			Notes   *string  `json:"notes"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.BadRequest(w, "invalid request body")
			return
		}
		if req.Lat == nil || req.Lng == nil {
			httperr.BadRequest(w, "lat and lng are required")
			return
		}
		if *req.Lat < -90 || *req.Lat > 90 {
			httperr.BadRequest(w, "lat must be between -90 and 90")
			return
		}
		if *req.Lng < -180 || *req.Lng > 180 {
			httperr.BadRequest(w, "lng must be between -180 and 180")
			return
		}
		lat, err := numericFromFloat(*req.Lat)
		if err != nil {
			httperr.BadRequest(w, "invalid lat")
			return
		}
		lng, err := numericFromFloat(*req.Lng)
		if err != nil {
			httperr.BadRequest(w, "invalid lng")
			return
		}
		if _, err = q.UpdateFestivalSpot(r.Context(), sqlcdb.UpdateFestivalSpotParams{
			ID: spotUUID, FestivalID: festUUID,
			Lat: lat, Lng: lng, W3w: req.W3W,
			WidthM:  optFloatToNumeric(req.WidthM),
			HeightM: optFloatToNumeric(req.HeightM),
			Notes:   req.Notes,
		}); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}
		full, err := q.GetFestivalSpot(r.Context(), sqlcdb.GetFestivalSpotParams{
			ID: spotUUID, FestivalID: festUUID,
		})
		if err != nil {
			httperr.InternalServerError(w)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(toSpotResponse(full))
	}
}

// DeleteSpotHandler handles DELETE /festivals/{festivalID}/spots/{spotID}.
func DeleteSpotHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := sqlcdb.New(pool)
		festUUID, ok := requireFestivalOwner(r, w, q, chi.URLParam(r, "festivalID"))
		if !ok {
			return
		}
		spotUUID, err := pgUUIDFromString(chi.URLParam(r, "spotID"))
		if err != nil {
			httperr.BadRequest(w, "invalid spotID")
			return
		}
		if err := q.DeleteFestivalSpot(r.Context(), sqlcdb.DeleteFestivalSpotParams{
			ID: spotUUID, FestivalID: festUUID,
		}); err != nil {
			httperr.InternalServerError(w)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// SetSpotArtistHandler handles PUT /festivals/{festivalID}/spots/{spotID}/artist.
func SetSpotArtistHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := sqlcdb.New(pool)
		festUUID, ok := requireFestivalOwner(r, w, q, chi.URLParam(r, "festivalID"))
		if !ok {
			return
		}
		spotUUID, err := pgUUIDFromString(chi.URLParam(r, "spotID"))
		if err != nil {
			httperr.BadRequest(w, "invalid spotID")
			return
		}
		var req struct {
			ArtistID string `json:"artist_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.BadRequest(w, "invalid request body")
			return
		}
		artistUUID, err := pgUUIDFromString(req.ArtistID)
		if err != nil {
			httperr.BadRequest(w, "invalid artist_id")
			return
		}
		// Verify the artist is spot-eligible (released accept OR provisional accept).
		if _, err = q.GetSpotEligibleArtist(r.Context(), sqlcdb.GetSpotEligibleArtistParams{
			FestivalID: festUUID, Column2: artistUUID,
		}); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.UnprocessableEntity(w, "artist is not eligible to be placed for this festival")
				return
			}
			httperr.InternalServerError(w)
			return
		}
		if _, err = q.SetFestivalSpotArtist(r.Context(), sqlcdb.SetFestivalSpotArtistParams{
			ID: spotUUID, FestivalID: festUUID, ArtistID: artistUUID,
		}); err != nil {
			if isUniqueViolation(err) {
				httperr.Write(w, http.StatusConflict, "Conflict", "artist already assigned to another spot")
				return
			}
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}
		full, err := q.GetFestivalSpot(r.Context(), sqlcdb.GetFestivalSpotParams{
			ID: spotUUID, FestivalID: festUUID,
		})
		if err != nil {
			httperr.InternalServerError(w)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(toSpotResponse(full))
	}
}

// ClearSpotArtistHandler handles DELETE /festivals/{festivalID}/spots/{spotID}/artist.
func ClearSpotArtistHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := sqlcdb.New(pool)
		festUUID, ok := requireFestivalOwner(r, w, q, chi.URLParam(r, "festivalID"))
		if !ok {
			return
		}
		spotUUID, err := pgUUIDFromString(chi.URLParam(r, "spotID"))
		if err != nil {
			httperr.BadRequest(w, "invalid spotID")
			return
		}
		if _, err = q.ClearFestivalSpotArtist(r.Context(), sqlcdb.ClearFestivalSpotArtistParams{
			ID: spotUUID, FestivalID: festUUID,
		}); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}
		full, err := q.GetFestivalSpot(r.Context(), sqlcdb.GetFestivalSpotParams{
			ID: spotUUID, FestivalID: festUUID,
		})
		if err != nil {
			httperr.InternalServerError(w)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(toSpotResponse(full))
	}
}
