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
// Body: { "score": int, "criterion_id": string (optional, defaults to "overall") }
func ScoreApplicationHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, err := auth.User(r.Context())
		if err != nil {
			httperr.Unauthorized(w)
			return
		}
		uid, err := pgUUIDFromString(principal.UserID)
		if err != nil {
			httperr.InternalServerError(w)
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

		// COI: reviewer cannot score their own application.
		if role == roleReviewer {
			profile, err := q.GetArtistProfileByUserID(r.Context(), uid)
			if err == nil && profile.ID == app.ArtistID {
				httperr.Forbidden(w)
				return
			} else if err != nil && !errors.Is(err, pgx.ErrNoRows) {
				httperr.InternalServerError(w)
				return
			}
		}

		var req struct {
			Score       int32  `json:"score"`
			CriterionID string `json:"criterion_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.BadRequest(w, "invalid request body")
			return
		}
		if req.CriterionID == "" {
			req.CriterionID = "overall"
		}

		// Validate score range.
		// "overall" uses the historic 1–5 range. Named criteria use their
		// configured [min, max] from the form's review_criteria.
		minV, maxV := int32(1), int32(5)
		if req.CriterionID != "overall" {
			form, err := q.GetApplicationFormByFestivalID(r.Context(), festUUID)
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					httperr.UnprocessableEntity(w, "unknown criterion_id")
					return
				}
				httperr.InternalServerError(w)
				return
			}
			criteria, parseErr := parseCriteria(form.ReviewCriteria)
			if parseErr != nil {
				httperr.InternalServerError(w)
				return
			}
			found := false
			for _, c := range criteria {
				if c.ID == req.CriterionID {
					minV, maxV = int32(c.Min), int32(c.Max)
					found = true
					break
				}
			}
			if !found {
				httperr.UnprocessableEntity(w, "unknown criterion_id")
				return
			}
		}
		if req.Score < minV || req.Score > maxV {
			httperr.UnprocessableEntity(w, "score out of range for this criterion")
			return
		}

		score, err := q.UpsertApplicationScore(r.Context(), sqlcdb.UpsertApplicationScoreParams{
			ApplicationID: appUUID,
			ReviewerID:    uid,
			CriterionID:   req.CriterionID,
			Score:         req.Score,
		})
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		type scoreResponse struct {
			ApplicationID string `json:"application_id"`
			CriterionID   string `json:"criterion_id"`
			Score         int32  `json:"score"`
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(scoreResponse{
			ApplicationID: score.ApplicationID.String(),
			CriterionID:   score.CriterionID,
			Score:         score.Score,
		})
	}
}
