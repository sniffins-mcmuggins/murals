package billing

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stripe/stripe-go/v82"
	"github.com/stripe/stripe-go/v82/client"
	"github.com/stripe/stripe-go/v82/webhook"

	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

// WebhookHandler returns an http.Handler that processes Stripe webhook events.
func WebhookHandler(pool *pgxpool.Pool, sc *client.API, webhookSecret string, prices Prices) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			httperr.BadRequest(w, "failed to read body")
			return
		}

		event, err := webhook.ConstructEventWithOptions(body, r.Header.Get("Stripe-Signature"), webhookSecret,
			webhook.ConstructEventOptions{IgnoreAPIVersionMismatch: true})
		if err != nil {
			httperr.BadRequest(w, "invalid signature")
			return
		}

		ctx := r.Context()

		switch event.Type {
		case "customer.subscription.created", "customer.subscription.updated":
			handleSubscriptionUpsert(ctx, pool, event, prices)
		case "customer.subscription.deleted":
			handleSubscriptionDeleted(ctx, pool, event)
		case "checkout.session.completed":
			handleCheckoutCompleted(ctx, pool, sc, event, prices)
		case "invoice.payment_failed":
			handlePaymentFailed(ctx, pool, event)
		default:
			slog.Debug("stripe webhook: unhandled event type", "type", event.Type)
		}

		w.WriteHeader(http.StatusOK)
	})
}

// pgUUIDFromMeta parses metadata UUID, returns invalid UUID on failure or empty.
func pgUUIDFromMeta(s string) pgtype.UUID {
	if s == "" {
		return pgtype.UUID{}
	}
	v, err := pgUUIDFromString(s)
	if err != nil {
		return pgtype.UUID{}
	}
	return v
}

// pgTimestampFromUnix converts Unix timestamp to pgtype.Timestamptz.
func pgTimestampFromUnix(unix int64) pgtype.Timestamptz {
	if unix == 0 {
		return pgtype.Timestamptz{}
	}
	return pgtype.Timestamptz{Time: time.Unix(unix, 0), Valid: true}
}

func handleSubscriptionUpsert(ctx context.Context, pool *pgxpool.Pool, event stripe.Event, prices Prices) {
	var sub stripe.Subscription
	if err := json.Unmarshal(event.Data.Raw, &sub); err != nil {
		slog.Error("stripe webhook: failed to unmarshal subscription", "err", err)
		return
	}

	if sub.Items == nil || len(sub.Items.Data) == 0 {
		slog.Error("stripe webhook: subscription has no items", "subscription_id", sub.ID)
		return
	}

	item := sub.Items.Data[0]
	priceID := ""
	if item.Price != nil {
		priceID = item.Price.ID
	}

	plan := PlanFromPriceID(priceID, prices)
	interval := IntervalFromPriceID(priceID, prices)
	currentPeriodEnd := pgTimestampFromUnix(item.CurrentPeriodEnd)

	userID := pgUUIDFromMeta(sub.Metadata["user_id"])
	festivalID := pgUUIDNullable(sub.Metadata["festival_id"])

	subID := sub.ID
	q := sqlcdb.New(pool)
	_, err := q.UpsertSubscription(ctx, sqlcdb.UpsertSubscriptionParams{
		UserID:               userID,
		FestivalID:           festivalID,
		StripeSubscriptionID: &subID,
		StripePriceID:        priceID,
		Plan:                 plan,
		BillingInterval:      interval,
		Status:               string(sub.Status),
		CurrentPeriodEnd:     currentPeriodEnd,
	})
	if err != nil {
		slog.Error("stripe webhook: failed to upsert subscription", "err", err, "subscription_id", sub.ID)
	}
}

func handleSubscriptionDeleted(ctx context.Context, pool *pgxpool.Pool, event stripe.Event) {
	var sub stripe.Subscription
	if err := json.Unmarshal(event.Data.Raw, &sub); err != nil {
		slog.Error("stripe webhook: failed to unmarshal subscription for deletion", "err", err)
		return
	}

	q := sqlcdb.New(pool)
	subID := sub.ID
	existing, err := q.GetSubscriptionByStripeID(ctx, &subID)
	if errors.Is(err, pgx.ErrNoRows) {
		slog.Debug("stripe webhook: subscription not found for deletion", "subscription_id", sub.ID)
		return
	}
	if err != nil {
		slog.Error("stripe webhook: fetch subscription for deletion", "err", err, "subscription_id", sub.ID)
		return
	}

	_, err = q.UpsertSubscription(ctx, sqlcdb.UpsertSubscriptionParams{
		UserID:               existing.UserID,
		FestivalID:           existing.FestivalID,
		StripeSubscriptionID: &subID,
		StripePriceID:        existing.StripePriceID,
		Plan:                 existing.Plan,
		BillingInterval:      existing.BillingInterval,
		Status:               "canceled",
		CurrentPeriodEnd:     existing.CurrentPeriodEnd,
	})
	if err != nil {
		slog.Error("stripe webhook: failed to mark subscription canceled", "err", err, "subscription_id", sub.ID)
	}
}

func handleCheckoutCompleted(ctx context.Context, pool *pgxpool.Pool, sc *client.API, event stripe.Event, prices Prices) {
	var sess stripe.CheckoutSession
	if err := json.Unmarshal(event.Data.Raw, &sess); err != nil {
		slog.Error("stripe webhook: failed to unmarshal checkout session", "err", err)
		return
	}

	paymentIntentID := ""
	if sess.PaymentIntent != nil {
		paymentIntentID = sess.PaymentIntent.ID
	}

	sessionID := sess.ID
	q := sqlcdb.New(pool)
	var piID *string
	if paymentIntentID != "" {
		piID = &paymentIntentID
	}
	_, err := q.MarkOrgPaymentPaid(ctx, sqlcdb.MarkOrgPaymentPaidParams{
		StripeCheckoutSessionID: &sessionID,
		StripePaymentIntentID:   piID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		// Not an error — artist subscription checkout with no matching org payment row.
		slog.Debug("stripe webhook: no org payment row for checkout session", "session_id", sess.ID)
		return
	}
	if err != nil {
		slog.Error("stripe webhook: failed to mark org payment paid", "err", err, "session_id", sess.ID)
		return
	}

	// After a successful festival activation payment, start the annual recurring subscription.
	if sess.Metadata != nil && sess.Metadata["charge_type"] == "festival_month" {
		startAnnualFestivalSubscription(ctx, sc, prices, &sess)
	}
}

func startAnnualFestivalSubscription(ctx context.Context, sc *client.API, prices Prices, sess *stripe.CheckoutSession) {
	if sess.Customer == nil {
		slog.Error("stripe webhook: festival checkout has no customer", "session_id", sess.ID)
		return
	}
	if prices.FestivalAnnual == "" {
		slog.Warn("stripe webhook: festival annual price not configured; skipping subscription start", "session_id", sess.ID)
		return
	}

	// Schedule the annual subscription to start 1 month after activation.
	// The festival's exact end date isn't on the checkout session so we approximate.
	annualStart := time.Now().AddDate(0, 1, 0).Unix()

	params := &stripe.SubscriptionParams{
		Customer: stripe.String(sess.Customer.ID),
		Items: []*stripe.SubscriptionItemsParams{
			{Price: stripe.String(prices.FestivalAnnual)},
		},
		TrialEnd: stripe.Int64(annualStart),
		Metadata: map[string]string{
			"user_id":     sess.Metadata["user_id"],
			"festival_id": sess.Metadata["festival_id"],
		},
	}
	// Context is not threaded through Stripe client calls; suppress unused ctx lint warning.
	_ = ctx
	sub, err := sc.Subscriptions.New(params)
	if err != nil {
		slog.Error("stripe webhook: create festival annual subscription", "err", err, "session_id", sess.ID)
		return
	}
	slog.Info("stripe webhook: festival annual subscription started",
		"subscription_id", sub.ID,
		"festival_id", sess.Metadata["festival_id"],
	)
}

func handlePaymentFailed(ctx context.Context, pool *pgxpool.Pool, event stripe.Event) {
	var inv stripe.Invoice
	if err := json.Unmarshal(event.Data.Raw, &inv); err != nil {
		slog.Error("stripe webhook: failed to unmarshal invoice", "err", err)
		return
	}

	// Invoice.Parent.SubscriptionDetails.Subscription gives us the subscription.
	if inv.Parent == nil || inv.Parent.SubscriptionDetails == nil || inv.Parent.SubscriptionDetails.Subscription == nil {
		slog.Debug("stripe webhook: invoice.payment_failed has no subscription", "invoice_id", inv.ID)
		return
	}

	sub := inv.Parent.SubscriptionDetails.Subscription
	subID := sub.ID

	q := sqlcdb.New(pool)
	existing, err := q.GetSubscriptionByStripeID(ctx, &subID)
	if errors.Is(err, pgx.ErrNoRows) {
		slog.Debug("stripe webhook: subscription not found for payment_failed", "subscription_id", subID)
		return
	}
	if err != nil {
		slog.Error("stripe webhook: fetch subscription for payment_failed", "err", err, "subscription_id", subID)
		return
	}

	_, err = q.UpsertSubscription(ctx, sqlcdb.UpsertSubscriptionParams{
		UserID:               existing.UserID,
		FestivalID:           existing.FestivalID,
		StripeSubscriptionID: &subID,
		StripePriceID:        existing.StripePriceID,
		Plan:                 existing.Plan,
		BillingInterval:      existing.BillingInterval,
		Status:               "past_due",
		CurrentPeriodEnd:     existing.CurrentPeriodEnd,
	})
	if err != nil {
		slog.Error("stripe webhook: failed to mark subscription past_due", "err", err, "subscription_id", subID)
	}
}
