package admin

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

var validPlans = map[string]bool{
	"artist_basic":        true,
	"artist_pro":          true,
	"organiser_setup":     true,
	"festival_activation": true,
}

type createGrantRequest struct {
	Plan         string `json:"plan"`
	DurationDays int    `json:"duration_days"`
	FestivalID   string `json:"festival_id,omitempty"`
	Note         string `json:"note,omitempty"`
}

type grantResponse struct {
	ID         string `json:"id"`
	UserID     string `json:"user_id"`
	Plan       string `json:"plan"`
	ValidUntil string `json:"valid_until"`
	Note       string `json:"note,omitempty"`
	CreatedAt  string `json:"created_at"`
}

// CreateGrantHandler handles POST /admin/users/{userID}/grants.
func CreateGrantHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userIDStr := chi.URLParam(r, "userID")
		userUUID, err := pgUUIDFromString(userIDStr)
		if err != nil {
			httperr.BadRequest(w, "invalid user id")
			return
		}

		adminPrincipal, err := auth.User(r.Context())
		if err != nil {
			httperr.Unauthorized(w)
			return
		}
		adminUUID, err := pgUUIDFromString(adminPrincipal.UserID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		var req createGrantRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.BadRequest(w, "invalid request body")
			return
		}
		if !validPlans[req.Plan] {
			httperr.BadRequest(w, "invalid plan: must be artist_basic, artist_pro, organiser_setup, or festival_activation")
			return
		}
		if req.DurationDays <= 0 {
			httperr.BadRequest(w, "duration_days must be positive")
			return
		}
		if req.Plan == "festival_activation" && req.FestivalID == "" {
			httperr.BadRequest(w, "festival_id is required for festival_activation grants")
			return
		}

		var note *string
		if req.Note != "" {
			note = &req.Note
		}

		q := sqlcdb.New(pool)
		if _, err := q.GetUserByID(r.Context(), userUUID); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			slog.Error("admin: create grant: user lookup", "err", err, "user_id", userIDStr)
			httperr.InternalServerError(w)
			return
		}

		grant, err := q.CreateAccessGrant(r.Context(), sqlcdb.CreateAccessGrantParams{
			UserID:      userUUID,
			Plan:        req.Plan,
			FestivalID:  pgUUIDNullable(req.FestivalID),
			ValidUntil:  pgTimestamptz(time.Now().Add(time.Duration(req.DurationDays) * 24 * time.Hour)),
			GrantedBy:   adminUUID,
			PromoCodeID: pgUUIDNullable(""),
			Note:        note,
		})
		if err != nil {
			slog.Error("admin: create grant", "err", err, "user_id", userIDStr)
			httperr.InternalServerError(w)
			return
		}

		resp := grantResponse{
			ID:         grant.ID.String(),
			UserID:     grant.UserID.String(),
			Plan:       grant.Plan,
			ValidUntil: grant.ValidUntil.Time.Format(time.RFC3339),
			CreatedAt:  grant.CreatedAt.Time.Format(time.RFC3339),
		}
		if grant.Note != nil {
			resp.Note = *grant.Note
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(resp)
	}
}

// RevokeGrantHandler handles DELETE /admin/grants/{grantID}.
// Idempotent: revoking an already-revoked grant returns 204.
func RevokeGrantHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		grantIDStr := chi.URLParam(r, "grantID")
		grantUUID, err := pgUUIDFromString(grantIDStr)
		if err != nil {
			httperr.BadRequest(w, "invalid grant id")
			return
		}

		q := sqlcdb.New(pool)
		if err := q.RevokeAccessGrant(r.Context(), grantUUID); err != nil {
			slog.Error("admin: revoke grant", "err", err, "grant_id", grantIDStr)
			httperr.InternalServerError(w)
			return
		}

		w.WriteHeader(http.StatusNoContent)
	}
}
