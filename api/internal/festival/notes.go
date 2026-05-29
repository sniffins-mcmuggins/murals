package festival

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

// AddApplicationNoteHandler handles POST /festivals/{festivalID}/applications/{applicationID}/notes.
func AddApplicationNoteHandler(pool *pgxpool.Pool) http.HandlerFunc {
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

		// Verify the application exists and belongs to this festival.
		app, err := q.GetApplicationByID(r.Context(), appUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}
		festForm, err := q.GetApplicationFormByFestivalID(r.Context(), festUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}
		if app.FormID != festForm.ID {
			httperr.NotFound(w)
			return
		}

		var req struct {
			Content string `json:"content"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.BadRequest(w, "invalid request body")
			return
		}
		req.Content = strings.TrimSpace(req.Content)
		if req.Content == "" {
			httperr.UnprocessableEntity(w, "content is required")
			return
		}
		if len(req.Content) > 5000 {
			httperr.UnprocessableEntity(w, "content too long")
			return
		}

		authorUUID, err := pgUUIDFromString(principal.UserID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}
		note, err := q.CreateApplicationNote(r.Context(), sqlcdb.CreateApplicationNoteParams{
			ApplicationID: appUUID,
			Content:       req.Content,
			AuthorID:      authorUUID,
		})
		if err != nil {
			if isFKViolation(err) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(toNoteResponse(note))
	}
}
