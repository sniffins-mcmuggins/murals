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

		// Send notification emails to all affected artists
		for _, app := range released {
			status := string(app.Status)
			sendApplicationNotification(pool, mailer, app.ArtistID, fest.Name, status)
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]int{"released": len(released)})
	}
}
