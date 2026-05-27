-- Stripe-backed billing.
--
-- subscriptions: recurring plans (artist Basic/Pro, festival annual). The
--   stripe_subscription_id is the source of truth — the row is upserted by
--   webhook handlers keyed on it.
-- organiser_payments: one-off charges (organiser setup fee, per-festival
--   activation). status transitions pending -> paid in the webhook (gated on
--   status='pending' to make the transition idempotent against Stripe
--   retries; see api/internal/billing/webhook.go).
--
-- users.stripe_customer_id is declared in 000001_users — kept on the user row
-- because customer creation is independent of having any specific charge.

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

CREATE INDEX subscriptions_user_idx     ON subscriptions (user_id);
CREATE INDEX subscriptions_festival_idx ON subscriptions (festival_id) WHERE festival_id IS NOT NULL;

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

CREATE INDEX organiser_payments_user_idx    ON organiser_payments (user_id);
CREATE INDEX organiser_payments_session_idx ON organiser_payments (stripe_checkout_session_id);
