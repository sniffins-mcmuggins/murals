package admin

import (
	"log/slog"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

// RequireAdmin is a middleware that allows only admin users with MFA enrolled.
// It checks:
//  1. A valid authenticated principal must be present → 401 if missing.
//  2. The principal must have the admin flag set → 403 if not.
//  3. The user's DB record must have MFA enabled → 403 if not.
func RequireAdmin(pool *pgxpool.Pool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			principal, err := auth.User(r.Context())
			if err != nil {
				httperr.Unauthorized(w)
				return
			}
			if !principal.IsAdmin {
				httperr.Forbidden(w)
				return
			}
			userUUID, err := pgUUIDFromString(principal.UserID)
			if err != nil {
				httperr.InternalServerError(w)
				return
			}
			q := sqlcdb.New(pool)
			user, err := q.GetUserByID(r.Context(), userUUID)
			if err != nil {
				if err == pgx.ErrNoRows {
					httperr.Unauthorized(w)
					return
				}
				slog.Error("require admin: user lookup failed", "err", err, "user_id", principal.UserID)
				httperr.InternalServerError(w)
				return
			}
			// Re-read is_admin from the DB — the JWT claim could be stale if the
			// user was demoted after their token was issued (TTL up to 7 days).
			if !user.IsAdmin {
				httperr.Forbidden(w)
				return
			}
			if !user.MfaEnabled {
				httperr.Write(w, http.StatusForbidden, "Forbidden", "admin account must have MFA enrolled")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
