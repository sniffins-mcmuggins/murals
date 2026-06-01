package admin

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

type prospectImageInput struct {
	SourceURL string `json:"source_url"`
	Caption   string `json:"caption"`
}

type createProspectRequest struct {
	DisplayName   string               `json:"display_name"`
	Bio           string               `json:"bio"`
	LocationLabel *string              `json:"location_label"`
	MediumTags    []string             `json:"medium_tags"`
	SocialLinks   json.RawMessage      `json:"social_links"`
	Images        []prospectImageInput `json:"images"`
}

type createProspectResponse struct {
	ProfileID  string `json:"profile_id"`
	ClaimToken string `json:"claim_token"`
	PreviewURL string `json:"preview_url"`
}

// CreateProspectHandler handles POST /admin/prospects.
// Creates an unclaimed artist profile from seed data (artist-preview-builder output).
// Image uploads from source_url happen in a bounded background goroutine.
func CreateProspectHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, err := auth.User(r.Context())
		if err != nil {
			httperr.Unauthorized(w)
			return
		}
		adminUUID, err := pgUUIDFromString(principal.UserID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		var req createProspectRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.BadRequest(w, "invalid request body")
			return
		}
		if req.DisplayName == "" {
			httperr.UnprocessableEntity(w, "display_name is required")
			return
		}
		if req.MediumTags == nil {
			req.MediumTags = []string{}
		}
		if req.SocialLinks == nil {
			req.SocialLinks = json.RawMessage("{}")
		}

		q := sqlcdb.New(pool)

		// Idempotency: if a prospect with the same display_name from this admin exists, return it.
		existing, findErr := q.GetProspectByNameAndCreator(r.Context(), sqlcdb.GetProspectByNameAndCreatorParams{
			DisplayName: req.DisplayName,
			CreatedBy:   adminUUID,
		})
		if findErr == nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(createProspectResponse{
				ProfileID:  existing.ID.String(),
				ClaimToken: derefStr(existing.ClaimToken),
				PreviewURL: "/profiles/preview/" + existing.PreviewToken,
			})
			return
		}
		if !errors.Is(findErr, pgx.ErrNoRows) {
			httperr.InternalServerError(w)
			return
		}

		// Create the prospect profile (user_id NULL).
		profile, err := q.CreateProspectProfile(r.Context(), sqlcdb.CreateProspectProfileParams{
			DisplayName:   req.DisplayName,
			Bio:           req.Bio,
			LocationLabel: req.LocationLabel,
			MediumTags:    req.MediumTags,
			SocialLinks:   req.SocialLinks,
			CreatedBy:     adminUUID,
		})
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		// Generate claim token (UUID-derived, URL-safe).
		claimToken := generateToken()
		profile, err = q.SetProspectClaimToken(r.Context(), sqlcdb.SetProspectClaimTokenParams{
			ID:         profile.ID,
			ClaimToken: &claimToken,
		})
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		// Create a default collection for the prospect's images.
		collection, err := q.CreateCollection(r.Context(), sqlcdb.CreateCollectionParams{
			ArtistProfileID: profile.ID,
			Name:            "Portfolio",
		})
		if err != nil {
			slog.Error("create prospect: create collection failed", "profile_id", profile.ID, "err", err)
			// Non-fatal — prospect is usable without a collection.
		}

		// Kick off bounded image re-upload if images were supplied.
		if len(req.Images) > 0 && collection.ID.Valid {
			images := req.Images
			collectionID := collection.ID
			profileIDStr := profile.ID.String()
			go func() {
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
				defer cancel()
				uploadProspectImages(ctx, pool, collectionID, profileIDStr, images)
			}()
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(createProspectResponse{
			ProfileID:  profile.ID.String(),
			ClaimToken: claimToken,
			PreviewURL: "/profiles/preview/" + profile.PreviewToken,
		})
	}
}

func derefStr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// generateToken returns a URL-safe opaque token for the claim link.
// Reuses the preview token pattern: UUID hex without dashes.
func generateToken() string {
	id, _ := uuid.NewRandom()
	return strings.ReplaceAll(id.String(), "-", "")
}

// uploadProspectImages re-uploads images from source_url to our CDN.
// Runs in a background goroutine — failures are logged but not surfaced.
// MVP stub: logs pending uploads. Full pipeline deferred until image package exposes an internal API.
func uploadProspectImages(ctx context.Context, pool *pgxpool.Pool, collectionID pgtype.UUID, profileIDStr string, images []prospectImageInput) {
	for _, img := range images {
		slog.Info("prospect image pending upload", "source_url", img.SourceURL, "profile_id", profileIDStr)
	}
}
