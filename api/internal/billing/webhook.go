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
	"github.com/stripe/stripe-go/v82/webhook"

	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

// WebhookHandler returns an http.Handler that processes Stripe webhook events.
func WebhookHandler(pool *pgxpool.Pool, sc *stripe.Client, webhookSecret string, prices Prices) http.Handler {
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
			slog.Debug("stripe webhook: unhandled event type", "type", event.Type, "event_id", event.ID)
		}

		w.WriteHeader(http.StatusOK)
	})
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
		slog.Error("stripe webhook: failed to unmarshal subscription", "err", err, "event_id", event.ID)
		return
	}

	if sub.Items == nil || len(sub.Items.Data) == 0 {
		slog.Error("stripe webhook: subscription has no items", "subscription_id", sub.ID, "event_id", event.ID)
		return
	}

	item := sub.Items.Data[0]
	priceID := ""
	if item.Price != nil {
		priceID = item.Price.ID
	}

	// user_id metadata is required — without it we cannot associate the
	// subscription with a user row (FK violation). Log loud and bail; the
	// operator must repair via the Stripe dashboard (set the metadata then
	// resend the webhook).
	userIDRaw := sub.Metadata["user_id"]
	if userIDRaw == "" {
		slog.Error("stripe webhook: subscription missing required user_id metadata",
			"subscription_id", sub.ID, "event_id", event.ID)
		return
	}
	userID, err := pgUUIDFromString(userIDRaw)
	if err != nil {
		slog.Error("stripe webhook: subscription user_id metadata is not a valid UUID",
			"err", err, "subscription_id", sub.ID, "event_id", event.ID, "user_id_raw", userIDRaw)
		return
	}

	festivalID := pgUUIDNullable(sub.Metadata["festival_id"])

	plan := PlanFromPriceID(priceID, prices)
	interval := IntervalFromPriceID(priceID, prices)
	currentPeriodEnd := pgTimestampFromUnix(item.CurrentPeriodEnd)

	subID := sub.ID
	q := sqlcdb.New(pool)
	_, err = q.UpsertSubscription(ctx, sqlcdb.UpsertSubscriptionParams{
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
		slog.Error("stripe webhook: failed to upsert subscription",
			"err", err, "subscription_id", sub.ID, "event_id", event.ID)
	}
}

func handleSubscriptionDeleted(ctx context.Context, pool *pgxpool.Pool, event stripe.Event) {
	var sub stripe.Subscription
	if err := json.Unmarshal(event.Data.Raw, &sub); err != nil {
		slog.Error("stripe webhook: failed to unmarshal subscription for deletion", "err", err, "event_id", event.ID)
		return
	}

	subID := sub.ID
	q := sqlcdb.New(pool)
	if err := q.SetSubscriptionStatus(ctx, sqlcdb.SetSubscriptionStatusParams{
		StripeSubscriptionID: &subID,
		Status:               "canceled",
	}); err != nil {
		slog.Error("stripe webhook: failed to mark subscription canceled",
			"err", err, "subscription_id", sub.ID, "event_id", event.ID)
	}
}

func handleCheckoutCompleted(ctx context.Context, pool *pgxpool.Pool, sc *stripe.Client, event stripe.Event, prices Prices) {
	var sess stripe.CheckoutSession
	if err := json.Unmarshal(event.Data.Raw, &sess); err != nil {
		slog.Error("stripe webhook: failed to unmarshal checkout session", "err", err, "event_id", event.ID)
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

	// MarkOrgPaymentPaidIfPending only updates rows in 'pending' state.
	// ErrNoRows means either: (a) the row was already paid (retry) or
	// (b) no matching session id exists (artist sub checkout). Disambiguate
	// via a follow-up read so we only trigger downstream side-effects
	// (festival annual sub auto-start) on the first transition.
	if _, err := q.MarkOrgPaymentPaidIfPending(ctx, sqlcdb.MarkOrgPaymentPaidIfPendingParams{
		StripeCheckoutSessionID: &sessionID,
		StripePaymentIntentID:   piID,
	}); err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			slog.Error("stripe webhook: failed to mark org payment paid",
				"err", err, "session_id", sess.ID, "event_id", event.ID)
			return
		}
		// ErrNoRows — distinguish retry from artist sub.
		existing, lookupErr := q.GetOrgPaymentBySession(ctx, &sessionID)
		if errors.Is(lookupErr, pgx.ErrNoRows) {
			slog.Debug("stripe webhook: no org payment row for checkout session",
				"session_id", sess.ID, "event_id", event.ID)
			return
		}
		if lookupErr != nil {
			slog.Error("stripe webhook: failed to look up org payment after no-op update",
				"err", lookupErr, "session_id", sess.ID, "event_id", event.ID)
			return
		}
		slog.Info("stripe webhook: checkout.session.completed for already-paid org payment, skipping",
			"session_id", sess.ID, "event_id", event.ID, "status", existing.Status)
		return
	}

	// First-time transition to 'paid'. After a successful festival activation
	// payment, start the annual recurring subscription.
	if sess.Metadata != nil && sess.Metadata["charge_type"] == "festival_activation" {
		startAnnualFestivalSubscription(ctx, pool, sc, prices, &sess)
	}
}

func startAnnualFestivalSubscription(ctx context.Context, pool *pgxpool.Pool, sc *stripe.Client, prices Prices, sess *stripe.CheckoutSession) {
	if sess.Customer == nil {
		slog.Error("stripe webhook: festival checkout has no customer", "session_id", sess.ID)
		return
	}
	if prices.FestivalAnnual == "" {
		slog.Warn("stripe webhook: festival annual price not configured; skipping subscription start", "session_id", sess.ID)
		return
	}

	// Anchor the annual subscription's first charge to the festival's end_date
	// (the recurring fee is for keeping the festival page live after the event).
	// Fall back to now+1mo only if we cannot resolve the festival — the operator
	// will see the loud log line and should reconcile manually.
	festivalIDRaw := sess.Metadata["festival_id"]
	var trialEnd int64
	if festivalIDRaw != "" {
		if festivalUUID, err := pgUUIDFromString(festivalIDRaw); err == nil {
			endDate, err := sqlcdb.New(pool).GetFestivalEndDate(ctx, festivalUUID)
			if err == nil && endDate.Valid {
				trialEnd = endDate.Time.Unix()
			} else if err != nil {
				slog.Warn("stripe webhook: could not load festival end_date for trial_end",
					"err", err, "festival_id", festivalIDRaw, "session_id", sess.ID)
			}
		}
	}
	if trialEnd == 0 {
		trialEnd = time.Now().AddDate(0, 1, 0).Unix()
		slog.Warn("stripe webhook: using fallback trial_end (now+1mo); festival end_date unavailable",
			"festival_id", festivalIDRaw, "session_id", sess.ID)
	}

	params := &stripe.SubscriptionCreateParams{
		Customer: stripe.String(sess.Customer.ID),
		Items: []*stripe.SubscriptionCreateItemParams{
			{Price: stripe.String(prices.FestivalAnnual)},
		},
		TrialEnd: stripe.Int64(trialEnd),
		Metadata: map[string]string{
			"user_id":     sess.Metadata["user_id"],
			"festival_id": sess.Metadata["festival_id"],
		},
	}
	sub, err := sc.V1Subscriptions.Create(ctx, params)
	if err != nil {
		slog.Error("stripe webhook: create festival annual subscription", "err", err, "session_id", sess.ID)
		return
	}
	slog.Info("stripe webhook: festival annual subscription started",
		"subscription_id", sub.ID,
		"festival_id", sess.Metadata["festival_id"],
		"trial_end", trialEnd,
	)
}

func handlePaymentFailed(ctx context.Context, pool *pgxpool.Pool, event stripe.Event) {
	var inv stripe.Invoice
	if err := json.Unmarshal(event.Data.Raw, &inv); err != nil {
		slog.Error("stripe webhook: failed to unmarshal invoice", "err", err, "event_id", event.ID)
		return
	}

	// Invoice.Parent.SubscriptionDetails.Subscription gives us the subscription.
	if inv.Parent == nil || inv.Parent.SubscriptionDetails == nil || inv.Parent.SubscriptionDetails.Subscription == nil {
		slog.Debug("stripe webhook: invoice.payment_failed has no subscription", "invoice_id", inv.ID, "event_id", event.ID)
		return
	}

	subID := inv.Parent.SubscriptionDetails.Subscription.ID
	q := sqlcdb.New(pool)
	if err := q.SetSubscriptionStatus(ctx, sqlcdb.SetSubscriptionStatusParams{
		StripeSubscriptionID: &subID,
		Status:               "past_due",
	}); err != nil {
		slog.Error("stripe webhook: failed to mark subscription past_due",
			"err", err, "subscription_id", subID, "event_id", event.ID)
	}
}
