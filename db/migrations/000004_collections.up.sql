CREATE TYPE collection_status AS ENUM ('active', 'archived', 'ongoing');

CREATE TABLE collections (
    id                  uuid                PRIMARY KEY DEFAULT gen_random_uuid(),
    artist_profile_id   uuid                NOT NULL REFERENCES artist_profiles(id) ON DELETE CASCADE,
    name                text                NOT NULL,
    description         text                NOT NULL DEFAULT '',
    cover_s3_key        text,
    status              collection_status   NOT NULL DEFAULT 'active',
    display_order       int                 NOT NULL DEFAULT 0,
    created_at          timestamptz         NOT NULL DEFAULT now(),
    updated_at          timestamptz         NOT NULL DEFAULT now()
);

CREATE INDEX collections_profile_order_idx ON collections (artist_profile_id, display_order);
