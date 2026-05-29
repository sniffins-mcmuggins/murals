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
// Returns applications enriched with artist profile data, notes, and score fields.
// Accessible by the festival owner and invited reviewers.
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

		callerUUID, err := pgUUIDFromString(principal.UserID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		// Fetch enriched rows. Reviewer path excludes the caller's own application.
		type item struct {
			resp applicationResponse
			id   pgtype.UUID
		}
		var items []item

		if role == roleReviewer {
			rows, err := q.ListApplicationsByFormWithArtistExcludingReviewer(r.Context(), sqlcdb.ListApplicationsByFormWithArtistExcludingReviewerParams{
				FormID: form.ID,
				UserID: callerUUID,
			})
			if err != nil {
				httperr.InternalServerError(w)
				return
			}
			for _, row := range rows {
				items = append(items, item{resp: toEnrichedReviewerRow(row), id: row.ID})
			}
		} else {
			rows, err := q.ListApplicationsByFormWithArtist(r.Context(), form.ID)
			if err != nil {
				httperr.InternalServerError(w)
				return
			}
			for _, row := range rows {
				items = append(items, item{resp: toEnrichedResponse(row), id: row.ID})
			}
		}

		if len(items) == 0 {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode([]applicationResponse{})
			return
		}

		appIDs := make([]pgtype.UUID, len(items))
		for i := range items {
			appIDs[i] = items[i].id
		}

		// Batch-fetch notes.
		notesByApp := map[string][]noteResponse{}
		for _, it := range items {
			notesByApp[it.id.String()] = []noteResponse{}
		}
		allNotes, err := q.ListNotesByApplications(r.Context(), appIDs)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}
		for _, n := range allNotes {
			k := n.ApplicationID.String()
			notesByApp[k] = append(notesByApp[k], toNoteResponse(n))
		}

		// Batch-fetch score summaries.
		type scoreSummary struct {
			avg   float64
			count int32
		}
		summaryByApp := map[string]scoreSummary{}
		summaries, err := q.ScoreSummaryByApplications(r.Context(), appIDs)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}
		for _, s := range summaries {
			summaryByApp[s.ApplicationID.String()] = scoreSummary{avg: s.AvgScore, count: s.ScoreCount}
		}

		// Batch-fetch the caller's own scores.
		myScoreByApp := map[string]int32{}
		myScores, err := q.GetMyScoresByApplications(r.Context(), sqlcdb.GetMyScoresByApplicationsParams{
			Column1:    appIDs,
			ReviewerID: callerUUID,
		})
		if err != nil {
			httperr.InternalServerError(w)
			return
		}
		for _, ms := range myScores {
			myScoreByApp[ms.ApplicationID.String()] = ms.Score
		}

		// Assemble final response.
		resp := make([]applicationResponse, len(items))
		for i, it := range items {
			a := it.resp
			a.Notes = notesByApp[it.id.String()]
			if sum, ok := summaryByApp[it.id.String()]; ok {
				avg := sum.avg
				a.AvgScore = &avg
				a.ScoreCount = sum.count
			}
			if ms, ok := myScoreByApp[it.id.String()]; ok {
				m := ms
				a.MyScore = &m
			}
			resp[i] = a
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
