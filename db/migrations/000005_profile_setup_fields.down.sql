ALTER TABLE artist_profiles
    DROP COLUMN IF EXISTS setup_completed_at,
    DROP COLUMN IF EXISTS support_url;
