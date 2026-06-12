package festival

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

// decisionToStatus converts a present-tense decision enum value (accept/waitlist/
// decline) to the past-tense status string sendApplicationNotification switches on
// (accepted/waitlisted/declined). Keep this the single conversion site.
func decisionToStatus(d string) string {
	switch d {
	case "accept":
		return "accepted"
	case "waitlist":
		return "waitlisted"
	case "decline":
		return "declined"
	default:
		return d
	}
}

// ReleaseDecisionsHandler handles POST /festivals/{festivalID}/applications/release-decisions.
// Stamps released_at on every decided-but-unreleased application, creates festival_artists rows
// for accepts, and clears spots for non-accepts. Returns 409 if nothing to release.
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
		if reviewRoundStatus(fest) == reviewOpen {
			httperr.Conflict(w, "review round in progress — close it to make decisions")
			return
		}

		// Guard: all applications must have a decision before release.
		undecided, err := q.CountSubmittedUndecidedByFestival(r.Context(), festUUID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}
		if undecided > 0 {
			httperr.UnprocessableEntity(w, "all submitted applications must have a decision before releasing")
			return
		}

		// Release is a multi-table write: stamp released_at, create festival_artists rows
		// for accepts, clear spots for non-accepts. Wrap in one transaction.
		tx, err := pool.Begin(r.Context())
		if err != nil {
			httperr.InternalServerError(w)
			return
		}
		defer tx.Rollback(r.Context()) //nolint:errcheck // no-op after a successful Commit
		qtx := q.WithTx(tx)

		released, err := qtx.ReleaseDecisionsForFestival(r.Context(), festUUID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}
		if len(released) == 0 {
			// Nothing new to release — everything was already released.
			w.WriteHeader(http.StatusConflict)
			return
		}

		// Per-application side effects. Emails are collected and sent only after the
		// transaction commits — never email an artist about a decision that then rolls back.
		type pendingNotification struct {
			artistID pgtype.UUID
			status   string
		}
		notifications := make([]pendingNotification, 0, len(released))
		for _, app := range released {
			if app.Decision == sqlcdb.ApplicationDecisionAccept {
				if _, err := qtx.AddFestivalArtist(r.Context(), sqlcdb.AddFestivalArtistParams{
					FestivalID: festUUID,
					ArtistID:   app.ArtistID,
					Source:     sqlcdb.FestivalArtistSourceApplication,
				}); err != nil {
					httperr.InternalServerError(w)
					return
				}
			} else {
				// Safety net: an artist provisionally assigned a spot, then downgraded,
				// must not keep the spot into the live festival.
				if err := qtx.ClearSpotAssignmentForArtist(r.Context(), sqlcdb.ClearSpotAssignmentForArtistParams{
					FestivalID: festUUID, ArtistID: app.ArtistID,
				}); err != nil {
					httperr.InternalServerError(w)
					return
				}
			}
			notifications = append(notifications, pendingNotification{app.ArtistID, decisionToStatus(string(app.Decision))})
		}

		if err := tx.Commit(r.Context()); err != nil {
			httperr.InternalServerError(w)
			return
		}

		// Durable now — fire the notifications (each is a detached goroutine).
		for _, n := range notifications {
			sendApplicationNotification(pool, mailer, n.artistID, fest.Name, n.status)
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]int{"released": len(released)})
	}
}
