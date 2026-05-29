package festival

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

// ScoreApplicationHandler handles PUT /festivals/{festivalID}/applications/{applicationID}/score.
// Owner or reviewer. Reviewers cannot score their own application (COI).
func ScoreApplicationHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, err := auth.User(r.Context())
		if err != nil {
			httperr.Unauthorized(w)
			return
		}
		festUUID, err := pgUUIDFromString(chi.URLParam(r, "festivalID"))
		if err != nil {
			httperr.BadRequest(w, "invalid festivalID")
			return
		}
		appUUID, err := pgUUIDFromString(chi.URLParam(r, "applicationID"))
		if err != nil {
			httperr.BadRequest(w, "invalid applicationID")
			return
		}

		q := sqlcdb.New(pool)
		role, err := resolveFestivalAccess(r.Context(), q, festUUID, principal.UserID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}
		if role == roleNone {
			httperr.Forbidden(w)
			return
		}

		app, ok := getApplicationForFestival(r.Context(), q, w, festUUID, appUUID)
		if !ok {
			return
		}

		// COI: a reviewer cannot score the application that belongs to their own
		// artist profile.
		uid, err := pgUUIDFromString(principal.UserID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}
		profile, err := q.GetArtistProfileByUserID(r.Context(), uid)
		if err == nil && profile.ID == app.ArtistID {
			httperr.Forbidden(w)
			return
		} else if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			httperr.InternalServerError(w)
			return
		}

		var req struct {
			Score int32 `json:"score"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.BadRequest(w, "invalid request body")
			return
		}
		if req.Score < 1 || req.Score > 5 {
			httperr.UnprocessableEntity(w, "score must be between 1 and 5")
			return
		}

		score, err := q.UpsertApplicationScore(r.Context(), sqlcdb.UpsertApplicationScoreParams{
			ApplicationID: appUUID,
			ReviewerID:    uid,
			Score:         req.Score,
		})
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"application_id": score.ApplicationID.String(),
			"score":          score.Score,
		})
	}
}
