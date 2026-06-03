ALTER TABLE applications
  ADD COLUMN staged_decision TEXT CHECK (staged_decision IN ('accept', 'waitlist', 'decline'));

ALTER TABLE festivals
  ADD COLUMN decisions_released_at TIMESTAMPTZ;
