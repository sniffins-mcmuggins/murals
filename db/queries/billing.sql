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
