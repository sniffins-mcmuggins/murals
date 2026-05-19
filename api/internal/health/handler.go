package health

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
)

// Handler returns a handler for GET /healthz.
// Returns 200 {"status":"ok"} when the DB is reachable, 503 otherwise.
func Handler(db *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()

		if err := db.Ping(ctx); err != nil {
			httperr.Write(w, http.StatusServiceUnavailable, "Service Unavailable", "database unreachable")
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	}
}
