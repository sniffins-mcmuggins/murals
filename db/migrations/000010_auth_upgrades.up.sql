-- Make password_hash nullable for OAuth-only users
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- OAuth provider columns
ALTER TABLE users ADD COLUMN oauth_provider text;
ALTER TABLE users ADD COLUMN oauth_subject  text;

-- TOTP MFA columns
ALTER TABLE users ADD COLUMN mfa_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN mfa_secret  text;       -- AES-256-GCM encrypted, null until enrolled

-- Check constraint: oauth_provider and oauth_subject must both be NULL or both non-NULL
ALTER TABLE users ADD CONSTRAINT oauth_columns_consistent
  CHECK ((oauth_provider IS NULL AND oauth_subject IS NULL)
      OR (oauth_provider IS NOT NULL AND oauth_subject IS NOT NULL));

-- Unique constraint: one record per provider+subject
CREATE UNIQUE INDEX users_oauth_idx ON users (oauth_provider, oauth_subject)
  WHERE oauth_provider IS NOT NULL;

-- Password reset tokens
CREATE TABLE password_reset_tokens (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text        NOT NULL,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX password_reset_tokens_user_idx ON password_reset_tokens (user_id);
CREATE UNIQUE INDEX password_reset_tokens_hash_idx ON password_reset_tokens (token_hash);
CREATE INDEX password_reset_tokens_expires_idx ON password_reset_tokens (expires_at);
