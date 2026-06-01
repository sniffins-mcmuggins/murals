package beta

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

var validFeedbackKinds = map[string]bool{
	"idea":      true,
	"bug":       true,
	"direction": true,
	"praise":    true,
}

type feedbackRequest struct {
	Kind string `json:"kind"`
	Body string `json:"body"`
}

type feedbackResponse struct {
	ID        string  `json:"id"`
	Kind      string  `json:"kind"`
	Body      string  `json:"body"`
	AdminNote *string `json:"admin_note,omitempty"`
	CreatedAt string  `json:"created_at"`
}

func feedbackToResponse(f sqlcdb.BetaFeedback) feedbackResponse {
	return feedbackResponse{
		ID:        f.ID.String(),
		Kind:      f.Kind,
		Body:      f.Body,
		AdminNote: f.AdminNote,
		CreatedAt: f.CreatedAt.Time.UTC().Format("2006-01-02T15:04:05Z"),
	}
}

// SubmitFeedbackHandler handles POST /beta/feedback.
func SubmitFeedbackHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, err := auth.User(r.Context())
		if err != nil {
			httperr.Unauthorized(w)
			return
		}

		var req feedbackRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.BadRequest(w, "invalid request body")
			return
		}

		if !validFeedbackKinds[req.Kind] {
			httperr.UnprocessableEntity(w, "kind must be one of: idea, bug, direction, praise")
			return
		}
		if req.Body == "" {
			httperr.UnprocessableEntity(w, "body is required")
			return
		}

		userUUID, err := pgUUIDFromString(principal.UserID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		q := sqlcdb.New(pool)
		fb, err := q.CreateBetaFeedback(r.Context(), sqlcdb.CreateBetaFeedbackParams{
			UserID: userUUID,
			Kind:   req.Kind,
			Body:   req.Body,
		})
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(feedbackToResponse(fb))
	}
}

// GetMyFeedbackHandler handles GET /beta/feedback — returns only the caller's own rows.
func GetMyFeedbackHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, err := auth.User(r.Context())
		if err != nil {
			httperr.Unauthorized(w)
			return
		}

		userUUID, err := pgUUIDFromString(principal.UserID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		q := sqlcdb.New(pool)
		rows, err := q.ListBetaFeedbackByUser(r.Context(), userUUID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		resp := make([]feedbackResponse, 0, len(rows))
		for _, f := range rows {
			resp = append(resp, feedbackToResponse(f))
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}
}

// AdminListFeedbackHandler handles GET /admin/beta/feedback — returns all feedback rows.
func AdminListFeedbackHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, err := auth.User(r.Context()); err != nil {
			httperr.Unauthorized(w)
			return
		}

		q := sqlcdb.New(pool)
		rows, err := q.ListAllBetaFeedback(r.Context())
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		resp := make([]feedbackResponse, 0, len(rows))
		for _, f := range rows {
			resp = append(resp, feedbackToResponse(f))
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}
}

type adminUpdateFeedbackRequest struct {
	AdminNote *string `json:"admin_note"`
}

// AdminUpdateFeedbackHandler handles PATCH /admin/beta/feedback/{feedbackID}.
func AdminUpdateFeedbackHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, err := auth.User(r.Context()); err != nil {
			httperr.Unauthorized(w)
			return
		}

		feedbackIDStr := chi.URLParam(r, "feedbackID")
		feedbackUUID, err := pgUUIDFromString(feedbackIDStr)
		if err != nil {
			httperr.BadRequest(w, "invalid feedback id")
			return
		}

		var req adminUpdateFeedbackRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.BadRequest(w, "invalid request body")
			return
		}

		q := sqlcdb.New(pool)
		fb, err := q.UpdateBetaFeedbackNote(r.Context(), sqlcdb.UpdateBetaFeedbackNoteParams{
			ID:        feedbackUUID,
			AdminNote: req.AdminNote,
		})
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(feedbackToResponse(fb))
	}
}
