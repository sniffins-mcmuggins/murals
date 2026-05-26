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
