package auth

import (
	"encoding/json"
	"net/http"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

// MeHandler handles GET /me. Requires auth.Middleware to be applied to the route.
func MeHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, err := User(r.Context())
		if err != nil {
			httperr.Unauthorized(w)
			return
		}

		parsed, err := uuid.Parse(principal.UserID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}
		uid := pgtype.UUID{Bytes: [16]byte(parsed), Valid: true}

		q := sqlcdb.New(pool)
		user, err := q.GetUserByID(r.Context(), uid)
		if err != nil {
			if err == pgx.ErrNoRows {
				httperr.Unauthorized(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(toUserResponse(user))
	}
}
