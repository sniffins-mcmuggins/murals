package billing

import (
	"encoding/json"
	"net/http"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

// RequirePlan returns middleware that gates a handler on the user having
// an active subscription at the given plan level ("artist_basic" or "artist_pro").
// On failure responds with 403 {code: "upgrade_required", message: ...}.
func RequirePlan(pool *pgxpool.Pool, requiredPlan string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			principal, err := auth.User(r.Context())
			if err != nil {
				writeUpgradeRequired(w, requiredPlan)
				return
			}

			userUUID, err := pgUUIDFromString(principal.UserID)
			if err != nil {
				writeUpgradeRequired(w, requiredPlan)
				return
			}

			q := sqlcdb.New(pool)
			sub, err := q.GetActiveSubscription(r.Context(), sqlcdb.GetActiveSubscriptionParams{
				UserID:     userUUID,
				FestivalID: pgtype.UUID{},
			})
			if err != nil {
				writeUpgradeRequired(w, requiredPlan)
				return
			}

			if !planSatisfies(sub.Plan, requiredPlan) {
				writeUpgradeRequired(w, requiredPlan)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// planSatisfies returns true if the user's plan meets or exceeds the required plan.
// Hierarchy: artist_basic < artist_pro.
func planSatisfies(userPlan, required string) bool {
	order := map[string]int{
		"artist_basic": 1,
		"artist_pro":   2,
	}
	return order[userPlan] >= order[required]
}

func writeUpgradeRequired(w http.ResponseWriter, plan string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusForbidden)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"code":    "upgrade_required",
		"message": "An active " + plan + " subscription is required.",
	})
}
