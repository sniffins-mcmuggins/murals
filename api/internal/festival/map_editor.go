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

type acceptedArtistResponse struct {
	ArtistID string   `json:"artist_id"`
	Name     string   `json:"name"`
	PinLat   *float64 `json:"pin_lat"`
	PinLng   *float64 `json:"pin_lng"`
	W3W      *string  `json:"w3w"`
}

func toAcceptedArtistResponse(row sqlcdb.GetAcceptedArtistsForFestivalRow) acceptedArtistResponse {
	resp := acceptedArtistResponse{
		ArtistID: row.ArtistID.String(),
		Name:     row.DisplayName,
		W3W:      row.W3w,
	}
	if row.PinLat.Valid {
		latVal, err := row.PinLat.Float64Value()
		if err == nil && latVal.Valid {
			resp.PinLat = &latVal.Float64
		}
	}
	if row.PinLng.Valid {
		lngVal, err := row.PinLng.Float64Value()
		if err == nil && lngVal.Valid {
			resp.PinLng = &lngVal.Float64
		}
	}
	return resp
}

// GetAcceptedArtistsHandler handles GET /festivals/{festivalID}/artists/accepted.
// Requires auth + organiser role. Returns all accepted artists for the map editor sidebar.
func GetAcceptedArtistsHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, err := auth.User(r.Context())
		if err != nil {
			httperr.Unauthorized(w)
			return
		}
		if principal.Role != "organiser" {
			httperr.Forbidden(w)
			return
		}

		festUUID, err := pgUUIDFromString(chi.URLParam(r, "festivalID"))
		if err != nil {
			httperr.BadRequest(w, "invalid festivalID")
			return
		}

		q := sqlcdb.New(pool)
		fest, err := q.GetFestivalByID(r.Context(), festUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}
		if fest.OrganiserID.String() != principal.UserID {
			httperr.Forbidden(w)
			return
		}

		rows, err := q.GetAcceptedArtistsForFestival(r.Context(), festUUID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		resp := make([]acceptedArtistResponse, len(rows))
		for i, row := range rows {
			resp[i] = toAcceptedArtistResponse(row)
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}
}

// SetArtistPinHandler handles PATCH /festivals/{festivalID}/artists/{artistID}/pin.
// Requires auth + organiser role. Sets or updates the pin location for an accepted artist.
func SetArtistPinHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, err := auth.User(r.Context())
		if err != nil {
			httperr.Unauthorized(w)
			return
		}
		if principal.Role != "organiser" {
			httperr.Forbidden(w)
			return
		}

		festUUID, err := pgUUIDFromString(chi.URLParam(r, "festivalID"))
		if err != nil {
			httperr.BadRequest(w, "invalid festivalID")
			return
		}
		artistUUID, err := pgUUIDFromString(chi.URLParam(r, "artistID"))
		if err != nil {
			httperr.BadRequest(w, "invalid artistID")
			return
		}

		q := sqlcdb.New(pool)
		fest, err := q.GetFestivalByID(r.Context(), festUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}
		if fest.OrganiserID.String() != principal.UserID {
			httperr.Forbidden(w)
			return
		}

		// Verify artist is accepted for this festival; returns display_name for the response.
		accepted, err := q.GetAcceptedArtistForFestival(r.Context(), sqlcdb.GetAcceptedArtistForFestivalParams{
			FestivalID: festUUID,
			ArtistID:   artistUUID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}
		displayName := accepted.DisplayName

		var req struct {
			Lat float64 `json:"lat"`
			Lng float64 `json:"lng"`
			W3W *string `json:"w3w"`
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

		var pinLat pgtype.Numeric
		if err := pinLat.Scan(strconv.FormatFloat(req.Lat, 'f', -1, 64)); err != nil {
			httperr.BadRequest(w, "invalid lat value")
			return
		}
		var pinLng pgtype.Numeric
		if err := pinLng.Scan(strconv.FormatFloat(req.Lng, 'f', -1, 64)); err != nil {
			httperr.BadRequest(w, "invalid lng value")
			return
		}

		updated, err := q.SetFestivalArtistPin(r.Context(), sqlcdb.SetFestivalArtistPinParams{
			FestivalID: festUUID,
			ArtistID:   artistUUID,
			PinLat:     pinLat,
			PinLng:     pinLng,
			W3w:        req.W3W,
		})
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		// Build response from updated pin values + pre-fetched display_name.
		resp := acceptedArtistResponse{
			ArtistID: updated.ArtistID.String(),
			Name:     displayName,
			W3W:      updated.W3w,
		}
		if updated.PinLat.Valid {
			if latVal, err := updated.PinLat.Float64Value(); err == nil && latVal.Valid {
				resp.PinLat = &latVal.Float64
			}
		}
		if updated.PinLng.Valid {
			if lngVal, err := updated.PinLng.Float64Value(); err == nil && lngVal.Valid {
				resp.PinLng = &lngVal.Float64
			}
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}
}
