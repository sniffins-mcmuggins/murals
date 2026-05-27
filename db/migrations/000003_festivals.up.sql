-- Festivals + their application pipeline.
--
-- festivals: organiser-owned events. Soft-deleted via deleted_at so a slug
--   can be reused after a festival is removed; the partial unique index
--   only constrains active rows.
-- festival_artists: M:N link with status (invited/accepted/declined) plus
--   the on-map pin coordinates set by the organiser.
-- application_forms: one per festival, fields stored as a jsonb array.
-- applications: artists' submissions, answers in jsonb keyed by field id.

CREATE TYPE festival_status AS ENUM ('draft', 'open', 'live', 'archived');

CREATE TABLE festivals (
    id             uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    organiser_id   uuid            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name           text            NOT NULL,
    slug           text            NOT NULL,
    description    text            NOT NULL DEFAULT '',
    location_label text            NOT NULL DEFAULT '',
    start_date     date,
    end_date       date,
    status         festival_status NOT NULL DEFAULT 'draft',
    deleted_at     timestamptz,
    created_at     timestamptz     NOT NULL DEFAULT now(),
    updated_at     timestamptz     NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX festivals_slug_idx ON festivals (slug) WHERE deleted_at IS NULL;

CREATE TYPE festival_artist_status AS ENUM ('invited', 'accepted', 'declined');

CREATE TABLE festival_artists (
    festival_id uuid                   NOT NULL REFERENCES festivals(id) ON DELETE CASCADE,
    artist_id   uuid                   NOT NULL REFERENCES artist_profiles(id) ON DELETE CASCADE,
    status      festival_artist_status NOT NULL DEFAULT 'invited',
    pin_lat     numeric(9,6),
    pin_lng     numeric(9,6),
    w3w         text,
    created_at  timestamptz            NOT NULL DEFAULT now(),
    updated_at  timestamptz            NOT NULL DEFAULT now(),
    PRIMARY KEY (festival_id, artist_id)
);

CREATE TABLE application_forms (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    festival_id      uuid        NOT NULL UNIQUE REFERENCES festivals(id) ON DELETE CASCADE,
    fields           jsonb       NOT NULL DEFAULT '[]',
    open_at          timestamptz,
    close_at         timestamptz,
    max_applications int,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE application_status AS ENUM ('submitted', 'accepted', 'declined');

CREATE TABLE applications (
    id         uuid               PRIMARY KEY DEFAULT gen_random_uuid(),
    form_id    uuid               NOT NULL REFERENCES application_forms(id) ON DELETE CASCADE,
    artist_id  uuid               NOT NULL REFERENCES artist_profiles(id) ON DELETE CASCADE,
    status     application_status NOT NULL DEFAULT 'submitted',
    answers    jsonb              NOT NULL DEFAULT '{}',
    created_at timestamptz        NOT NULL DEFAULT now(),
    updated_at timestamptz        NOT NULL DEFAULT now(),
    UNIQUE (form_id, artist_id)
);
