-- Sentinel: lets the health endpoint verify migrations ran without coupling
-- the check to a feature table. INSERT DEFAULT VALUES gives us a row whose
-- created_at marks first-migration time.
CREATE TABLE _migrations_health (
    applied_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO _migrations_health DEFAULT VALUES;

-- Users + auth.
--
-- password_hash is NULL-able to accommodate OAuth-only accounts (Google/Apple).
-- mfa_secret stores an AES-256-GCM-encrypted TOTP secret, NULL until enrolment.
-- session_version is bumped (e.g. by password reset) to invalidate every
-- outstanding JWT for the user — the auth middleware checks the JWT's sv
-- claim against this column on every authenticated request.
CREATE TYPE user_role AS ENUM ('artist', 'organiser', 'admin');

-- Column order preserves the historical schema (created_at before the
-- auth-upgrade columns; stripe_customer_id added last by billing) so this
-- consolidation is a no-op for sqlc-generated code. Don't reorder without
-- regenerating and reviewing the User struct.
CREATE TABLE users (
    id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    email              text        NOT NULL,
    password_hash      text,
    role               user_role   NOT NULL DEFAULT 'artist',
    created_at         timestamptz NOT NULL DEFAULT now(),
    oauth_provider     text,
    oauth_subject      text,
    mfa_enabled        boolean     NOT NULL DEFAULT false,
    mfa_secret         text,
    session_version    integer     NOT NULL DEFAULT 0,
    stripe_customer_id text,
    CONSTRAINT oauth_columns_consistent
        CHECK ((oauth_provider IS NULL AND oauth_subject IS NULL)
            OR (oauth_provider IS NOT NULL AND oauth_subject IS NOT NULL))
);

CREATE UNIQUE INDEX users_email_idx ON users (email);
CREATE UNIQUE INDEX users_oauth_idx ON users (oauth_provider, oauth_subject)
    WHERE oauth_provider IS NOT NULL;

-- Single-use password reset tokens. token_hash is the bcrypt/sha256 of the
-- random token sent to the user — never store the plaintext.
CREATE TABLE password_reset_tokens (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash text        NOT NULL,
    expires_at timestamptz NOT NULL,
    used_at    timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX password_reset_tokens_user_idx ON password_reset_tokens (user_id);
CREATE UNIQUE INDEX password_reset_tokens_hash_idx ON password_reset_tokens (token_hash);
CREATE INDEX password_reset_tokens_expires_idx ON password_reset_tokens (expires_at);
