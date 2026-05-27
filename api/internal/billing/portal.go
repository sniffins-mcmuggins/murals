package billing

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stripe/stripe-go/v82"
	"github.com/stripe/stripe-go/v82/client"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

// CustomerPortalHandler handles POST /billing/portal.
// Returns {portal_url} pointing to the Stripe Customer Portal for self-service
// cancellation, payment method changes, and invoice history.
func CustomerPortalHandler(pool *pgxpool.Pool, sc *client.API, siteBase string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
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
		customerID, err := q.GetUserStripeCustomerID(r.Context(), userUUID)
		if errors.Is(err, pgx.ErrNoRows) {
			httperr.Write(w, http.StatusNotFound, "Not Found", "no billing account found")
			return
		}
		if err != nil {
			slog.Error("fetch stripe customer id", "err", err, "user_id", principal.UserID)
			httperr.InternalServerError(w)
			return
		}
		if customerID == nil || *customerID == "" {
			httperr.Write(w, http.StatusNotFound, "Not Found", "no billing account found")
			return
		}

		params := &stripe.BillingPortalSessionParams{
			Customer:  stripe.String(*customerID),
			ReturnURL: stripe.String(siteBase + "/billing"),
		}
		sess, err := sc.BillingPortalSessions.New(params)
		if err != nil {
			slog.Error("create stripe portal session", "err", err, "user_id", principal.UserID)
			httperr.InternalServerError(w)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"portal_url": sess.URL})
	}
}
