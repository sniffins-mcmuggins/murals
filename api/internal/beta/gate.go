package beta

import (
	"log/slog"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/config"
	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

// Gate enforces beta membership when cfg.BetaMode is true.
// When BetaMode is false it is a no-op passthrough (launch exit path).
// is_beta is read live from the DB — never from the JWT — so membership
// changes take effect on the next request (same pattern as RequireAdmin).
// Anonymous requests (no principal) are passed through; downstream handlers
// return 401 if they require auth.
func Gate(cfg config.Config, pool *pgxpool.Pool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !cfg.BetaMode {
				next.ServeHTTP(w, r)
				return
			}

			principal, err := auth.User(r.Context())
			if err != nil {
				next.ServeHTTP(w, r)
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
				slog.Error("beta gate: user lookup failed", "err", err, "user_id", principal.UserID)
				httperr.InternalServerError(w)
				return
			}

			if !user.IsBeta {
				httperr.Write(w, http.StatusForbidden, "Forbidden", "beta access required")
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}
