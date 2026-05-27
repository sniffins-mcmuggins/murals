-- name: ListUsers :many
SELECT id, email, is_admin, mfa_enabled, created_at
FROM users
WHERE (sqlc.arg(email)::text = '' OR email ILIKE '%' || sqlc.arg(email)::text || '%')
ORDER BY created_at DESC
LIMIT sqlc.arg(lim)::int
OFFSET sqlc.arg(off)::int;

-- name: CreateAccessGrant :one
INSERT INTO access_grants (user_id, plan, festival_id, valid_until, granted_by, promo_code_id, note)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: RevokeAccessGrant :exec
UPDATE access_grants
SET revoked_at = now()
WHERE id = $1 AND revoked_at IS NULL;

-- name: HasActiveGrant :one
-- $3 (festival_id): pass pgtype.UUID{} for non-festival plans; set for festival_activation checks.
SELECT EXISTS (
    SELECT 1 FROM access_grants
    WHERE user_id = $1
      AND plan = $2
      AND revoked_at IS NULL
      AND valid_until > now()
      AND (festival_id IS NULL OR festival_id = $3)
) AS has_grant;

-- name: ListActiveGrants :many
SELECT * FROM access_grants
WHERE user_id = $1 AND revoked_at IS NULL AND valid_until > now()
ORDER BY created_at DESC;

-- name: CreatePromoCode :one
INSERT INTO promo_codes (code, plan, duration_days, max_uses, expires_at, created_by)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: GetPromoCodeByCode :one
SELECT * FROM promo_codes WHERE code = $1;

-- name: GetPromoCodeByID :one
SELECT * FROM promo_codes WHERE id = $1;

-- name: ListPromoCodes :many
SELECT * FROM promo_codes ORDER BY created_at DESC;

-- name: RevokePromoCode :exec
UPDATE promo_codes
SET revoked_at = now()
WHERE id = $1 AND revoked_at IS NULL;

-- name: IncrementPromoUseCount :one
UPDATE promo_codes
SET use_count = use_count + 1
WHERE id = $1
  AND (max_uses IS NULL OR use_count < max_uses)
  AND revoked_at IS NULL
  AND (expires_at IS NULL OR expires_at > now())
RETURNING *;

-- name: HasRedeemedPromo :one
SELECT EXISTS (
    SELECT 1 FROM access_grants
    WHERE user_id = $1 AND promo_code_id = $2
) AS has_redeemed;
