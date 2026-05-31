ALTER TABLE artist_profiles
  ADD COLUMN preview_token TEXT UNIQUE NOT NULL
    DEFAULT replace(gen_random_uuid()::text, '-', '');
