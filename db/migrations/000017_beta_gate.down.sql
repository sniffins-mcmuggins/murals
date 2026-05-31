-- Drop waitlist requests table
DROP TABLE IF EXISTS waitlist_requests;

-- Remove invited_via foreign key from users
ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_invited_via_fkey;

-- Drop beta invites table
DROP TABLE IF EXISTS beta_invites;

-- Remove beta columns from users
ALTER TABLE users
  DROP COLUMN IF EXISTS invited_via,
  DROP COLUMN IF EXISTS invited_by,
  DROP COLUMN IF EXISTS beta_cohort,
  DROP COLUMN IF EXISTS is_beta;
