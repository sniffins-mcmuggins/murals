CREATE TYPE festival_status AS ENUM ('draft', 'open', 'live', 'archived');

CREATE TABLE festivals (
    id              uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    organiser_id    uuid            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            text            NOT NULL,
    slug            text            NOT NULL,
    description     text            NOT NULL DEFAULT '',
    location_label  text            NOT NULL DEFAULT '',
    start_date      date,
    end_date        date,
    status          festival_status NOT NULL DEFAULT 'draft',
    deleted_at      timestamptz,
    created_at      timestamptz     NOT NULL DEFAULT now(),
    updated_at      timestamptz     NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX festivals_slug_idx ON festivals (slug) WHERE deleted_at IS NULL;
