// Package me provides handlers for endpoints under /me that return cross-
// resource summaries about the authenticated user.
package me

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

type artistProfilePayload struct {
	ID          string `json:"id"`
	DisplayName string `json:"display_name"`
	Bio         string `json:"bio"`
	AvatarS3Key string `json:"avatar_s3_key,omitempty"`
}

type festivalPayload struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Slug      string `json:"slug"`
	Status    string `json:"status"`
	StartDate string `json:"start_date,omitempty"`
	EndDate   string `json:"end_date,omitempty"`
}

type summaryResponse struct {
	ArtistProfile *artistProfilePayload `json:"artist_profile"`
	Festivals     []festivalPayload     `json:"festivals"`
}

// pgUUIDFromString parses a UUID string into a pgtype.UUID. Mirrors the
// helper in api/internal/auth/pgtype_helpers.go (which is unexported); kept
// local to avoid cross-package coupling for a single line of code.
func pgUUIDFromString(s string) (pgtype.UUID, error) {
	parsed, err := uuid.Parse(s)
	if err != nil {
		return pgtype.UUID{}, err
	}
	return pgtype.UUID{Bytes: [16]byte(parsed), Valid: true}, nil
}

// SummaryHandler returns a single-call snapshot of the authenticated user's
// artist profile (if any) and the festivals they organise. The dashboard
// uses this to render its two-card layout without a per-card round trip.
func SummaryHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, err := auth.User(r.Context())
		if err != nil {
			httperr.Unauthorized(w)
			return
		}
		userUUID, err := pgUUIDFromString(principal.UserID)
		if err != nil {
			httperr.BadRequest(w, "invalid user id")
			return
		}

		q := sqlcdb.New(pool)

		var profilePayload *artistProfilePayload
		profile, err := q.GetArtistProfileByUserID(r.Context(), userUUID)
		switch {
		case err == nil:
			avatar := ""
			if profile.AvatarS3Key != nil {
				avatar = *profile.AvatarS3Key
			}
			profilePayload = &artistProfilePayload{
				ID:          profile.ID.String(),
				DisplayName: profile.DisplayName,
				Bio:         profile.Bio,
				AvatarS3Key: avatar,
			}
		case errors.Is(err, pgx.ErrNoRows):
			// no profile — leave profilePayload nil
		default:
			httperr.InternalServerError(w)
			return
		}

		fests, err := q.ListFestivalsByOrganiser(r.Context(), userUUID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}
		festPayloads := make([]festivalPayload, 0, len(fests))
		for _, f := range fests {
			fp := festivalPayload{
				ID:     f.ID.String(),
				Name:   f.Name,
				Slug:   f.Slug,
				Status: string(f.Status),
			}
			if f.StartDate.Valid {
				fp.StartDate = f.StartDate.Time.Format("2006-01-02")
			}
			if f.EndDate.Valid {
				fp.EndDate = f.EndDate.Time.Format("2006-01-02")
			}
			festPayloads = append(festPayloads, fp)
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(summaryResponse{
			ArtistProfile: profilePayload,
			Festivals:     festPayloads,
		})
	}
}
