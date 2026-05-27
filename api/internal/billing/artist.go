package billing

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stripe/stripe-go/v82"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

type artistCheckoutRequest struct {
	PriceID string `json:"price_id"`
}

// ArtistCheckoutHandler returns an http.HandlerFunc that creates a Stripe
// Checkout Session for an artist subscription.
func ArtistCheckoutHandler(pool *pgxpool.Pool, sc *stripe.Client, prices Prices, siteBase string) http.HandlerFunc {
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
			slog.Error("get/create stripe customer", "err", err, "user_id", principal.UserID)
			httperr.InternalServerError(w)
			return
		}

		params := &stripe.CheckoutSessionCreateParams{
			Customer: stripe.String(stripeCustomerID),
			Mode:     stripe.String(string(stripe.CheckoutSessionModeSubscription)),
			LineItems: []*stripe.CheckoutSessionCreateLineItemParams{
				{Price: stripe.String(req.PriceID), Quantity: stripe.Int64(1)},
			},
			SuccessURL: stripe.String(siteBase + "/dashboard?billing=success"),
			CancelURL:  stripe.String(siteBase + "/billing"),
			SubscriptionData: &stripe.CheckoutSessionCreateSubscriptionDataParams{
				Metadata: map[string]string{"user_id": principal.UserID},
			},
		}
		sess, err := sc.V1CheckoutSessions.Create(r.Context(), params)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"checkout_url": sess.URL})
	}
}

// getOrCreateStripeCustomer returns the Stripe customer ID for a user,
// creating one and persisting the ID on a cache miss.
//
// Error handling distinguishes three lookup outcomes:
//   - nil err + non-empty value → reuse
//   - nil err + nil/empty value → user exists, no customer yet → create
//   - pgx.ErrNoRows → caller passed a non-existent user id → bail
//   - any other err → transient DB failure → bail without calling Stripe
//
// Bailing on real DB errors prevents orphaned Stripe customers: if we created
// one and then failed to persist the ID, the next request would create another.
func getOrCreateStripeCustomer(
	ctx context.Context,
	q *sqlcdb.Queries,
	sc *stripe.Client,
	userUUID pgtype.UUID,
	userIDStr string,
) (string, error) {
	existing, err := q.GetUserStripeCustomerID(ctx, userUUID)
	switch {
	case err == nil:
		if existing != nil && *existing != "" {
			return *existing, nil
		}
		// User row exists but customer not yet set — fall through to create.
	case errors.Is(err, pgx.ErrNoRows):
		return "", fmt.Errorf("user %s not found", userIDStr)
	default:
		return "", fmt.Errorf("read stripe_customer_id: %w", err)
	}

	user, err := q.GetUserByID(ctx, userUUID)
	if err != nil {
		return "", fmt.Errorf("load user for stripe customer create: %w", err)
	}

	custParams := &stripe.CustomerCreateParams{
		Email:    stripe.String(user.Email),
		Metadata: map[string]string{"user_id": userIDStr},
	}
	cust, err := sc.V1Customers.Create(ctx, custParams)
	if err != nil {
		return "", fmt.Errorf("stripe Customers.Create: %w", err)
	}

	sid := cust.ID
	if err := q.SetUserStripeCustomerID(ctx, sqlcdb.SetUserStripeCustomerIDParams{
		ID:               userUUID,
		StripeCustomerID: &sid,
	}); err != nil {
		// Stripe customer exists but we failed to persist it: log loud (an
		// operator should reconcile by email lookup in Stripe) and fail the
		// request so we don't silently keep creating duplicates on retry.
		slog.Error("orphaned stripe customer: failed to persist customer id",
			"err", err, "user_id", userIDStr, "stripe_customer_id", cust.ID)
		return "", fmt.Errorf("persist stripe_customer_id: %w", err)
	}
	return cust.ID, nil
}
