-- Add email_verified flag to users.
-- Default false for new rows. Existing rows are grandfathered to true so
-- no currently-registered user is locked out when this migration runs.
ALTER TABLE users ADD COLUMN email_verified boolean NOT NULL DEFAULT false;
UPDATE users SET email_verified = true;

-- Single-use verification tokens — mirrors password_reset_tokens exactly.
CREATE TABLE email_verification_tokens (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash text        NOT NULL,
    expires_at timestamptz NOT NULL,
    used_at    timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX email_verification_tokens_user_idx
    ON email_verification_tokens (user_id);
CREATE UNIQUE INDEX email_verification_tokens_hash_idx
    ON email_verification_tokens (token_hash);
CREATE INDEX email_verification_tokens_expires_idx
    ON email_verification_tokens (expires_at);
