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

// ListApplicationsHandler handles GET /festivals/{festivalID}/applications.
// Returns applications enriched with artist profile data and notes.
func ListApplicationsHandler(pool *pgxpool.Pool) http.HandlerFunc {
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

		form, err := q.GetApplicationFormByFestivalID(r.Context(), festUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode([]applicationResponse{})
				return
			}
			httperr.InternalServerError(w)
			return
		}

		rows, err := q.ListApplicationsByFormWithArtist(r.Context(), form.ID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		// Batch-fetch notes for all applications
		notesByApp := map[string][]noteResponse{}
		if len(rows) > 0 {
			appIDs := make([]pgtype.UUID, len(rows))
			for i, row := range rows {
				appIDs[i] = row.ID
				notesByApp[row.ID.String()] = []noteResponse{}
			}
			allNotes, err := q.ListNotesByApplications(r.Context(), appIDs)
			if err != nil {
				httperr.InternalServerError(w)
				return
			}
			for _, n := range allNotes {
				key := n.ApplicationID.String()
				notesByApp[key] = append(notesByApp[key], toNoteResponse(n))
			}
		}

		resp := make([]applicationResponse, len(rows))
		for i, row := range rows {
			resp[i] = toEnrichedResponse(row, notesByApp[row.ID.String()])
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}
}

// AcceptApplicationHandler handles POST /festivals/{festivalID}/applications/{applicationID}/accept.
// Updates application status to 'accepted' and upserts a festival_artist record.
func AcceptApplicationHandler(pool *pgxpool.Pool, mailer auth.EmailSender) http.HandlerFunc {
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

		app, ok := getApplicationForFestival(r.Context(), q, w, festUUID, appUUID)
		if !ok {
			return
		}

		updated, err := q.UpdateApplicationStatus(r.Context(), sqlcdb.UpdateApplicationStatusParams{
			ID:     appUUID,
			Status: sqlcdb.ApplicationStatusAccepted,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}

		// Upsert festival_artist
		_, err = q.AddFestivalArtist(r.Context(), sqlcdb.AddFestivalArtistParams{
			FestivalID: festUUID,
			ArtistID:   app.ArtistID,
			Status:     sqlcdb.FestivalArtistStatusAccepted,
		})
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		sendApplicationNotification(pool, mailer, app.ArtistID, fest.Name, "accepted")

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(toApplicationResponse(updated))
	}
}

// DeclineApplicationHandler handles POST /festivals/{festivalID}/applications/{applicationID}/decline.
func DeclineApplicationHandler(pool *pgxpool.Pool, mailer auth.EmailSender) http.HandlerFunc {
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

		app, ok := getApplicationForFestival(r.Context(), q, w, festUUID, appUUID)
		if !ok {
			return
		}

		updated, err := q.UpdateApplicationStatus(r.Context(), sqlcdb.UpdateApplicationStatusParams{
			ID:     appUUID,
			Status: sqlcdb.ApplicationStatusDeclined,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}

		sendApplicationNotification(pool, mailer, app.ArtistID, fest.Name, "declined")

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(toApplicationResponse(updated))
	}
}
