-- Stripe-backed billing, admin access tools, and beta feedback.
--
-- subscriptions: recurring plans (artist Basic/Pro, festival annual). The
--   stripe_subscription_id is the source of truth — the row is upserted by
--   webhook handlers keyed on it.
-- organiser_payments: one-off charges (organiser setup fee, per-festival
--   activation). status transitions pending -> paid in the webhook (gated on
--   status='pending' to make the transition idempotent against Stripe
--   retries; see api/internal/billing/webhook.go).
-- promo_codes: distributable codes granting free platform access. max_uses
--   NULL = unlimited; expires_at NULL = never expires.
-- access_grants: free-access records for a user+plan, sourced from either a
--   direct admin grant or a promo code redemption. festival_id required when
--   plan = 'festival_activation'.
-- beta_feedback: in-app feedback submissions from beta users.
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

CREATE TABLE promo_codes (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    code          text        UNIQUE NOT NULL,
    plan          text        NOT NULL,
    duration_days integer     NOT NULL,
    max_uses      integer,
    use_count     integer     NOT NULL DEFAULT 0,
    expires_at    timestamptz,
    created_by    uuid        REFERENCES users(id) ON DELETE SET NULL,
    revoked_at    timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE access_grants (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan          text        NOT NULL,
    festival_id   uuid        REFERENCES festivals(id) ON DELETE SET NULL,
    valid_until   timestamptz NOT NULL,
    granted_by    uuid        REFERENCES users(id) ON DELETE SET NULL,
    promo_code_id uuid        REFERENCES promo_codes(id) ON DELETE SET NULL,
    note          text,
    revoked_at    timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX access_grants_plan_idx       ON access_grants (user_id, plan);
CREATE INDEX access_grants_promo_code_idx ON access_grants (promo_code_id) WHERE promo_code_id IS NOT NULL;

CREATE TABLE beta_feedback (
    id         uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind       varchar(20)  NOT NULL CHECK (kind IN ('idea', 'bug', 'direction', 'praise')),
    body       text         NOT NULL,
    admin_note text,
    created_at timestamptz  NOT NULL DEFAULT now()
);
