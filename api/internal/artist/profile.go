package artist

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sniffins-mcmuggins/render/api/internal/analytics"
	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/billing"
	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

type spotHistoryEntry struct {
	SpotID       string  `json:"spot_id"`
	FestivalID   string  `json:"festival_id"`
	FestivalName string  `json:"festival_name"`
	FestivalYear *int32  `json:"festival_year"`
	Lat          float64 `json:"lat"`
	Lng          float64 `json:"lng"`
	MuralStatus  string  `json:"mural_status"`
}

type profileResponse struct {
	ID                string             `json:"id"`
	UserID            *string            `json:"user_id"`
	DisplayName       string             `json:"display_name"`
	Bio               string             `json:"bio"`
	Visibility        string             `json:"visibility"`
	LocationLabel     *string            `json:"location_label,omitempty"`
	MediumTags        []string           `json:"medium_tags"`
	SocialLinks       json.RawMessage    `json:"social_links"`
	AvatarS3Key       *string            `json:"avatar_s3_key,omitempty"`
	HeadlineImageUrls []string           `json:"headline_image_urls"`
	CreatedAt         string             `json:"created_at"`
	UpdatedAt         string             `json:"updated_at"`
	PreviewToken      *string            `json:"preview_token,omitempty"`
	SpotHistory       []spotHistoryEntry `json:"spot_history"`
}

type profileListResponse struct {
	Profiles []profileResponse `json:"profiles"`
	Total    int               `json:"total"`
	Page     int               `json:"page"`
	PerPage  int               `json:"per_page"`
}

func toProfileResponse(p sqlcdb.ArtistProfile, public bool) profileResponse {
	headlineImageUrls := p.HeadlineImageUrls
	if headlineImageUrls == nil {
		headlineImageUrls = []string{}
	}
	var userID *string
	if p.UserID.Valid {
		s := p.UserID.String()
		userID = &s
	}
	resp := profileResponse{
		ID:                p.ID.String(),
		UserID:            userID,
		DisplayName:       p.DisplayName,
		Bio:               p.Bio,
		Visibility:        p.Visibility,
		MediumTags:        p.MediumTags,
		SocialLinks:       p.SocialLinks,
		AvatarS3Key:       p.AvatarS3Key,
		HeadlineImageUrls: headlineImageUrls,
		CreatedAt:         p.CreatedAt.Time.Format(time.RFC3339),
		UpdatedAt:         p.UpdatedAt.Time.Format(time.RFC3339),
	}
	if !public || p.ShowLocation {
		resp.LocationLabel = p.LocationLabel
	}
	if !public {
		resp.PreviewToken = &p.PreviewToken
	}
	resp.SpotHistory = []spotHistoryEntry{}
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

// CreateProfileHandler handles POST /profiles. Any authenticated user can create their artist profile. One profile per user (enforced by unique index).
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
// Draft profiles are only visible to their owner.
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

		// Draft profiles are invisible to non-owners. 404 (not 403) to avoid
		// revealing that the profile exists.
		if profile.Visibility != "public" {
			principal, authErr := auth.User(r.Context())
			if authErr != nil || principal.UserID != profile.UserID.String() {
				httperr.NotFound(w)
				return
			}
		}

		resp := toProfileResponse(profile, true)

		histRows, err := q.GetSpotHistoryForProfile(r.Context(), profile.ID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}
		spotHistory := make([]spotHistoryEntry, 0, len(histRows))
		for _, row := range histRows {
			latF, _ := row.Lat.Float64Value()
			lngF, _ := row.Lng.Float64Value()
			var yr *int32
			switch v := row.FestivalYear.(type) {
			case int32:
				if v != 0 {
					yr = &v
				}
			case int64:
				if v != 0 {
					i32 := int32(v)
					yr = &i32
				}
			}
			spotHistory = append(spotHistory, spotHistoryEntry{
				SpotID:       row.SpotID.String(),
				FestivalID:   row.FestivalID.String(),
				FestivalName: row.FestivalName,
				FestivalYear: yr,
				Lat:          latF.Float64,
				Lng:          lngF.Float64,
				MuralStatus:  row.MuralStatus,
			})
		}
		resp.SpotHistory = spotHistory

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)

		// TODO(visibility): skip analytics event for owner self-view of draft
		// Fire-and-forget: record profile view. Uses a fresh context so the
		// goroutine outlives the request. Per background-work rule: bounded
		// timeout, no r.Context() capture.
		profileIDStr := profile.ID.String()
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if err := analytics.RecordEvent(ctx, pool, analytics.EventProfileView, profileIDStr); err != nil {
				slog.Error("analytics: record profile_view failed", "err", err, "profile_id", profileIDStr)
			}
		}()
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
			DisplayName       string          `json:"displayName"`
			Bio               string          `json:"bio"`
			LocationLabel     *string         `json:"locationLabel"`
			ShowLocation      *bool           `json:"showLocation"`
			MediumTags        []string        `json:"mediumTags"`
			SocialLinks       json.RawMessage `json:"socialLinks"`
			AvatarS3Key       *string         `json:"avatarS3Key"`
			HeadlineImageUrls []string        `json:"headlineImageUrls"`
			Visibility        *string         `json:"visibility"`
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
		headlineImageUrls := existing.HeadlineImageUrls
		if req.HeadlineImageUrls != nil {
			headlineImageUrls = req.HeadlineImageUrls
		}
		if headlineImageUrls == nil {
			headlineImageUrls = []string{}
		}
		visibility := existing.Visibility
		if req.Visibility != nil {
			if *req.Visibility != "draft" && *req.Visibility != "public" {
				httperr.UnprocessableEntity(w, "visibility must be draft or public")
				return
			}
			// Gate draft → public: requires active subscription or comp grant.
			if *req.Visibility == "public" && existing.Visibility == "draft" {
				canPub, pubErr := billing.CanPublish(r.Context(), pool, userUUID)
				if pubErr != nil {
					slog.Error("publish gate: check entitlement", "err", pubErr, "user_id", principal.UserID)
					httperr.InternalServerError(w)
					return
				}
				if !canPub {
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusPaymentRequired)
					_ = json.NewEncoder(w).Encode(map[string]string{
						"code":    "payment_required",
						"message": "An active artist subscription or comp grant is required to publish.",
					})
					return
				}
			}
			visibility = *req.Visibility
		}

		updated, err := q.UpdateArtistProfile(r.Context(), sqlcdb.UpdateArtistProfileParams{
			ID:                existing.ID,
			DisplayName:       displayName,
			Bio:               bio,
			LocationLabel:     locationLabel,
			ShowLocation:      showLocation,
			MediumTags:        mediumTags,
			SocialLinks:       socialLinks,
			AvatarS3Key:       avatarS3Key,
			HeadlineImageUrls: headlineImageUrls,
			Visibility:        visibility,
		})
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(toProfileResponse(updated, false))
	}
}

// PreviewByTokenHandler handles GET /profiles/preview/{token}.
// Public — no auth required. Returns the profile regardless of draft/public visibility,
// as long as the preview_token matches. The preview_token is NOT included in the response.
func PreviewByTokenHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := chi.URLParam(r, "token")
		if token == "" {
			httperr.BadRequest(w, "token is required")
			return
		}

		q := sqlcdb.New(pool)
		profile, err := q.GetArtistProfileByPreviewToken(r.Context(), token)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		// public=true: hides preview_token from response — the link IS the secret.
		_ = json.NewEncoder(w).Encode(toProfileResponse(profile, true))
	}
}

// RotatePreviewTokenHandler handles POST /profiles/me/preview-token/rotate.
// Owner-only — requires auth. Generates a fresh preview_token, invalidating
// any previously shared links.
func RotatePreviewTokenHandler(pool *pgxpool.Pool) http.HandlerFunc {
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
		profile, err := q.RotateArtistProfilePreviewToken(r.Context(), userUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		// public=false: includes the new preview_token so the owner can share it.
		_ = json.NewEncoder(w).Encode(toProfileResponse(profile, false))
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
