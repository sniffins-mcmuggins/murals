package admin

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

type userListItem struct {
	ID         string `json:"id"`
	Email      string `json:"email"`
	IsAdmin    bool   `json:"is_admin"`
	MFAEnabled bool   `json:"mfa_enabled"`
	CreatedAt  string `json:"created_at"`
}

type grantSummary struct {
	ID         string `json:"id"`
	Plan       string `json:"plan"`
	ValidUntil string `json:"valid_until"`
	Note       string `json:"note,omitempty"`
	CreatedAt  string `json:"created_at"`
}

type subSummary struct {
	Plan             string `json:"plan"`
	Status           string `json:"status"`
	BillingInterval  string `json:"billing_interval"`
	CurrentPeriodEnd string `json:"current_period_end,omitempty"`
}

type userDetailResponse struct {
	ID           string         `json:"id"`
	Email        string         `json:"email"`
	IsAdmin      bool           `json:"is_admin"`
	MFAEnabled   bool           `json:"mfa_enabled"`
	CreatedAt    string         `json:"created_at"`
	Subscription *subSummary    `json:"subscription"`
	Grants       []grantSummary `json:"grants"`
}

// ListUsersHandler handles GET /admin/users.
func ListUsersHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		emailFilter := r.URL.Query().Get("email")
		page, _ := strconv.Atoi(r.URL.Query().Get("page"))
		if page < 1 {
			page = 1
		}
		perPage, _ := strconv.Atoi(r.URL.Query().Get("per_page"))
		if perPage < 1 || perPage > 100 {
			perPage = 50
		}
		offset := (page - 1) * perPage

		q := sqlcdb.New(pool)
		rows, err := q.ListUsers(r.Context(), sqlcdb.ListUsersParams{
			Email: emailFilter,
			Lim:   int32(perPage),
			Off:   int32(offset),
		})
		if err != nil {
			slog.Error("admin: list users", "err", err)
			httperr.InternalServerError(w)
			return
		}

		items := make([]userListItem, len(rows))
		for i, u := range rows {
			items[i] = userListItem{
				ID:         u.ID.String(),
				Email:      u.Email,
				IsAdmin:    u.IsAdmin,
				MFAEnabled: u.MfaEnabled,
				CreatedAt:  u.CreatedAt.Time.Format(time.RFC3339),
			}
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"users": items})
	}
}

// GetUserHandler handles GET /admin/users/{userID}.
func GetUserHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userIDStr := chi.URLParam(r, "userID")
		userUUID, err := pgUUIDFromString(userIDStr)
		if err != nil {
			httperr.BadRequest(w, "invalid user id")
			return
		}

		q := sqlcdb.New(pool)
		user, err := q.GetUserByID(r.Context(), userUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			slog.Error("admin: get user", "err", err, "user_id", userIDStr)
			httperr.InternalServerError(w)
			return
		}

		// Active subscription — nil if none found.
		var sub *subSummary
		s, err := q.GetActiveSubscription(r.Context(), sqlcdb.GetActiveSubscriptionParams{
			UserID:     userUUID,
			FestivalID: pgtype.UUID{},
		})
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			slog.Error("admin: get subscription", "err", err, "user_id", userIDStr)
			httperr.InternalServerError(w)
			return
		}
		if err == nil {
			ss := subSummary{
				Plan:            s.Plan,
				Status:          s.Status,
				BillingInterval: s.BillingInterval,
			}
			if s.CurrentPeriodEnd.Valid {
				ss.CurrentPeriodEnd = s.CurrentPeriodEnd.Time.Format(time.RFC3339)
			}
			sub = &ss
		}

		grants, err := q.ListActiveGrants(r.Context(), userUUID)
		if err != nil {
			slog.Error("admin: list grants", "err", err, "user_id", userIDStr)
			httperr.InternalServerError(w)
			return
		}
		grantItems := make([]grantSummary, len(grants))
		for i, g := range grants {
			gs := grantSummary{
				ID:         g.ID.String(),
				Plan:       g.Plan,
				ValidUntil: g.ValidUntil.Time.Format(time.RFC3339),
				CreatedAt:  g.CreatedAt.Time.Format(time.RFC3339),
			}
			if g.Note != nil {
				gs.Note = *g.Note
			}
			grantItems[i] = gs
		}

		resp := userDetailResponse{
			ID:           user.ID.String(),
			Email:        user.Email,
			IsAdmin:      user.IsAdmin,
			MFAEnabled:   user.MfaEnabled,
			CreatedAt:    user.CreatedAt.Time.Format(time.RFC3339),
			Subscription: sub,
			Grants:       grantItems,
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}
}

// TriggerPasswordResetHandler handles POST /admin/users/{userID}/password-reset.
func TriggerPasswordResetHandler(pool *pgxpool.Pool, mailer auth.EmailSender, webBase string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userIDStr := chi.URLParam(r, "userID")
		userUUID, err := pgUUIDFromString(userIDStr)
		if err != nil {
			httperr.BadRequest(w, "invalid user id")
			return
		}

		q := sqlcdb.New(pool)
		user, err := q.GetUserByID(r.Context(), userUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			slog.Error("admin: trigger password reset: user lookup", "err", err, "user_id", userIDStr)
			httperr.InternalServerError(w)
			return
		}

		w.WriteHeader(http.StatusAccepted)
		go auth.ForgotPasswordWork(pool, mailer, webBase, user.Email)
	}
}
