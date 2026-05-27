-- name: CreateUser :one
INSERT INTO users (email, password_hash)
VALUES ($1, $2)
RETURNING *;

-- name: GetUserByEmail :one
SELECT * FROM users WHERE email = $1 LIMIT 1;

-- name: GetUserByID :one
SELECT * FROM users WHERE id = $1 LIMIT 1;

-- name: GetUserByOAuth :one
SELECT * FROM users
WHERE oauth_provider = $1 AND oauth_subject = $2
LIMIT 1;

-- name: CreateOAuthUser :one
-- Idempotent upsert keyed on (oauth_provider, oauth_subject). Two concurrent
-- first-login callbacks for the same OAuth identity will both succeed; the
-- second one returns the row inserted by the first (no unique-violation 500).
-- The DO UPDATE clause is a no-op write to make RETURNING * return a row.
INSERT INTO users (email, password_hash, oauth_provider, oauth_subject)
VALUES ($1, NULL, $2, $3)
ON CONFLICT (oauth_provider, oauth_subject) WHERE oauth_provider IS NOT NULL
DO UPDATE SET oauth_provider = EXCLUDED.oauth_provider
RETURNING *;

-- name: LinkOAuthToUser :one
UPDATE users
SET oauth_provider = $2, oauth_subject = $3
WHERE id = $1
RETURNING *;

-- name: SetMFAEnabled :one
UPDATE users
SET mfa_enabled = $2, mfa_secret = $3
WHERE id = $1
RETURNING *;

-- name: DisableMFA :one
UPDATE users
SET mfa_enabled = false, mfa_secret = NULL
WHERE id = $1
RETURNING *;

-- name: IncrementSessionVersion :one
-- Invalidates all outstanding JWTs for this user by bumping session_version.
-- Called from the password-reset flow; the auth middleware compares the value
-- baked into each JWT against this column and rejects any mismatch.
UPDATE users
SET session_version = session_version + 1
WHERE id = $1
RETURNING *;
