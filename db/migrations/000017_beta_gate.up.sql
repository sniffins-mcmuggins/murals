-- Add beta access columns to users table
ALTER TABLE users
  ADD COLUMN is_beta     boolean      NOT NULL DEFAULT false,
  ADD COLUMN beta_cohort varchar(100),
  ADD COLUMN invited_by  uuid         REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN invited_via uuid;

-- Beta invite codes table
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

-- Add foreign key constraint for invited_via
ALTER TABLE users
  ADD CONSTRAINT users_invited_via_fkey
    FOREIGN KEY (invited_via) REFERENCES beta_invites(id) ON DELETE SET NULL;

-- Waitlist requests table
CREATE TABLE waitlist_requests (
  id         uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  email      varchar(255) NOT NULL UNIQUE,
  created_at timestamptz  NOT NULL DEFAULT now()
);
