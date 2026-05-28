-- Note: Postgres cannot remove an enum value once added.
-- 'waitlisted' remains in the application_status enum after rollback.
DROP TABLE IF EXISTS application_notes;

ALTER TABLE applications
  DROP COLUMN IF EXISTS review_flag,
  DROP COLUMN IF EXISTS shortlisted,
  DROP COLUMN IF EXISTS rank;
