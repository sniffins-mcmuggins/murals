-- Artist profile, with collections containing ordered images.
--
-- artist_profiles: public identity of a user. user_id is nullable to support
--   unclaimed prospect profiles (organiser-created stubs not yet claimed by
--   the artist). Only non-NULL user_ids have the uniqueness constraint.
-- collections: group images; display_order controls the sequence.
-- collection_images: carry s3_key + cdn_url (denormalised to avoid rebuilding
--   the URL on every read).
-- analytics_events: per-profile view/scan/link-click events.
--
-- Column order on artist_profiles: id, user_id, core fields, created_at,
-- updated_at — then historically-appended columns (headline_image_urls,
-- visibility, preview_token, claim fields). Don't reorder without
-- regenerating sqlcdb/ and reviewing ArtistProfile struct field order.

CREATE TABLE artist_profiles (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             uuid        REFERENCES users(id) ON DELETE CASCADE,
    display_name        text        NOT NULL,
    bio                 text        NOT NULL DEFAULT '',
    location_label      text,
    show_location       bool        NOT NULL DEFAULT false,
    medium_tags         text[]      NOT NULL DEFAULT '{}',
    social_links        jsonb       NOT NULL DEFAULT '{}',
    avatar_s3_key       text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    headline_image_urls text[]      NOT NULL DEFAULT '{}',
    visibility          varchar(20) NOT NULL DEFAULT 'draft'
                        CHECK (visibility IN ('draft', 'public')),
    preview_token       text        UNIQUE NOT NULL
                        DEFAULT replace(gen_random_uuid()::text, '-', ''),
    claim_token         text        UNIQUE,
    claimed_at          timestamptz,
    created_by          uuid        REFERENCES users(id)
);

-- Partial unique index: NULLs (unclaimed) coexist freely; only non-NULL
-- user_ids must be unique.
CREATE UNIQUE INDEX artist_profiles_user_id_idx
    ON artist_profiles (user_id) WHERE user_id IS NOT NULL;

CREATE TYPE collection_status AS ENUM ('active', 'archived', 'ongoing');

-- Column order: core fields then cover_focal_x/y (historically-appended).
CREATE TABLE collections (
    id                uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
    artist_profile_id uuid              NOT NULL REFERENCES artist_profiles(id) ON DELETE CASCADE,
    name              text              NOT NULL,
    description       text              NOT NULL DEFAULT '',
    cover_s3_key      text,
    status            collection_status NOT NULL DEFAULT 'active',
    display_order     int               NOT NULL DEFAULT 0,
    created_at        timestamptz       NOT NULL DEFAULT now(),
    updated_at        timestamptz       NOT NULL DEFAULT now(),
    cover_focal_x     float4            NOT NULL DEFAULT 50,
    cover_focal_y     float4            NOT NULL DEFAULT 50
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

-- Per-profile analytics. occurred_at drives time-window aggregate queries.
CREATE TYPE analytics_event_type AS ENUM ('profile_view', 'qr_scan', 'link_click');

CREATE TABLE analytics_events (
    id          uuid                 PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type  analytics_event_type NOT NULL,
    profile_id  uuid                 NOT NULL REFERENCES artist_profiles(id) ON DELETE CASCADE,
    occurred_at timestamptz          NOT NULL DEFAULT now()
);

CREATE INDEX analytics_events_profile_time_idx ON analytics_events (profile_id, occurred_at);
