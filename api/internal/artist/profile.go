package artist

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

type profileResponse struct {
	ID            string          `json:"id"`
	UserID        string          `json:"user_id"`
	DisplayName   string          `json:"display_name"`
	Bio           string          `json:"bio"`
	LocationLabel *string         `json:"location_label,omitempty"`
	MediumTags    []string        `json:"medium_tags"`
	SocialLinks   json.RawMessage `json:"social_links"`
	AvatarS3Key   *string         `json:"avatar_s3_key,omitempty"`
	CreatedAt     string          `json:"created_at"`
	UpdatedAt     string          `json:"updated_at"`
}

type profileListResponse struct {
	Profiles []profileResponse `json:"profiles"`
	Total    int               `json:"total"`
	Page     int               `json:"page"`
	PerPage  int               `json:"per_page"`
}

func toProfileResponse(p sqlcdb.ArtistProfile, public bool) profileResponse {
	resp := profileResponse{
		ID:          p.ID.String(),
		UserID:      p.UserID.String(),
		DisplayName: p.DisplayName,
		Bio:         p.Bio,
		MediumTags:  p.MediumTags,
		SocialLinks: p.SocialLinks,
		AvatarS3Key: p.AvatarS3Key,
		CreatedAt:   p.CreatedAt.Time.Format(time.RFC3339),
		UpdatedAt:   p.UpdatedAt.Time.Format(time.RFC3339),
	}
	if !public || p.ShowLocation {
		resp.LocationLabel = p.LocationLabel
	}
	return resp
}

// pgUUIDFromString parses a UUID string to pgtype.UUID.
func pgUUIDFromString(s string) (pgtype.UUID, error) {
	parsed, err := uuid.Parse(s)
	if err != nil {
		return pgtype.UUID{}, err
	}
	return pgtype.UUID{Bytes: [16]byte(parsed), Valid: true}, nil
}

// CreateProfileHandler handles POST /profiles. Requires artist role. One profile per user.
func CreateProfileHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, err := auth.User(r.Context())
		if err != nil {
			httperr.Unauthorized(w)
			return
		}

		var req struct {
			DisplayName string `json:"displayName"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.BadRequest(w, "invalid request body")
			return
		}
		if req.DisplayName == "" {
			httperr.UnprocessableEntity(w, "displayName is required")
			return
		}

		userUUID, err := pgUUIDFromString(principal.UserID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		q := sqlcdb.New(pool)
		profile, err := q.CreateArtistProfile(r.Context(), sqlcdb.CreateArtistProfileParams{
			UserID:      userUUID,
			DisplayName: req.DisplayName,
		})
		if err != nil {
			if isUniqueViolation(err) {
				httperr.Write(w, http.StatusConflict, "Conflict", "artist profile already exists for this user")
				return
			}
			httperr.InternalServerError(w)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(toProfileResponse(profile, false))
	}
}

// GetProfileHandler handles GET /profiles/{profileID}. Public — no auth required.
func GetProfileHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		profileUUID, err := pgUUIDFromString(chi.URLParam(r, "profileID"))
		if err != nil {
			httperr.BadRequest(w, "invalid profileID")
			return
		}

		q := sqlcdb.New(pool)
		profile, err := q.GetArtistProfileByID(r.Context(), profileUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(toProfileResponse(profile, true))
	}
}

// GetMyProfileHandler handles GET /profiles/me. Requires auth.
func GetMyProfileHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, err := auth.User(r.Context())
		if err != nil {
			httperr.Unauthorized(w)
			return
		}
		userUUID, err := pgUUIDFromString(principal.UserID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}
		q := sqlcdb.New(pool)
		profile, err := q.GetArtistProfileByUserID(r.Context(), userUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(toProfileResponse(profile, false))
	}
}

// UpdateProfileHandler handles PATCH /profiles/me. Requires auth.
func UpdateProfileHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, err := auth.User(r.Context())
		if err != nil {
			httperr.Unauthorized(w)
			return
		}

		var req struct {
			DisplayName   string          `json:"displayName"`
			Bio           string          `json:"bio"`
			LocationLabel *string         `json:"locationLabel"`
			ShowLocation  *bool           `json:"showLocation"`
			MediumTags    []string        `json:"mediumTags"`
			SocialLinks   json.RawMessage `json:"socialLinks"`
			AvatarS3Key   *string         `json:"avatarS3Key"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.BadRequest(w, "invalid request body")
			return
		}

		userUUID, err := pgUUIDFromString(principal.UserID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		q := sqlcdb.New(pool)
		existing, err := q.GetArtistProfileByUserID(r.Context(), userUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}

		// Merge: use existing values for any field not supplied
		displayName := existing.DisplayName
		if req.DisplayName != "" {
			displayName = req.DisplayName
		}
		bio := existing.Bio
		if req.Bio != "" {
			bio = req.Bio
		}
		mediumTags := existing.MediumTags
		if req.MediumTags != nil {
			mediumTags = req.MediumTags
		}
		socialLinks := existing.SocialLinks
		if len(req.SocialLinks) > 0 {
			socialLinks = req.SocialLinks
		}
		locationLabel := existing.LocationLabel
		if req.LocationLabel != nil {
			locationLabel = req.LocationLabel
		}
		avatarS3Key := existing.AvatarS3Key
		if req.AvatarS3Key != nil {
			avatarS3Key = req.AvatarS3Key
		}
		showLocation := existing.ShowLocation
		if req.ShowLocation != nil {
			showLocation = *req.ShowLocation
		}

		updated, err := q.UpdateArtistProfile(r.Context(), sqlcdb.UpdateArtistProfileParams{
			ID:            existing.ID,
			DisplayName:   displayName,
			Bio:           bio,
			LocationLabel: locationLabel,
			ShowLocation:  showLocation,
			MediumTags:    mediumTags,
			SocialLinks:   socialLinks,
			AvatarS3Key:   avatarS3Key,
		})
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(toProfileResponse(updated, false))
	}
}

// ListPublicProfilesHandler handles GET /public/profiles. No auth required.
// Returns paginated public artist profiles.
func ListPublicProfilesHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		page, perPage := 1, 20
		if p := r.URL.Query().Get("page"); p != "" {
			if n, err := strconv.Atoi(p); err == nil && n > 0 {
				page = n
			}
		}
		if pp := r.URL.Query().Get("per_page"); pp != "" {
			if n, err := strconv.Atoi(pp); err == nil && n > 0 && n <= 100 {
				perPage = n
			}
		}

		q := sqlcdb.New(pool)
		profiles, err := q.ListPublicProfiles(r.Context(), sqlcdb.ListPublicProfilesParams{
			Limit:  int32(perPage),
			Offset: int32((page - 1) * perPage),
		})
		if err != nil {
			httperr.InternalServerError(w)
			return
		}
		total, err := q.CountPublicProfiles(r.Context())
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		resp := profileListResponse{
			Profiles: make([]profileResponse, len(profiles)),
			Total:    int(total),
			Page:     page,
			PerPage:  perPage,
		}
		for i, p := range profiles {
			resp.Profiles[i] = toProfileResponse(p, true)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}
}
