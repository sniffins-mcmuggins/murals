ALTER TABLE festivals
  ADD COLUMN review_opened_at TIMESTAMPTZ,
  ADD COLUMN review_closed_at TIMESTAMPTZ;
