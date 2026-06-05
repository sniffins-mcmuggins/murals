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
-- is_admin replaces the old user_role ENUM. Authorization is now ownership-
-- of-entity: "is an artist" = has a row in artist_profiles; "is an organiser"
-- = owns at least one festival. Admin is the only platform-level role.
--
-- Column order: id, email, password_hash, created_at, oauth, mfa, session,
-- stripe — then historically-appended columns (is_admin, beta fields,
-- email_verified) in the order they were added. Don't reorder without
-- regenerating sqlcdb/ and reviewing the User struct field order.
CREATE TABLE users (
    id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    email              text        NOT NULL,
    password_hash      text,
    created_at         timestamptz NOT NULL DEFAULT now(),
    oauth_provider     text,
    oauth_subject      text,
    mfa_enabled        boolean     NOT NULL DEFAULT false,
    mfa_secret         text,
    session_version    integer     NOT NULL DEFAULT 0,
    stripe_customer_id text,
    is_admin           boolean     NOT NULL DEFAULT false,
    is_beta            boolean     NOT NULL DEFAULT false,
    beta_cohort        varchar(100),
    invited_by         uuid        REFERENCES users(id) ON DELETE SET NULL,
    invited_via        uuid,
    email_verified     boolean     NOT NULL DEFAULT false,
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

-- Single-use email verification tokens — mirrors password_reset_tokens exactly.
CREATE TABLE email_verification_tokens (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash text        NOT NULL,
    expires_at timestamptz NOT NULL,
    used_at    timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX email_verification_tokens_user_idx ON email_verification_tokens (user_id);
CREATE UNIQUE INDEX email_verification_tokens_hash_idx ON email_verification_tokens (token_hash);
CREATE INDEX email_verification_tokens_expires_idx ON email_verification_tokens (expires_at);

-- Beta invite codes. users.invited_via references this table; the FK is
-- deferred to a constraint because beta_invites depends on users itself.
CREATE TABLE beta_invites (
    id         uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    code       varchar(64)  NOT NULL UNIQUE,
    created_by uuid         NOT NULL REFERENCES users(id),
    max_uses   integer      NOT NULL DEFAULT 3,
    used_count integer      NOT NULL DEFAULT 0,
    cohort     varchar(100) NOT NULL DEFAULT 'founding',
    expires_at timestamptz,
    created_at timestamptz  NOT NULL DEFAULT now()
);

ALTER TABLE users
    ADD CONSTRAINT users_invited_via_fkey
        FOREIGN KEY (invited_via) REFERENCES beta_invites(id) ON DELETE SET NULL;

-- Waitlist requests for prospective users before beta access is granted.
CREATE TABLE waitlist_requests (
    id         uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    email      varchar(255) NOT NULL UNIQUE,
    created_at timestamptz  NOT NULL DEFAULT now()
);
