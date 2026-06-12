package billing

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

// GrantTestHandler is a test-only endpoint (wired under /_test/) that mints a
// short-lived access grant for the authenticated user, so e2e tests and tooling
// (e.g. the UI health sweep's fixtures) can satisfy the publish gate
// (CanPublish) without standing up Stripe or seeding an admin session to call
// the real /admin/users/{id}/grants endpoint.
//
// Body: {"plan": "artist_basic"|"artist_pro"} — defaults to artist_basic.
// Grants to the calling principal (Bearer token), valid for 24h.
//
// Like all /_test/ routes, production safety relies on the deployment never
// exposing the path publicly (ingress rules), not a code-level guard.
func GrantTestHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, err := auth.User(r.Context())
		if err != nil {
			httperr.Unauthorized(w)
			return
		}

		var req struct {
			Plan string `json:"plan"`
		}
		// Body is optional; default the plan when absent or empty.
		_ = json.NewDecoder(r.Body).Decode(&req)
		if req.Plan == "" {
			req.Plan = "artist_basic"
		}

		var uid pgtype.UUID
		if err := uid.Scan(principal.UserID); err != nil {
			httperr.BadRequest(w, "invalid user id")
			return
		}

		note := "ui-health / e2e test grant"
		q := sqlcdb.New(pool)
		if _, err := q.CreateAccessGrant(r.Context(), sqlcdb.CreateAccessGrantParams{
			UserID:     uid,
			Plan:       req.Plan,
			ValidUntil: pgtype.Timestamptz{Time: time.Now().Add(24 * time.Hour), Valid: true},
			Note:       &note,
		}); err != nil {
			slog.Error("test grant: create access grant", "err", err)
			httperr.InternalServerError(w)
			return
		}
		w.WriteHeader(http.StatusOK)
	}
}
