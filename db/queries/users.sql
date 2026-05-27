-- name: CreateUser :one
INSERT INTO users (email, password_hash, role)
VALUES ($1, $2, $3)
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
INSERT INTO users (email, password_hash, role, oauth_provider, oauth_subject)
VALUES ($1, NULL, $2, $3, $4)
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
