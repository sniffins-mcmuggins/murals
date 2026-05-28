-- ALTER TYPE ADD VALUE is safe in a transaction on Postgres 12+ when the new value
-- is not used within the same transaction. This migration only declares the value.
ALTER TYPE application_status ADD VALUE IF NOT EXISTS 'waitlisted';

ALTER TABLE applications
  ADD COLUMN rank        int  NOT NULL DEFAULT 0,
  ADD COLUMN shortlisted bool NOT NULL DEFAULT false,
  ADD COLUMN review_flag bool NOT NULL DEFAULT false;

CREATE TABLE application_notes (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid        NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  content        text        NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_application_notes_application_id ON application_notes (application_id);
