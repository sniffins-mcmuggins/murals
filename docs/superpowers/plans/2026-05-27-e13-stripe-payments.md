# E13 — Stripe Payments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement artist and organiser billing via Stripe Checkout and Customer Portal. No custom payment UI — Stripe hosts all payment forms. Every artist account requires a paid subscription (Basic or Pro). Organisers pay a one-time setup fee, a per-festival activation fee, and an annual listing fee.

**Architecture:** All billing logic lives in `api/internal/billing/`. The Go API creates Stripe Checkout sessions and returns URLs to the Next.js frontend. Stripe webhooks update the `subscriptions` and `organiser_payments` DB tables. A Chi middleware reads subscription status from DB and gates Pro-only features with a `403 {code: "upgrade_required"}`. The Stripe Customer Portal handles cancellation and payment method changes — no custom billing management UI needed.

**Tech Stack:** `github.com/stripe/stripe-go/v82`, `github.com/sniffins-mcmuggins/render/api` module. Module: `github.com/sniffins-mcmuggins/render/api`

**Spec:** `docs/superpowers/specs/2026-05-27-production-readiness-design.md` — E13 section

---

## File structure

```
api/
  internal/
    billing/
      stripe.go         # Stripe client init + helper types
      artist.go         # artist checkout handler
      organiser.go      # organiser setup checkout handler
      festival.go       # festival activation checkout + annual sub trigger
      webhook.go        # Stripe webhook handler
      portal.go         # Customer Portal handler
      middleware.go     # tier enforcement middleware
      artist_test.go
      webhook_test.go
      middleware_test.go
    config/
      config.go         # add Stripe config fields
  cmd/
    api/
      main.go           # register /billing/* routes
db/
  migrations/
    000011_billing.up.sql
    000011_billing.down.sql
  queries/
    billing.sql         # new
web/
  src/
    app/
      (artist)/
        billing/
          page.tsx      # artist pricing + upgrade CTA
      organiser/
        billing/
          page.tsx      # organiser plan + manage button
    components/
      PricingCard.tsx   # shared pricing card component
```

---

## Task 1: DB migration — billing tables

**Files:**
- Create: `db/migrations/000011_billing.up.sql`
- Create: `db/migrations/000011_billing.down.sql`

- [ ] **Step 1: Write up migration**

```sql
-- db/migrations/000011_billing.up.sql

ALTER TABLE users ADD COLUMN stripe_customer_id text;

-- Recurring subscriptions: artist tiers + festival annual listing
CREATE TABLE subscriptions (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  festival_id            uuid        REFERENCES festivals(id) ON DELETE SET NULL,
  stripe_subscription_id text        UNIQUE,
  stripe_price_id        text        NOT NULL,
  plan                   text        NOT NULL,
  billing_interval       text        NOT NULL,
  status                 text        NOT NULL DEFAULT 'incomplete',
  current_period_end     timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- plan values: 'artist_basic' | 'artist_pro' | 'festival_annual'
-- billing_interval values: 'month' | 'year'
-- status values: 'active' | 'past_due' | 'canceled' | 'incomplete'

CREATE INDEX subscriptions_user_idx     ON subscriptions (user_id);
CREATE INDEX subscriptions_festival_idx ON subscriptions (festival_id) WHERE festival_id IS NOT NULL;

-- One-time charges: organiser setup fee + festival activation month fee
CREATE TABLE organiser_payments (
  id                         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  festival_id                uuid        REFERENCES festivals(id) ON DELETE SET NULL,
  stripe_checkout_session_id text        UNIQUE,
  stripe_payment_intent_id   text,
  charge_type                text        NOT NULL,
  amount_pence               integer     NOT NULL,
  status                     text        NOT NULL DEFAULT 'pending',
  paid_at                    timestamptz,
  created_at                 timestamptz NOT NULL DEFAULT now()
);

-- charge_type values: 'setup_fee' | 'festival_month'
-- status values: 'pending' | 'paid' | 'failed'

CREATE INDEX organiser_payments_user_idx    ON organiser_payments (user_id);
CREATE INDEX organiser_payments_session_idx ON organiser_payments (stripe_checkout_session_id);
```

- [ ] **Step 2: Write down migration**

```sql
-- db/migrations/000011_billing.down.sql
DROP TABLE IF EXISTS organiser_payments;
DROP TABLE IF EXISTS subscriptions;
ALTER TABLE users DROP COLUMN IF EXISTS stripe_customer_id;
```

- [ ] **Step 3: Apply migration**

```bash
task db:migrate
```

Expected: "migrate: 1/u 000011_billing"

---

## Task 2: sqlc billing queries

**Files:**
- Create: `db/queries/billing.sql`

- [ ] **Step 1: Write billing.sql**

```sql
-- db/queries/billing.sql

-- name: GetActiveSubscription :one
SELECT * FROM subscriptions
WHERE user_id = $1 AND status = 'active'
  AND (festival_id IS NULL OR festival_id = $2)
ORDER BY created_at DESC
LIMIT 1;

-- name: GetSubscriptionByStripeID :one
SELECT * FROM subscriptions
WHERE stripe_subscription_id = $1
LIMIT 1;

-- name: UpsertSubscription :one
INSERT INTO subscriptions (user_id, festival_id, stripe_subscription_id, stripe_price_id, plan, billing_interval, status, current_period_end)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
ON CONFLICT (stripe_subscription_id) DO UPDATE
  SET status             = EXCLUDED.status,
      current_period_end = EXCLUDED.current_period_end,
      stripe_price_id    = EXCLUDED.stripe_price_id,
      plan               = EXCLUDED.plan,
      billing_interval   = EXCLUDED.billing_interval,
      updated_at         = now()
RETURNING *;

-- name: SetUserStripeCustomerID :exec
UPDATE users SET stripe_customer_id = $2 WHERE id = $1;

-- name: GetUserStripeCustomerID :one
SELECT stripe_customer_id FROM users WHERE id = $1;

-- name: CreateOrgPayment :one
INSERT INTO organiser_payments (user_id, festival_id, stripe_checkout_session_id, charge_type, amount_pence)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: GetOrgPaymentBySession :one
SELECT * FROM organiser_payments
WHERE stripe_checkout_session_id = $1
LIMIT 1;

-- name: MarkOrgPaymentPaid :one
UPDATE organiser_payments
SET status = 'paid', stripe_payment_intent_id = $2, paid_at = now()
WHERE stripe_checkout_session_id = $1
RETURNING *;

-- name: HasPaidSetupFee :one
SELECT EXISTS (
  SELECT 1 FROM organiser_payments
  WHERE user_id = $1 AND charge_type = 'setup_fee' AND status = 'paid'
) AS paid;

-- name: HasActiveFestivalMonth :one
SELECT EXISTS (
  SELECT 1 FROM organiser_payments
  WHERE user_id = $1 AND festival_id = $2 AND charge_type = 'festival_month' AND status = 'paid'
) AS paid;
```

- [ ] **Step 2: Regenerate sqlc**

```bash
task db:generate
```

Expected: new billing query functions appear in `api/internal/sqlcdb/`.

---

## Task 3: Stripe client + config

**Files:**
- Create: `api/internal/billing/stripe.go`
- Modify: `api/internal/config/config.go`

- [ ] **Step 1: Add Stripe dependency**

```bash
cd api && go get github.com/stripe/stripe-go/v82
```

- [ ] **Step 2: Add Stripe config fields**

```go
// api/internal/config/config.go — add to Config struct:
StripeSecretKey              string
StripeWebhookSecret          string
StripeArtistBasicAnnualPrice string
StripeArtistBasicMonthlyPrice string
StripeArtistProAnnualPrice   string
StripeArtistProMonthlyPrice  string
StripeOrgSetupPrice          string
StripeFestivalMonthPrice     string
StripeFestivalAnnualPrice    string

// Add to Load():
StripeSecretKey:               env("STRIPE_SECRET_KEY", ""),
StripeWebhookSecret:           env("STRIPE_WEBHOOK_SECRET", ""),
StripeArtistBasicAnnualPrice:  env("STRIPE_ARTIST_BASIC_ANNUAL_PRICE_ID", ""),
StripeArtistBasicMonthlyPrice: env("STRIPE_ARTIST_BASIC_MONTHLY_PRICE_ID", ""),
StripeArtistProAnnualPrice:    env("STRIPE_ARTIST_PRO_ANNUAL_PRICE_ID", ""),
StripeArtistProMonthlyPrice:   env("STRIPE_ARTIST_PRO_MONTHLY_PRICE_ID", ""),
StripeOrgSetupPrice:           env("STRIPE_ORG_SETUP_PRICE_ID", ""),
StripeFestivalMonthPrice:      env("STRIPE_FESTIVAL_MONTH_PRICE_ID", ""),
StripeFestivalAnnualPrice:     env("STRIPE_FESTIVAL_ANNUAL_PRICE_ID", ""),
```

- [ ] **Step 3: Write billing/stripe.go**

```go
// api/internal/billing/stripe.go
package billing

import (
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stripe/stripe-go/v82"
	"github.com/stripe/stripe-go/v82/client"
)

// Prices holds the Stripe Price IDs loaded from config.
type Prices struct {
	ArtistBasicAnnual  string
	ArtistBasicMonthly string
	ArtistProAnnual    string
	ArtistProMonthly   string
	OrgSetup           string
	FestivalMonth      string
	FestivalAnnual     string
}

// pgUUIDFromString parses a UUID string into pgtype.UUID.
// Defined here so the billing package has no dependency on internal/auth.
func pgUUIDFromString(s string) (pgtype.UUID, error) {
	parsed, err := uuid.Parse(s)
	if err != nil {
		return pgtype.UUID{}, err
	}
	return pgtype.UUID{Bytes: [16]byte(parsed), Valid: true}, nil
}

// NewStripeClient initialises the Stripe API client with the given secret key.
func NewStripeClient(secretKey string) *client.API {
	stripe.Key = secretKey
	return &client.API{}
}

// PlanFromPriceID maps a Stripe Price ID to a plan name.
func PlanFromPriceID(priceID string, prices Prices) string {
	switch priceID {
	case prices.ArtistBasicAnnual, prices.ArtistBasicMonthly:
		return "artist_basic"
	case prices.ArtistProAnnual, prices.ArtistProMonthly:
		return "artist_pro"
	case prices.FestivalAnnual:
		return "festival_annual"
	default:
		return "unknown"
	}
}

// IntervalFromPriceID returns "year" or "month" for a given price ID.
func IntervalFromPriceID(priceID string, prices Prices) string {

	switch priceID {
	case prices.ArtistBasicAnnual, prices.ArtistProAnnual, prices.FestivalAnnual:
		return "year"
	default:
		return "month"
	}
}
```

- [ ] **Step 4: Build**

```bash
cd api && go build ./internal/billing/...
```

---

## Task 4: Webhook endpoint

**Files:**
- Create: `api/internal/billing/webhook.go`
- Create: `api/internal/billing/webhook_test.go`

- [ ] **Step 1: Write failing test**

```go
// api/internal/billing/webhook_test.go
package billing_test

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"

	"github.com/sniffins-mcmuggins/render/api/internal/billing"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

const testWebhookSecret = "whsec_test"

func stripeSignature(payload []byte, secret string) string {
	ts := fmt.Sprintf("%d", time.Now().Unix())
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(ts + "." + string(payload)))
	sig := hex.EncodeToString(mac.Sum(nil))
	return fmt.Sprintf("t=%s,v1=%s", ts, sig)
}

func TestWebhookHandler_InvalidSignature(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	prices := billing.Prices{}
	handler := billing.WebhookHandler(db, "wrong-secret", prices)

	body := []byte(`{"type":"customer.subscription.created"}`)
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/billing/webhook",
		bytes.NewReader(body))
	r.Header.Set("Stripe-Signature", stripeSignature(body, testWebhookSecret))
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestWebhookHandler_ValidSignature_UnknownEvent(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	prices := billing.Prices{}
	handler := billing.WebhookHandler(db, testWebhookSecret, prices)

	body := []byte(`{"type":"payment_intent.created","data":{"object":{}}}`)
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/billing/webhook",
		bytes.NewReader(body))
	r.Header.Set("Stripe-Signature", stripeSignature(body, testWebhookSecret))
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	assert.Equal(t, http.StatusOK, w.Code, "unknown events must 200 OK to prevent Stripe retries")
}
```

- [ ] **Step 2: Run test to confirm failure**

```bash
cd api && go test ./internal/billing/... -run TestWebhook -v
```

Expected: compilation failure.

- [ ] **Step 3: Write webhook.go**

```go
// api/internal/billing/webhook.go
package billing

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stripe/stripe-go/v82"
	"github.com/stripe/stripe-go/v82/webhook"

	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

// WebhookHandler handles POST /billing/webhook.
func WebhookHandler(pool *pgxpool.Pool, webhookSecret string, prices Prices) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			httperr.BadRequest(w, "failed to read body")
			return
		}

		event, err := webhook.ConstructEvent(body, r.Header.Get("Stripe-Signature"), webhookSecret)
		if err != nil {
			slog.Warn("stripe webhook signature invalid", "err", err)
			httperr.BadRequest(w, "invalid signature")
			return
		}

		switch event.Type {
		case "customer.subscription.created", "customer.subscription.updated":
			handleSubscriptionUpsert(r.Context(), pool, event, prices)
		case "customer.subscription.deleted":
			handleSubscriptionDeleted(r.Context(), pool, event)
		case "checkout.session.completed":
			handleCheckoutCompleted(r.Context(), pool, event, prices)
		case "invoice.payment_failed":
			handlePaymentFailed(r.Context(), pool, event)
		default:
			// Unknown events: log and return 200 to prevent Stripe retries.
			slog.Debug("unhandled stripe event", "type", event.Type)
		}

		w.WriteHeader(http.StatusOK)
	}
}

func handleSubscriptionUpsert(ctx context.Context, pool *pgxpool.Pool, event stripe.Event, prices Prices) {
	var sub stripe.Subscription
	if err := json.Unmarshal(event.Data.Raw, &sub); err != nil {
		slog.Error("unmarshal subscription", "err", err)
		return
	}
	if len(sub.Items.Data) == 0 {
		return
	}
	priceID := sub.Items.Data[0].Price.ID
	plan := PlanFromPriceID(priceID, prices)
	interval := IntervalFromPriceID(priceID, prices)

	q := sqlcdb.New(pool)
	_, err := q.UpsertSubscription(ctx, sqlcdb.UpsertSubscriptionParams{
		UserID:               pgUUIDFromMeta(sub.Metadata["user_id"]),
		FestivalID:           pgUUIDNullable(sub.Metadata["festival_id"]),
		StripeSubscriptionID: pgtype.Text{String: sub.ID, Valid: true},
		StripePriceID:        priceID,
		Plan:                 plan,
		BillingInterval:      interval,
		Status:               string(sub.Status),
		CurrentPeriodEnd:     pgTimestampFromUnix(sub.CurrentPeriodEnd),
	})
	if err != nil {
		slog.Error("upsert subscription", "id", sub.ID, "err", err)
	}
}

func handleSubscriptionDeleted(ctx context.Context, pool *pgxpool.Pool, event stripe.Event) {
	var sub stripe.Subscription
	if err := json.Unmarshal(event.Data.Raw, &sub); err != nil {
		return
	}
	q := sqlcdb.New(pool)
	existing, err := q.GetSubscriptionByStripeID(ctx, sub.ID)
	if err != nil {
		return
	}
	// Mark as canceled via UpsertSubscription
	_, _ = q.UpsertSubscription(ctx, sqlcdb.UpsertSubscriptionParams{
		UserID:               existing.UserID,
		FestivalID:           existing.FestivalID,
		StripeSubscriptionID: pgtype.Text{String: sub.ID, Valid: true},
		StripePriceID:        existing.StripePriceID,
		Plan:                 existing.Plan,
		BillingInterval:      existing.BillingInterval,
		Status:               "canceled",
		CurrentPeriodEnd:     existing.CurrentPeriodEnd,
	})
}

func handleCheckoutCompleted(ctx context.Context, pool *pgxpool.Pool, event stripe.Event, prices Prices) {
	var session stripe.CheckoutSession
	if err := json.Unmarshal(event.Data.Raw, &session); err != nil {
		return
	}
	q := sqlcdb.New(pool)
	_, err := q.MarkOrgPaymentPaid(ctx, sqlcdb.MarkOrgPaymentPaidParams{
		StripeCheckoutSessionID: pgtype.Text{String: session.ID, Valid: true},
		StripePaymentIntentID:   pgtype.Text{String: session.PaymentIntentID, Valid: true},
	})
	if err != nil {
		slog.Debug("no matching organiser_payment for session", "session", session.ID)
	}
}

func handlePaymentFailed(ctx context.Context, pool *pgxpool.Pool, event stripe.Event) {
	var inv stripe.Invoice
	if err := json.Unmarshal(event.Data.Raw, &inv); err != nil {
		return
	}
	if inv.Subscription == nil {
		return
	}
	q := sqlcdb.New(pool)
	existing, err := q.GetSubscriptionByStripeID(ctx, inv.Subscription.ID)
	if err != nil {
		return
	}
	_, _ = q.UpsertSubscription(ctx, sqlcdb.UpsertSubscriptionParams{
		UserID: existing.UserID, FestivalID: existing.FestivalID,
		StripeSubscriptionID: pgtype.Text{String: inv.Subscription.ID, Valid: true},
		StripePriceID:        existing.StripePriceID, Plan: existing.Plan,
		BillingInterval: existing.BillingInterval, Status: "past_due",
		CurrentPeriodEnd: existing.CurrentPeriodEnd,
	})
}

// Helpers for pgtype conversions in the webhook handler.
func pgUUIDFromMeta(s string) pgtype.UUID {
	parsed, _ := uuid.Parse(s)
	return pgtype.UUID{Bytes: [16]byte(parsed), Valid: s != ""}
}

func pgUUIDNullable(s string) pgtype.UUID {
	if s == "" {
		return pgtype.UUID{}
	}
	return pgUUIDFromMeta(s)
}

func pgTimestampFromUnix(unix int64) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: time.Unix(unix, 0), Valid: true}
}
```

Add `"context"`, `"github.com/google/uuid"` imports as needed.

- [ ] **Step 4: Run tests**

```bash
cd api && go test ./internal/billing/... -run TestWebhook -v
```

Expected: both tests pass.

---

## Task 5: Artist checkout handler

**Files:**
- Create: `api/internal/billing/artist.go`
- Create: `api/internal/billing/artist_test.go`

- [ ] **Step 1: Write failing test**

```go
// api/internal/billing/artist_test.go
package billing_test

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/sniffins-mcmuggins/render/api/internal/billing"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

func TestArtistCheckout_Unauthenticated(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := billing.NewStripeClient("sk_test_stub")
	handler := billing.ArtistCheckoutHandler(db, sc, billing.Prices{}, "http://localhost:3000")

	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/billing/artist/checkout",
		bytes.NewBufferString(`{"price_id":"price_basic_annual"}`))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}
```

- [ ] **Step 2: Write artist.go**

```go
// api/internal/billing/artist.go
package billing

import (
	"encoding/json"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stripe/stripe-go/v82"
	"github.com/stripe/stripe-go/v82/checkout/session"
	"github.com/stripe/stripe-go/v82/client"
	"github.com/stripe/stripe-go/v82/customer"

	authctx "github.com/sniffins-mcmuggins/render/api/internal/auth/ctx"
	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

type artistCheckoutRequest struct {
	PriceID string `json:"price_id"`
}

// ArtistCheckoutHandler handles POST /billing/artist/checkout.
// Returns {checkout_url} pointing to a Stripe-hosted Checkout page.
func ArtistCheckoutHandler(pool *pgxpool.Pool, sc *client.API, prices Prices, siteBase string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims := authctx.ClaimsFromContext(r.Context())
		if claims == nil {
			httperr.Write(w, http.StatusUnauthorized, "Unauthorized", "authentication required")
			return
		}

		var req artistCheckoutRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.BadRequest(w, "invalid request body")
			return
		}

		validPrices := map[string]bool{
			prices.ArtistBasicAnnual: true, prices.ArtistBasicMonthly: true,
			prices.ArtistProAnnual: true, prices.ArtistProMonthly: true,
		}
		if !validPrices[req.PriceID] {
			httperr.BadRequest(w, "invalid price_id")
			return
		}

		q := sqlcdb.New(pool)
		userUUID, err := pgUUIDFromString(claims.Subject)
		if err != nil {
			httperr.BadRequest(w, "invalid user id")
			return
		}

		// Get or create Stripe customer
		stripeCustomerID, err := getOrCreateStripeCustomer(r.Context(), q, sc, userUUID, claims.Subject)
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
				Metadata: map[string]string{"user_id": claims.Subject},
			},
		}

		sess, err := session.New(params)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"checkout_url": sess.URL})
	}
}

func getOrCreateStripeCustomer(ctx context.Context, q *sqlcdb.Queries, sc *client.API, userUUID pgtype.UUID, userIDStr string) (string, error) {
	row, err := q.GetUserStripeCustomerID(ctx, userUUID)
	if err == nil && row.StripeCustomerID.Valid {
		return row.StripeCustomerID.String, nil
	}

	user, err := q.GetUserByID(ctx, userUUID)
	if err != nil {
		return "", err
	}

	cust, err := customer.New(&stripe.CustomerParams{
		Email: stripe.String(user.Email),
		Metadata: map[string]string{"user_id": userIDStr},
	})
	if err != nil {
		return "", err
	}

	_ = q.SetUserStripeCustomerID(ctx, sqlcdb.SetUserStripeCustomerIDParams{
		ID:               userUUID,
		StripeCustomerID: pgtype.Text{String: cust.ID, Valid: true},
	})
	return cust.ID, nil
}
```

Add missing imports: `"context"`, `"github.com/jackc/pgx/v5/pgtype"`, `pgUUIDFromString` from auth package (or duplicate the helper locally).

- [ ] **Step 3: Run tests**

```bash
cd api && go test ./internal/billing/... -run TestArtistCheckout -v
```

Expected: `TestArtistCheckout_Unauthenticated` passes.

---

## Task 6: Organiser setup checkout

**Files:**
- Create: `api/internal/billing/organiser.go`

- [ ] **Step 1: Write organiser.go**

```go
// api/internal/billing/organiser.go
package billing

import (
	"encoding/json"
	"net/http"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stripe/stripe-go/v82"
	stripesession "github.com/stripe/stripe-go/v82/checkout/session"
	"github.com/stripe/stripe-go/v82/client"

	authctx "github.com/sniffins-mcmuggins/render/api/internal/auth/ctx"
	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

// OrgSetupCheckoutHandler handles POST /billing/organiser/setup-checkout.
// Creates a Stripe Checkout for the £35 one-time setup fee.
func OrgSetupCheckoutHandler(pool *pgxpool.Pool, sc *client.API, prices Prices, siteBase string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims := authctx.ClaimsFromContext(r.Context())
		if claims == nil || claims.Role != "organiser" {
			httperr.Write(w, http.StatusForbidden, "Forbidden", "organiser account required")
			return
		}

		userUUID, err := pgUUIDFromString(claims.Subject)
		if err != nil {
			httperr.BadRequest(w, "invalid user id")
			return
		}

		q := sqlcdb.New(pool)

		// Check if setup fee already paid
		paid, err := q.HasPaidSetupFee(r.Context(), userUUID)
		if err == nil && paid {
			httperr.Write(w, http.StatusConflict, "Conflict", "setup fee already paid")
			return
		}

		stripeCustomerID, err := getOrCreateStripeCustomer(r.Context(), q, sc, userUUID, claims.Subject)
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
			PaymentIntentData: &stripe.CheckoutSessionPaymentIntentDataParams{
				Metadata: map[string]string{"user_id": claims.Subject, "charge_type": "setup_fee"},
			},
		}

		sess, err := stripesession.New(params)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		// Record as pending payment
		_, _ = q.CreateOrgPayment(r.Context(), sqlcdb.CreateOrgPaymentParams{
			UserID:                  userUUID,
			FestivalID:              pgtype.UUID{},
			StripeCheckoutSessionID: pgtype.Text{String: sess.ID, Valid: true},
			ChargeType:              "setup_fee",
			AmountPence:             3500,
		})

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"checkout_url": sess.URL})
	}
}
```

---

## Task 7: Festival activation checkout + annual subscription trigger

**Files:**
- Create: `api/internal/billing/festival.go`

When the `checkout.session.completed` webhook fires for a `festival_month` payment, the webhook handler also creates a Stripe Subscription for the `festival_annual` price — set to start after the festival's end date.

- [ ] **Step 1: Write festival.go**

```go
// api/internal/billing/festival.go
package billing

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stripe/stripe-go/v82"
	stripesession "github.com/stripe/stripe-go/v82/checkout/session"
	"github.com/stripe/stripe-go/v82/client"

	authctx "github.com/sniffins-mcmuggins/render/api/internal/auth/ctx"
	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

// FestivalActivateCheckoutHandler handles POST /billing/festival/{festivalID}/activate-checkout.
// Creates a Stripe Checkout for the £99 festival month fee.
func FestivalActivateCheckoutHandler(pool *pgxpool.Pool, sc *client.API, prices Prices, siteBase string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims := authctx.ClaimsFromContext(r.Context())
		if claims == nil || claims.Role != "organiser" {
			httperr.Write(w, http.StatusForbidden, "Forbidden", "organiser account required")
			return
		}

		festivalIDStr := chi.URLParam(r, "festivalID")
		festivalUUID, err := pgUUIDFromString(festivalIDStr)
		if err != nil {
			httperr.BadRequest(w, "invalid festival id")
			return
		}

		userUUID, _ := pgUUIDFromString(claims.Subject)
		q := sqlcdb.New(pool)

		// Must have paid setup fee
		paid, _ := q.HasPaidSetupFee(r.Context(), userUUID)
		if !paid {
			httperr.Write(w, http.StatusPaymentRequired, "Payment Required", "organiser setup fee not paid")
			return
		}

		// Must not already be activated
		activated, _ := q.HasActiveFestivalMonth(r.Context(), sqlcdb.HasActiveFestivalMonthParams{
			UserID: userUUID, FestivalID: festivalUUID,
		})
		if activated {
			httperr.Write(w, http.StatusConflict, "Conflict", "festival already activated")
			return
		}

		stripeCustomerID, err := getOrCreateStripeCustomer(r.Context(), q, sc, userUUID, claims.Subject)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		params := &stripe.CheckoutSessionParams{
			Customer: stripe.String(stripeCustomerID),
			Mode:     stripe.String(string(stripe.CheckoutSessionModePayment)),
			LineItems: []*stripe.CheckoutSessionLineItemParams{
				{Price: stripe.String(prices.FestivalMonth), Quantity: stripe.Int64(1)},
			},
			SuccessURL: stripe.String(siteBase + "/organiser/festivals/" + festivalIDStr + "?activated=true"),
			CancelURL:  stripe.String(siteBase + "/organiser/festivals/" + festivalIDStr),
			PaymentIntentData: &stripe.CheckoutSessionPaymentIntentDataParams{
				Metadata: map[string]string{
					"user_id":    claims.Subject,
					"festival_id": festivalIDStr,
					"charge_type": "festival_month",
				},
			},
		}

		sess, err := stripesession.New(params)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		_, _ = q.CreateOrgPayment(r.Context(), sqlcdb.CreateOrgPaymentParams{
			UserID:                  userUUID,
			FestivalID:              festivalUUID,
			StripeCheckoutSessionID: pgtype.Text{String: sess.ID, Valid: true},
			ChargeType:              "festival_month",
			AmountPence:             9900,
		})

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"checkout_url": sess.URL})
	}
}
```

Add missing `"github.com/go-chi/chi/v5"` import.

- [ ] **Step 2: Extend webhook.go to start annual subscription after festival_month payment**

In `handleCheckoutCompleted` in `webhook.go`, after marking the payment paid, check if it was a `festival_month` charge and if so, create the annual subscription:

```go
func handleCheckoutCompleted(ctx context.Context, pool *pgxpool.Pool, event stripe.Event, prices Prices) {
	// ... existing code to MarkOrgPaymentPaid ...

	// If this was a festival_month payment, start the annual subscription
	var sess stripe.CheckoutSession
	if err := json.Unmarshal(event.Data.Raw, &sess); err != nil {
		return
	}
	chargeType := sess.PaymentIntentData.Metadata["charge_type"] // Note: PaymentIntentData not always populated in webhook
	// Alternative: store charge_type in sess.Metadata directly. Use Metadata on CheckoutSession:
	// Add Metadata to CheckoutSessionParams in FestivalActivateCheckoutHandler:
	//   Metadata: map[string]string{"charge_type": "festival_month", "festival_id": ..., "user_id": ...}

	if sess.Metadata["charge_type"] == "festival_month" {
		startAnnualFestivalSubscription(ctx, pool, prices, sess)
	}
}

func startAnnualFestivalSubscription(ctx context.Context, pool *pgxpool.Pool, prices Prices, sess stripe.CheckoutSession) {
	// Create Stripe subscription for festival_annual price
	// starting at trial_end = festival_end_date (if available) or now+30 days as default
	annualStart := time.Now().AddDate(0, 1, 0).Unix()

	sub, err := stripesubscription.New(&stripe.SubscriptionParams{
		Customer:  stripe.String(sess.Customer.ID),
		BillingCycleAnchor: stripe.Int64(annualStart),
		Items: []*stripe.SubscriptionItemsParams{
			{Price: stripe.String(prices.FestivalAnnual)},
		},
		Metadata: map[string]string{
			"user_id":    sess.Metadata["user_id"],
			"festival_id": sess.Metadata["festival_id"],
		},
		TrialEnd: stripe.Int64(annualStart),
	})
	if err != nil {
		slog.Error("create festival annual subscription", "err", err)
		return
	}
	slog.Info("festival annual subscription created", "sub_id", sub.ID)
}
```

Add `stripesubscription "github.com/stripe/stripe-go/v82/subscription"` import and update `FestivalActivateCheckoutHandler` to pass `Metadata` at the session level (not `PaymentIntentData`).

---

## Task 8: Customer Portal handler

**Files:**
- Create: `api/internal/billing/portal.go`

- [ ] **Step 1: Write portal.go**

```go
// api/internal/billing/portal.go
package billing

import (
	"encoding/json"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stripe/stripe-go/v82"
	"github.com/stripe/stripe-go/v82/billingportal/session"
	"github.com/stripe/stripe-go/v82/client"

	authctx "github.com/sniffins-mcmuggins/render/api/internal/auth/ctx"
	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

// CustomerPortalHandler handles POST /billing/portal.
// Returns {portal_url} pointing to the Stripe Customer Portal.
func CustomerPortalHandler(pool *pgxpool.Pool, sc *client.API, siteBase string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims := authctx.ClaimsFromContext(r.Context())
		if claims == nil {
			httperr.Write(w, http.StatusUnauthorized, "Unauthorized", "authentication required")
			return
		}

		userUUID, err := pgUUIDFromString(claims.Subject)
		if err != nil {
			httperr.BadRequest(w, "invalid user id")
			return
		}

		q := sqlcdb.New(pool)
		row, err := q.GetUserStripeCustomerID(r.Context(), userUUID)
		if err != nil || !row.StripeCustomerID.Valid {
			httperr.Write(w, http.StatusNotFound, "Not Found", "no billing account found")
			return
		}

		params := &stripe.BillingPortalSessionParams{
			Customer:  stripe.String(row.StripeCustomerID.String),
			ReturnURL: stripe.String(siteBase + "/billing"),
		}
		sess, err := session.New(params)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"portal_url": sess.URL})
	}
}
```

---

## Task 9: Tier enforcement middleware

**Files:**
- Create: `api/internal/billing/middleware.go`
- Create: `api/internal/billing/middleware_test.go`

- [ ] **Step 1: Write failing test**

```go
// api/internal/billing/middleware_test.go
package billing_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/sniffins-mcmuggins/render/api/internal/billing"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

func TestRequirePlan_NoSubscription_Returns403(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	middleware := billing.RequirePlan(db, "artist_pro")

	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	handler := middleware(next)

	// Request with no auth (no user claims in context)
	r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	assert.Equal(t, http.StatusForbidden, w.Code)
}
```

- [ ] **Step 2: Run test to confirm failure**

```bash
cd api && go test ./internal/billing/... -run TestRequirePlan -v
```

Expected: compilation failure.

- [ ] **Step 3: Write middleware.go**

```go
// api/internal/billing/middleware.go
package billing

import (
	"encoding/json"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"

	authctx "github.com/sniffins-mcmuggins/render/api/internal/auth/ctx"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

// RequirePlan returns middleware that gates a handler on the user having
// an active subscription at the given plan level ("artist_basic" | "artist_pro").
func RequirePlan(pool *pgxpool.Pool, requiredPlan string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims := authctx.ClaimsFromContext(r.Context())
			if claims == nil {
				writeUpgradeRequired(w, requiredPlan)
				return
			}

			userUUID, err := pgUUIDFromString(claims.Subject)
			if err != nil {
				writeUpgradeRequired(w, requiredPlan)
				return
			}

			q := sqlcdb.New(pool)
			sub, err := q.GetActiveSubscription(r.Context(), sqlcdb.GetActiveSubscriptionParams{
				UserID: userUUID, FestivalID: pgtype.UUID{},
			})
			if err != nil {
				writeUpgradeRequired(w, requiredPlan)
				return
			}

			// Check plan hierarchy: artist_pro satisfies artist_pro only; artist_basic satisfies artist_basic
			if !planSatisfies(sub.Plan, requiredPlan) {
				writeUpgradeRequired(w, requiredPlan)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// planSatisfies returns true if the user's plan meets or exceeds the required plan.
func planSatisfies(userPlan, required string) bool {
	order := map[string]int{"artist_basic": 1, "artist_pro": 2}
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
```

Add `"github.com/jackc/pgx/v5/pgtype"` import.

- [ ] **Step 4: Run tests**

```bash
cd api && go test ./internal/billing/... -v
```

Expected: all billing tests pass.

---

## Task 10: Register billing routes in main.go

**Files:**
- Modify: `api/cmd/api/main.go`

- [ ] **Step 1: Add billing routes**

In `cmd/api/main.go`, initialise the Stripe client and register billing routes:

```go
import (
    "github.com/sniffins-mcmuggins/render/api/internal/billing"
)

// After existing setup:
stripeClient := billing.NewStripeClient(cfg.StripeSecretKey)
billingPrices := billing.Prices{
    ArtistBasicAnnual:  cfg.StripeArtistBasicAnnualPrice,
    ArtistBasicMonthly: cfg.StripeArtistBasicMonthlyPrice,
    ArtistProAnnual:    cfg.StripeArtistProAnnualPrice,
    ArtistProMonthly:   cfg.StripeArtistProMonthlyPrice,
    OrgSetup:           cfg.StripeOrgSetupPrice,
    FestivalMonth:      cfg.StripeFestivalMonthPrice,
    FestivalAnnual:     cfg.StripeFestivalAnnualPrice,
}
siteBase := cfg.OAuthRedirectBase // reuse same base URL config

// Billing routes
r.Post("/billing/webhook",          billing.WebhookHandler(pool, cfg.StripeWebhookSecret, billingPrices))
r.Post("/billing/artist/checkout",  billing.ArtistCheckoutHandler(pool, stripeClient, billingPrices, siteBase))
r.Post("/billing/organiser/setup-checkout", billing.OrgSetupCheckoutHandler(pool, stripeClient, billingPrices, siteBase))
r.Post("/billing/festival/{festivalID}/activate-checkout", billing.FestivalActivateCheckoutHandler(pool, stripeClient, billingPrices, siteBase))
r.Post("/billing/portal",           billing.CustomerPortalHandler(pool, stripeClient, siteBase))
```

- [ ] **Step 2: Build**

```bash
cd api && go build ./...
```

Expected: no errors.

- [ ] **Step 3: Add Stripe CLI local webhook testing setup**

In the root `Taskfile.yml`, add:

```yaml
billing:stripe-listen:
  desc: Forward Stripe webhooks to local API
  cmd: stripe listen --forward-to localhost:8080/billing/webhook
```

- [ ] **Step 4: Commit**

```bash
git add api/ db/
git commit -m "feat(billing): E13 — Stripe payments, subscriptions, webhooks, tier enforcement"
```

---

## Task 11: Web — PricingCard component

**Files:**
- Create: `web/src/components/PricingCard.tsx`

- [ ] **Step 1: Write PricingCard.tsx**

```tsx
// web/src/components/PricingCard.tsx
interface PricingCardProps {
  name: string
  annualPrice: string
  monthlyPrice: string
  features: string[]
  highlight?: boolean
  ctaLabel: string
  onCTA: () => void
  current?: boolean
}

export function PricingCard({
  name, annualPrice, monthlyPrice, features, highlight, ctaLabel, onCTA, current
}: PricingCardProps) {
  return (
    <div style={{
      border: highlight ? '2px solid var(--amber)' : '1px solid var(--light)',
      borderRadius: '12px',
      padding: '2rem',
      background: 'var(--offwhite)',
      display: 'flex',
      flexDirection: 'column',
      gap: '1rem',
      minWidth: '260px',
    }}>
      <div>
        <p style={{ fontFamily: 'DM Mono, monospace', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--mid)' }}>{name}</p>
        <p style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '2.5rem', color: 'var(--ink)', lineHeight: 1 }}>{annualPrice}<span style={{ fontSize: '1rem', color: 'var(--mid)' }}>/yr</span></p>
        <p style={{ color: 'var(--mid)', fontSize: '0.875rem' }}>or {monthlyPrice}/mo</p>
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {features.map((f) => (
          <li key={f} style={{ color: 'var(--ink)', fontSize: '0.9rem', display: 'flex', gap: '0.5rem' }}>
            <span style={{ color: 'var(--amber)' }}>✓</span> {f}
          </li>
        ))}
      </ul>
      {current ? (
        <p style={{ textAlign: 'center', color: 'var(--mid)', fontWeight: 600, padding: '0.75rem' }}>Current plan</p>
      ) : (
        <button onClick={onCTA} style={{
          background: highlight ? 'var(--amber)' : 'transparent',
          color: highlight ? 'var(--ink)' : 'var(--amber)',
          border: highlight ? 'none' : '2px solid var(--amber)',
          borderRadius: '6px',
          padding: '0.75rem',
          fontWeight: 600,
          cursor: 'pointer',
        }}>
          {ctaLabel}
        </button>
      )}
    </div>
  )
}
```

---

## Task 12: Web — artist billing page

**Files:**
- Create: `web/src/app/(artist)/billing/page.tsx`

- [ ] **Step 1: Write billing/page.tsx**

```tsx
// web/src/app/(artist)/billing/page.tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiClient } from '@/lib/api'
import { PricingCard } from '@/components/PricingCard'

const PLANS = {
  basic: {
    name: 'Basic',
    annualPrice: '£15',
    monthlyPrice: '£2',
    annualPriceId: process.env.NEXT_PUBLIC_STRIPE_ARTIST_BASIC_ANNUAL ?? '',
    monthlyPriceId: process.env.NEXT_PUBLIC_STRIPE_ARTIST_BASIC_MONTHLY ?? '',
    features: ['1 collection', 'Public artist profile', 'Festival applications'],
  },
  pro: {
    name: 'Pro',
    annualPrice: '£25',
    monthlyPrice: '£4',
    annualPriceId: process.env.NEXT_PUBLIC_STRIPE_ARTIST_PRO_ANNUAL ?? '',
    monthlyPriceId: process.env.NEXT_PUBLIC_STRIPE_ARTIST_PRO_MONTHLY ?? '',
    features: ['Up to 5 collections', 'Everything in Basic', 'Priority in search results'],
    highlight: true,
  },
}

export default function ArtistBillingPage() {
  const [interval, setInterval] = useState<'year' | 'month'>('year')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleUpgrade(priceId: string) {
    setLoading(true)
    const { data } = await apiClient.POST('/billing/artist/checkout', {
      body: { price_id: priceId },
    })
    if (data?.checkout_url) {
      window.location.href = data.checkout_url
    }
    setLoading(false)
  }

  async function handleManage() {
    const { data } = await apiClient.POST('/billing/portal', {})
    if (data?.portal_url) {
      window.location.href = data.portal_url
    }
  }

  return (
    <main className="max-w-3xl mx-auto px-6 py-12">
      <h1 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '2.5rem', marginBottom: '0.5rem' }}>Artist plans</h1>
      <p style={{ color: 'var(--mid)', marginBottom: '2rem' }}>All plans include a public profile and festival applications. Upgrade for more collections.</p>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '2rem' }}>
        {(['year', 'month'] as const).map((i) => (
          <button key={i} onClick={() => setInterval(i)} style={{
            padding: '0.5rem 1.25rem', borderRadius: '6px', border: '1px solid var(--light)',
            background: interval === i ? 'var(--ink)' : 'transparent',
            color: interval === i ? 'var(--offwhite)' : 'var(--ink)',
            fontWeight: 600, cursor: 'pointer',
          }}>
            {i === 'year' ? 'Annual (save ~17%)' : 'Monthly'}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
        {Object.entries(PLANS).map(([key, plan]) => (
          <PricingCard
            key={key}
            name={plan.name}
            annualPrice={plan.annualPrice}
            monthlyPrice={plan.monthlyPrice}
            features={plan.features}
            highlight={'highlight' in plan ? plan.highlight : false}
            ctaLabel={loading ? 'Loading...' : `Get ${plan.name}`}
            onCTA={() => handleUpgrade(interval === 'year' ? plan.annualPriceId : plan.monthlyPriceId)}
          />
        ))}
      </div>

      <div style={{ marginTop: '3rem', padding: '1.5rem', background: 'var(--warm)', borderRadius: '8px' }}>
        <p style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Already subscribed?</p>
        <button onClick={handleManage} style={{ color: 'var(--amber)', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          Manage billing →
        </button>
      </div>
    </main>
  )
}
```

- [ ] **Step 2: Add public env vars to web**

In `web/.env.local` (not committed — document in `.env.example`):

```
NEXT_PUBLIC_STRIPE_ARTIST_BASIC_ANNUAL=price_xxx
NEXT_PUBLIC_STRIPE_ARTIST_BASIC_MONTHLY=price_xxx
NEXT_PUBLIC_STRIPE_ARTIST_PRO_ANNUAL=price_xxx
NEXT_PUBLIC_STRIPE_ARTIST_PRO_MONTHLY=price_xxx
```

---

## Task 13: Web — organiser billing page

**Files:**
- Create: `web/src/app/organiser/billing/page.tsx`

- [ ] **Step 1: Write organiser/billing/page.tsx**

```tsx
// web/src/app/organiser/billing/page.tsx
'use client'
import { apiClient } from '@/lib/api'

async function handleSetup() {
  const { data } = await apiClient.POST('/billing/organiser/setup-checkout', {})
  if (data?.checkout_url) window.location.href = data.checkout_url
}

async function handleManage() {
  const { data } = await apiClient.POST('/billing/portal', {})
  if (data?.portal_url) window.location.href = data.portal_url
}

export default function OrgBillingPage() {
  return (
    <main className="max-w-2xl mx-auto px-6 py-12">
      <h1 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '2.5rem', marginBottom: '2rem' }}>Organiser billing</h1>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        <div style={{ border: '1px solid var(--light)', borderRadius: '12px', padding: '2rem' }}>
          <h2 style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Setup fee</h2>
          <p style={{ color: 'var(--mid)', marginBottom: '1rem' }}>One-time £35 to activate your organiser account and publish your first festival.</p>
          <button onClick={handleSetup} style={{ background: 'var(--amber)', color: 'var(--ink)', fontWeight: 600, border: 'none', borderRadius: '6px', padding: '0.75rem 1.5rem', cursor: 'pointer' }}>
            Pay setup fee — £35
          </button>
        </div>

        <div style={{ border: '1px solid var(--light)', borderRadius: '12px', padding: '2rem' }}>
          <h2 style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Festival costs</h2>
          <ul style={{ color: 'var(--mid)', listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <li>£99 — Festival activation (one-off, per festival)</li>
            <li>£49/yr — Annual listing fee (keeps festival page live after the event)</li>
          </ul>
          <p style={{ marginTop: '1rem', fontSize: '0.875rem', color: 'var(--mid)' }}>Festival activation is paid from the festival's edit page once your application form is ready.</p>
        </div>

        <div style={{ borderTop: '1px solid var(--light)', paddingTop: '1.5rem' }}>
          <button onClick={handleManage} style={{ color: 'var(--amber)', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            Manage billing & payment methods →
          </button>
        </div>
      </div>
    </main>
  )
}
```

- [ ] **Step 2: Final build + test run**

```bash
cd api && go build ./... && go test ./...
cd web && npx tsc --noEmit
```

Expected: no type errors, all tests pass.

- [ ] **Step 3: Test webhook locally with Stripe CLI**

```bash
task billing:stripe-listen
# In another terminal, trigger a test event:
stripe trigger customer.subscription.created
```

Confirm the webhook handler logs the event and no panics occur.

- [ ] **Step 4: Commit**

```bash
git add api/ db/ web/src/
git commit -m "feat(billing): E13 — Stripe web billing pages, PricingCard, organiser billing"
```

---

## Self-check: spec coverage

| Spec requirement | Covered by |
|-----------------|------------|
| Artist Basic £15/yr or £2/mo | Task 3 (Stripe products), Task 12 (web page) |
| Artist Pro £25/yr or £4/mo | Task 3, Task 12 |
| Organiser setup fee £35 | Task 6 |
| Festival month fee £99 | Task 7 |
| Festival annual £49/yr (auto-start after festival month) | Task 7 (webhook trigger) |
| Stripe webhook signature verification | Task 4 |
| Webhook handles subscription.created/updated/deleted | Task 4 |
| Webhook handles invoice.payment_failed → past_due | Task 4 |
| Customer Portal for self-service | Task 8 |
| Tier enforcement middleware | Task 9 |
| No free tier — every artist must pay | Task 5 (no free price ID) |
| DB: subscriptions + organiser_payments tables | Task 1 |
| Integration tests with Stripe CLI | Task 10 (stripe listen) |
| Artist billing page + PricingCard | Tasks 11–12 |
| Organiser billing page | Task 13 |
