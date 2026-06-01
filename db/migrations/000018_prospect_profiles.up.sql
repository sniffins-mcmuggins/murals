-- Make user_id nullable to support unclaimed prospect profiles.
ALTER TABLE artist_profiles ALTER COLUMN user_id DROP NOT NULL;

-- Replace the hard unique index with a partial one: NULLs (unclaimed) can
-- coexist freely; only non-NULL user_ids must be unique.
DROP INDEX artist_profiles_user_id_idx;
CREATE UNIQUE INDEX artist_profiles_user_id_idx
  ON artist_profiles (user_id) WHERE user_id IS NOT NULL;

-- Claim flow columns.
ALTER TABLE artist_profiles
  ADD COLUMN claim_token TEXT UNIQUE,
  ADD COLUMN claimed_at  TIMESTAMPTZ,
  ADD COLUMN created_by  UUID REFERENCES users(id);
