package billing

import (
	"encoding/json"
	"net/http"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stripe/stripe-go/v82"
	"github.com/stripe/stripe-go/v82/client"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

// OrgSetupCheckoutHandler handles POST /billing/organiser/setup-checkout.
// Creates a Stripe Checkout Session for the £35 one-time setup fee.
func OrgSetupCheckoutHandler(pool *pgxpool.Pool, sc *client.API, prices Prices, siteBase string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, err := auth.User(r.Context())
		if err != nil || principal.Role != "organiser" {
			httperr.Write(w, http.StatusForbidden, "Forbidden", "organiser account required")
			return
		}

		userUUID, err := pgUUIDFromString(principal.UserID)
		if err != nil {
			httperr.BadRequest(w, "invalid user id")
			return
		}

		q := sqlcdb.New(pool)

		paid, err := q.HasPaidSetupFee(r.Context(), userUUID)
		if err == nil && paid {
			httperr.Write(w, http.StatusConflict, "Conflict", "setup fee already paid")
			return
		}

		stripeCustomerID, err := getOrCreateStripeCustomer(r.Context(), q, sc, userUUID, principal.UserID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		params := &stripe.CheckoutSessionParams{
			Customer: stripe.String(stripeCustomerID),
			Mode:     stripe.String(string(stripe.CheckoutSessionModePayment)),
			LineItems: []*stripe.CheckoutSessionLineItemParams{
				{Price: stripe.String(prices.OrgSetup), Quantity: stripe.Int64(1)},
			},
			SuccessURL: stripe.String(siteBase + "/organiser/dashboard?setup=success"),
			CancelURL:  stripe.String(siteBase + "/organiser/billing"),
		}
		// Use session-level metadata so the webhook (checkout.session.completed) can read charge_type.
		params.Metadata = map[string]string{
			"user_id":     principal.UserID,
			"charge_type": "setup_fee",
		}

		sess, err := sc.CheckoutSessions.New(params)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		sid := sess.ID
		_, _ = q.CreateOrgPayment(r.Context(), sqlcdb.CreateOrgPaymentParams{
			UserID:                  userUUID,
			FestivalID:              pgtype.UUID{},
			StripeCheckoutSessionID: &sid,
			ChargeType:              "setup_fee",
			AmountPence:             3500,
		})

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"checkout_url": sess.URL})
	}
}
