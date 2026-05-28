ALTER TYPE application_status ADD VALUE 'waitlisted';

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
