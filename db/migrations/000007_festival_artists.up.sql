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
