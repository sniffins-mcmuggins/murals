-- Artist profile, with collections containing ordered images.
--
-- An artist_profile is the public identity of a user with role='artist'.
-- Collections group images; collection_images carry the s3_key + cdn_url
-- (both are denormalised so we don't rebuild the URL on every read).

CREATE TABLE artist_profiles (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    display_name   text        NOT NULL,
    bio            text        NOT NULL DEFAULT '',
    location_label text,
    show_location  bool        NOT NULL DEFAULT false,
    medium_tags    text[]      NOT NULL DEFAULT '{}',
    social_links   jsonb       NOT NULL DEFAULT '{}',
    avatar_s3_key  text,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX artist_profiles_user_id_idx ON artist_profiles (user_id);

CREATE TYPE collection_status AS ENUM ('active', 'archived', 'ongoing');

CREATE TABLE collections (
    id                uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
    artist_profile_id uuid              NOT NULL REFERENCES artist_profiles(id) ON DELETE CASCADE,
    name              text              NOT NULL,
    description       text              NOT NULL DEFAULT '',
    cover_s3_key      text,
    status            collection_status NOT NULL DEFAULT 'active',
    display_order     int               NOT NULL DEFAULT 0,
    created_at        timestamptz       NOT NULL DEFAULT now(),
    updated_at        timestamptz       NOT NULL DEFAULT now()
);

CREATE INDEX collections_profile_order_idx ON collections (artist_profile_id, display_order);

CREATE TABLE collection_images (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    collection_id uuid        NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    s3_key        text        NOT NULL,
    cdn_url       text        NOT NULL,
    display_order int         NOT NULL DEFAULT 0,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX collection_images_collection_order_idx ON collection_images (collection_id, display_order);
