-- name: GetBetaInviteByCode :one
SELECT * FROM beta_invites WHERE code = $1 LIMIT 1;

-- name: CreateBetaInvite :one
INSERT INTO beta_invites (code, created_by, max_uses, cohort, expires_at)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: RedeemBetaInvite :one
-- Atomically increments used_count only when quota not yet exhausted.
-- Returns ErrNoRows if code is not found, quota is full, or invite has expired.
-- Caller must interpret ErrNoRows as 403 (code invalid or exhausted).
UPDATE beta_invites
SET used_count = used_count + 1
WHERE code = $1
  AND used_count < max_uses
  AND (expires_at IS NULL OR expires_at > now())
RETURNING *;

-- name: CreateBetaUser :one
-- Creates a user with is_beta=true and invite provenance fields set.
-- Use inside the beta-invite-gated signup transaction (see auth/signup.go).
INSERT INTO users (email, password_hash, is_beta, beta_cohort, invited_by, invited_via)
VALUES ($1, $2, true, $3, $4, $5)
RETURNING *;

-- name: UpsertWaitlistRequest :exec
INSERT INTO waitlist_requests (email)
VALUES ($1)
ON CONFLICT (email) DO NOTHING;

-- name: ListBetaInvites :many
SELECT * FROM beta_invites ORDER BY created_at DESC;

-- name: ListBetaInvitesByCreator :many
SELECT * FROM beta_invites WHERE created_by = $1 ORDER BY created_at DESC;

-- name: CountBetaInvitesByCreator :one
SELECT COUNT(*)::int FROM beta_invites WHERE created_by = $1;

-- name: ListBetaInviteesByInviter :many
SELECT id, email, beta_cohort, created_at
FROM users
WHERE invited_by = $1
ORDER BY created_at ASC;

-- name: CreateBetaFeedback :one
INSERT INTO beta_feedback (user_id, kind, body)
VALUES ($1, $2, $3)
RETURNING *;

-- name: ListBetaFeedbackByUser :many
SELECT * FROM beta_feedback WHERE user_id = $1 ORDER BY created_at DESC;

-- name: ListAllBetaFeedback :many
SELECT * FROM beta_feedback ORDER BY created_at DESC;

-- name: UpdateBetaFeedbackNote :one
UPDATE beta_feedback SET admin_note = $2 WHERE id = $1 RETURNING *;
