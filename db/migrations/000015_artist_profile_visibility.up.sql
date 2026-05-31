ALTER TABLE artist_profiles
  ADD COLUMN visibility VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (visibility IN ('draft', 'public'));
