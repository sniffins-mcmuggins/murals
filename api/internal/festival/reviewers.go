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

type reviewerResponse struct {
	UserID     string  `json:"user_id"`
	Email      string  `json:"email"`
	AcceptedAt *string `json:"accepted_at"`
	CreatedAt  string  `json:"created_at"`
}

// InviteReviewerHandler handles POST /festivals/{festivalID}/reviewers. Owner only.
func InviteReviewerHandler(pool *pgxpool.Pool, mailer auth.EmailSender, webBase string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Inline ownership check (not requireFestivalOwner) because we need fest.Name for the invite email.
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

		var req struct {
			Email string `json:"email"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.BadRequest(w, "invalid request body")
			return
		}
		email := strings.ToLower(strings.TrimSpace(req.Email))
		if email == "" {
			httperr.UnprocessableEntity(w, "email is required")
			return
		}

		user, err := q.UpsertUserByEmail(r.Context(), email)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}
		row, err := q.AddFestivalReviewer(r.Context(), sqlcdb.AddFestivalReviewerParams{
			FestivalID: festUUID,
			UserID:     user.ID,
		})
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		// Detached invite email — never blocks or fails the response.
		go auth.InviteReviewerEmail(pool, mailer, webBase, user.ID, user.Email, user.PasswordHash != nil, fest.Name)

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		resp := reviewerResponse{
			UserID:    row.UserID.String(),
			Email:     user.Email,
			CreatedAt: row.CreatedAt.Time.Format("2006-01-02T15:04:05Z07:00"),
		}
		_ = json.NewEncoder(w).Encode(resp)
	}
}

// ListReviewersHandler handles GET /festivals/{festivalID}/reviewers. Owner only.
func ListReviewersHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := sqlcdb.New(pool)
		festUUID, ok := requireFestivalOwner(r, w, q, chi.URLParam(r, "festivalID"))
		if !ok {
			return
		}
		rows, err := q.ListFestivalReviewers(r.Context(), festUUID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}
		resp := make([]reviewerResponse, len(rows))
		for i, row := range rows {
			var accepted *string
			if row.AcceptedAt.Valid {
				s := row.AcceptedAt.Time.Format("2006-01-02T15:04:05Z07:00")
				accepted = &s
			}
			resp[i] = reviewerResponse{
				UserID:     row.UserID.String(),
				Email:      row.Email,
				AcceptedAt: accepted,
				CreatedAt:  row.CreatedAt.Time.Format("2006-01-02T15:04:05Z07:00"),
			}
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}
}

// RemoveReviewerHandler handles DELETE /festivals/{festivalID}/reviewers/{userID}. Owner only.
func RemoveReviewerHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := sqlcdb.New(pool)
		festUUID, ok := requireFestivalOwner(r, w, q, chi.URLParam(r, "festivalID"))
		if !ok {
			return
		}
		userUUID, err := pgUUIDFromString(chi.URLParam(r, "userID"))
		if err != nil {
			httperr.BadRequest(w, "invalid userID")
			return
		}
		if err := q.RemoveFestivalReviewer(r.Context(), sqlcdb.RemoveFestivalReviewerParams{
			FestivalID: festUUID,
			UserID:     userUUID,
		}); err != nil {
			httperr.InternalServerError(w)
			return
		}
		// 204 even if the row didn't exist — idempotent delete is intentional.
		w.WriteHeader(http.StatusNoContent)
	}
}
