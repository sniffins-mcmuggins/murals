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

// PatchApplicationHandler handles PATCH /festivals/{festivalID}/applications/{applicationID}.
// Accepts { "shortlisted": bool, "review_flag": bool, "staged_decision": string|null }.
// staged_decision if provided must be "accept", "waitlist", "decline" or null (to clear).
func PatchApplicationHandler(pool *pgxpool.Pool) http.HandlerFunc {
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
		if reviewRoundStatus(fest) == reviewOpen {
			httperr.Conflict(w, "review round in progress — close it to make decisions")
			return
		}

		app, ok := getApplicationForFestival(r.Context(), q, w, festUUID, appUUID)
		if !ok {
			return
		}

		var req struct {
			Shortlisted    bool    `json:"shortlisted"`
			ReviewFlag     bool    `json:"review_flag"`
			StagedDecision *string `json:"staged_decision"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.BadRequest(w, "invalid request body")
			return
		}

		if req.StagedDecision != nil {
			valid := map[string]bool{"accept": true, "waitlist": true, "decline": true}
			if !valid[*req.StagedDecision] {
				httperr.BadRequest(w, "staged_decision must be accept, waitlist, or decline")
				return
			}
		}

		updated, err := q.UpdateApplicationFlags(r.Context(), sqlcdb.UpdateApplicationFlagsParams{
			ID:             appUUID,
			Shortlisted:    req.Shortlisted,
			ReviewFlag:     req.ReviewFlag,
			StagedDecision: req.StagedDecision,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}

		// Invariant: a spot may only belong to a spot-eligible accept.
		// If this application is no longer staged 'accept', clear any spot it holds.
		if req.StagedDecision == nil || *req.StagedDecision != "accept" {
			if err := q.ClearSpotAssignmentForArtist(r.Context(), sqlcdb.ClearSpotAssignmentForArtistParams{
				FestivalID: festUUID, ArtistID: app.ArtistID,
			}); err != nil {
				httperr.InternalServerError(w)
				return
			}
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(toApplicationResponse(updated))
	}
}

// ReorderApplicationsHandler handles POST /festivals/{festivalID}/applications/reorder.
// Body: { "status": "submitted", "ids": ["uuid1", "uuid2", ...] }
// Sets rank = 0, 1, 2… for the given IDs within the given status bucket.
func ReorderApplicationsHandler(pool *pgxpool.Pool) http.HandlerFunc {
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
		if reviewRoundStatus(fest) == reviewOpen {
			httperr.Conflict(w, "review round in progress — close it to make decisions")
			return
		}

		var req struct {
			Status string   `json:"status"`
			IDs    []string `json:"ids"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.BadRequest(w, "invalid request body")
			return
		}
		if len(req.IDs) == 0 {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		validStatuses := map[string]bool{"submitted": true, "accepted": true, "waitlisted": true, "declined": true}
		if !validStatuses[req.Status] {
			httperr.BadRequest(w, "invalid status")
			return
		}

		// Verify each application belongs to this festival and has the expected status.
		for _, idStr := range req.IDs {
			appUUID, err := pgUUIDFromString(idStr)
			if err != nil {
				httperr.BadRequest(w, "invalid application id: "+idStr)
				return
			}
			app, ok := getApplicationForFestival(r.Context(), q, w, festUUID, appUUID)
			if !ok {
				return
			}
			if string(app.Status) != req.Status {
				httperr.BadRequest(w, "application status mismatch: "+idStr)
				return
			}
		}

		tx, err := pool.Begin(r.Context())
		if err != nil {
			httperr.InternalServerError(w)
			return
		}
		defer tx.Rollback(r.Context()) //nolint:errcheck

		qtx := sqlcdb.New(tx)
		for i, idStr := range req.IDs {
			appUUID, err := pgUUIDFromString(idStr)
			if err != nil {
				httperr.BadRequest(w, "invalid application id: "+idStr)
				return
			}
			if err := qtx.UpdateApplicationRank(r.Context(), sqlcdb.UpdateApplicationRankParams{
				Rank: int32(i),
				ID:   appUUID,
			}); err != nil {
				httperr.InternalServerError(w)
				return
			}
		}

		if err := tx.Commit(r.Context()); err != nil {
			httperr.InternalServerError(w)
			return
		}

		w.WriteHeader(http.StatusNoContent)
	}
}
