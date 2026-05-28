ALTER TABLE artist_profiles
    ADD COLUMN headline_image_urls text[] NOT NULL DEFAULT '{}';
