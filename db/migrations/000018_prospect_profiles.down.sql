ALTER TABLE artist_profiles
  DROP COLUMN IF EXISTS created_by,
  DROP COLUMN IF EXISTS claimed_at,
  DROP COLUMN IF EXISTS claim_token;

DROP INDEX IF EXISTS artist_profiles_user_id_idx;
CREATE UNIQUE INDEX artist_profiles_user_id_idx ON artist_profiles (user_id);

ALTER TABLE artist_profiles ALTER COLUMN user_id SET NOT NULL;
