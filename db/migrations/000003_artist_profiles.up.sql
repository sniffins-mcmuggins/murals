CREATE TABLE artist_profiles (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    display_name    text        NOT NULL,
    bio             text        NOT NULL DEFAULT '',
    location_label  text,
    show_location   bool        NOT NULL DEFAULT false,
    medium_tags     text[]      NOT NULL DEFAULT '{}',
    social_links    jsonb       NOT NULL DEFAULT '{}',
    avatar_s3_key   text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX artist_profiles_user_id_idx ON artist_profiles (user_id);
