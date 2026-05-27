package billing

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stripe/stripe-go/v82"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

// FestivalActivateCheckoutHandler handles POST /billing/festival/{festivalID}/activate-checkout.
// Creates a Stripe Checkout for the £99 one-off festival activation fee.
func FestivalActivateCheckoutHandler(pool *pgxpool.Pool, sc *stripe.Client, prices Prices, siteBase string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, err := auth.User(r.Context())
		if err != nil || principal.Role != "organiser" {
			httperr.Write(w, http.StatusForbidden, "Forbidden", "organiser account required")
			return
		}

		festivalIDStr := chi.URLParam(r, "festivalID")
		festivalUUID, err := pgUUIDFromString(festivalIDStr)
		if err != nil {
			httperr.BadRequest(w, "invalid festival id")
			return
		}

		userUUID, err := pgUUIDFromString(principal.UserID)
		if err != nil {
			httperr.BadRequest(w, "invalid user id")
			return
		}

		q := sqlcdb.New(pool)

		// Must have paid setup fee first.
		paid, err := q.HasPaidSetupFee(r.Context(), userUUID)
		if err != nil {
			slog.Error("check setup fee", "err", err, "user_id", principal.UserID)
			httperr.InternalServerError(w)
			return
		}
		if !paid {
			httperr.Write(w, http.StatusPaymentRequired, "Payment Required", "organiser setup fee not paid")
			return
		}

		// Must not already be activated for this festival.
		activated, err := q.HasActiveFestivalMonth(r.Context(), sqlcdb.HasActiveFestivalMonthParams{
			UserID:     userUUID,
			FestivalID: festivalUUID,
		})
		if err != nil {
			slog.Error("check festival activation", "err", err, "user_id", principal.UserID, "festival_id", festivalIDStr)
			httperr.InternalServerError(w)
			return
		}
		if activated {
			httperr.Write(w, http.StatusConflict, "Conflict", "festival already activated")
			return
		}

		stripeCustomerID, err := getOrCreateStripeCustomer(r.Context(), q, sc, userUUID, principal.UserID)
		if err != nil {
			slog.Error("get/create stripe customer", "err", err, "user_id", principal.UserID)
			httperr.InternalServerError(w)
			return
		}

		params := &stripe.CheckoutSessionCreateParams{
			Customer: stripe.String(stripeCustomerID),
			Mode:     stripe.String(string(stripe.CheckoutSessionModePayment)),
			LineItems: []*stripe.CheckoutSessionCreateLineItemParams{
				{Price: stripe.String(prices.FestivalMonth), Quantity: stripe.Int64(1)},
			},
			SuccessURL: stripe.String(siteBase + "/organiser/festivals/" + festivalIDStr + "?activated=true"),
			CancelURL:  stripe.String(siteBase + "/organiser/festivals/" + festivalIDStr),
		}
		params.Metadata = map[string]string{
			"user_id":     principal.UserID,
			"festival_id": festivalIDStr,
			"charge_type": "festival_month",
		}

		sess, err := sc.V1CheckoutSessions.Create(r.Context(), params)
		if err != nil {
			slog.Error("create festival checkout session", "err", err, "user_id", principal.UserID, "festival_id", festivalIDStr)
			httperr.InternalServerError(w)
			return
		}

		sid := sess.ID
		if _, err := q.CreateOrgPayment(r.Context(), sqlcdb.CreateOrgPaymentParams{
			UserID:                  userUUID,
			FestivalID:              festivalUUID,
			StripeCheckoutSessionID: &sid,
			ChargeType:              "festival_month",
			AmountPence:             9900,
		}); err != nil {
			slog.Error("create festival payment record", "err", err, "session_id", sess.ID, "user_id", principal.UserID)
			httperr.InternalServerError(w)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"checkout_url": sess.URL})
	}
}
