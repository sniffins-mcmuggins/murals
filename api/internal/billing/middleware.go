package billing

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

// RequirePlan returns middleware that gates a handler on the user having
// an active subscription at the given plan level ("artist_basic" or "artist_pro").
// Responds 403 {code: "upgrade_required"} when the user has no qualifying
// subscription, 401 when unauthenticated, and 500 on transient DB errors —
// transient errors must not be masked as "upgrade required" or operators
// won't see the outage.
func RequirePlan(pool *pgxpool.Pool, requiredPlan string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			principal, err := auth.User(r.Context())
			if err != nil {
				httperr.Unauthorized(w)
				return
			}

			userUUID, err := pgUUIDFromString(principal.UserID)
			if err != nil {
				httperr.BadRequest(w, "invalid user id")
				return
			}

			q := sqlcdb.New(pool)
			sub, err := q.GetActiveSubscription(r.Context(), sqlcdb.GetActiveSubscriptionParams{
				UserID:     userUUID,
				FestivalID: pgtype.UUID{},
			})
			if errors.Is(err, pgx.ErrNoRows) {
				hasGrant, grantErr := q.HasActiveGrant(r.Context(), sqlcdb.HasActiveGrantParams{
					UserID:     userUUID,
					Plan:       requiredPlan,
					FestivalID: pgtype.UUID{},
				})
				if grantErr != nil {
					slog.Error("require plan: check active grant",
						"err", grantErr, "user_id", principal.UserID, "required_plan", requiredPlan)
					httperr.InternalServerError(w)
					return
				}
				if !hasGrant {
					writeUpgradeRequired(w, requiredPlan)
					return
				}
				next.ServeHTTP(w, r)
				return
			}
			if err != nil {
				slog.Error("require plan: fetch active subscription",
					"err", err, "user_id", principal.UserID, "required_plan", requiredPlan)
				httperr.InternalServerError(w)
				return
			}

			if !planSatisfies(sub.Plan, requiredPlan) {
				hasGrant, grantErr := q.HasActiveGrant(r.Context(), sqlcdb.HasActiveGrantParams{
					UserID:     userUUID,
					Plan:       requiredPlan,
					FestivalID: pgtype.UUID{},
				})
				if grantErr != nil {
					slog.Error("require plan: check active grant (subscription tier mismatch)",
						"err", grantErr, "user_id", principal.UserID, "required_plan", requiredPlan)
					httperr.InternalServerError(w)
					return
				}
				if !hasGrant {
					writeUpgradeRequired(w, requiredPlan)
					return
				}
				next.ServeHTTP(w, r)
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
