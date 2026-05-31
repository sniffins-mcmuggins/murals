package beta

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sniffins-mcmuggins/render/api/internal/config"
	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

// BetaStatusHandler handles GET /public/beta-status.
func BetaStatusHandler(cfg config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]bool{"beta_mode": cfg.BetaMode})
	}
}

type waitlistRequest struct {
	Email string `json:"email"`
}

// WaitlistHandler handles POST /waitlist.
// Idempotent on email (ON CONFLICT DO NOTHING in the DB query).
func WaitlistHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req waitlistRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.BadRequest(w, "invalid request body")
			return
		}
		email := strings.ToLower(strings.TrimSpace(req.Email))
		if email == "" {
			httperr.UnprocessableEntity(w, "email is required")
			return
		}

		q := sqlcdb.New(pool)
		if err := q.UpsertWaitlistRequest(r.Context(), email); err != nil {
			httperr.InternalServerError(w)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
