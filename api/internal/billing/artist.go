package billing

import (
	"context"
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

type artistCheckoutRequest struct {
	PriceID string `json:"price_id"`
}

// ArtistCheckoutHandler returns an http.HandlerFunc that creates a Stripe
// Checkout Session for an artist subscription.
func ArtistCheckoutHandler(pool *pgxpool.Pool, sc *client.API, prices Prices, siteBase string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, err := auth.User(r.Context())
		if err != nil {
			httperr.Unauthorized(w)
			return
		}

		var req artistCheckoutRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.BadRequest(w, "invalid request body")
			return
		}

		// Validate price_id is one of the 4 artist price IDs.
		validPriceIDs := map[string]bool{
			prices.ArtistBasicAnnual: true,
			prices.ArtistBasicMonth:  true,
			prices.ArtistProAnnual:   true,
			prices.ArtistProMonth:    true,
		}
		if req.PriceID == "" || !validPriceIDs[req.PriceID] {
			httperr.BadRequest(w, "invalid price_id")
			return
		}

		userUUID, err := pgUUIDFromString(principal.UserID)
		if err != nil {
			httperr.BadRequest(w, "invalid user id")
			return
		}

		q := sqlcdb.New(pool)
		stripeCustomerID, err := getOrCreateStripeCustomer(r.Context(), q, sc, userUUID, principal.UserID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		params := &stripe.CheckoutSessionParams{
			Customer: stripe.String(stripeCustomerID),
			Mode:     stripe.String(string(stripe.CheckoutSessionModeSubscription)),
			LineItems: []*stripe.CheckoutSessionLineItemParams{
				{Price: stripe.String(req.PriceID), Quantity: stripe.Int64(1)},
			},
			SuccessURL: stripe.String(siteBase + "/dashboard?billing=success"),
			CancelURL:  stripe.String(siteBase + "/billing"),
			SubscriptionData: &stripe.CheckoutSessionSubscriptionDataParams{
				Metadata: map[string]string{"user_id": principal.UserID},
			},
		}
		sess, err := sc.CheckoutSessions.New(params)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"checkout_url": sess.URL})
	}
}

func getOrCreateStripeCustomer(
	ctx context.Context,
	q *sqlcdb.Queries,
	sc *client.API,
	userUUID pgtype.UUID,
	userIDStr string,
) (string, error) {
	existing, err := q.GetUserStripeCustomerID(ctx, userUUID)
	if err == nil && existing != nil && *existing != "" {
		return *existing, nil
	}

	user, err := q.GetUserByID(ctx, userUUID)
	if err != nil {
		return "", err
	}

	custParams := &stripe.CustomerParams{
		Email:    stripe.String(user.Email),
		Metadata: map[string]string{"user_id": userIDStr},
	}
	cust, err := sc.Customers.New(custParams)
	if err != nil {
		return "", err
	}

	sid := cust.ID
	_ = q.SetUserStripeCustomerID(ctx, sqlcdb.SetUserStripeCustomerIDParams{
		ID:               userUUID,
		StripeCustomerID: &sid,
	})
	return cust.ID, nil
}
