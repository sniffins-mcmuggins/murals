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

// ReleaseDecisionsHandler handles POST /festivals/{festivalID}/applications/release-decisions.
// Bulk-updates all staged decisions to final statuses, sends notification emails, and
// sets decisions_released_at. Returns 409 if already released.
func ReleaseDecisionsHandler(pool *pgxpool.Pool, mailer auth.EmailSender) http.HandlerFunc {
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

		// Guard: all submitted applications must have a staged decision before release.
		undecided, err := q.CountSubmittedUndecidedByFestival(r.Context(), festUUID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}
		if undecided > 0 {
			httperr.UnprocessableEntity(w, "all submitted applications must have a staged decision before releasing")
			return
		}

		// Mark festival as released first (returns no rows if already released → 409)
		_, err = q.SetFestivalDecisionsReleasedAt(r.Context(), festUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusConflict)
				return
			}
			httperr.InternalServerError(w)
			return
		}

		// Bulk-update staged decisions → final statuses
		released, err := q.ReleaseDecisionsForFestival(r.Context(), festUUID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		// Per-application side effects. Accepted artists become festival_artists so
		// they're assignable on the map and visible on the public roster — this
		// mirrors AcceptApplicationHandler, which the staged-decision flow replaces.
		// AddFestivalArtist is an upsert, so re-release is harmless. Decline/waitlist
		// touch no festival_artists row, matching the direct handlers.
		for _, app := range released {
			if app.Status == sqlcdb.ApplicationStatusAccepted {
				if _, err := q.AddFestivalArtist(r.Context(), sqlcdb.AddFestivalArtistParams{
					FestivalID: festUUID,
					ArtistID:   app.ArtistID,
					Status:     sqlcdb.FestivalArtistStatusAccepted,
				}); err != nil {
					httperr.InternalServerError(w)
					return
				}
			}
			sendApplicationNotification(pool, mailer, app.ArtistID, fest.Name, string(app.Status))
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]int{"released": len(released)})
	}
}
