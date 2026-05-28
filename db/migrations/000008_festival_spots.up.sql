CREATE TABLE festival_spots (
    id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    festival_id uuid         NOT NULL REFERENCES festivals(id) ON DELETE CASCADE,
    number      int          NOT NULL,
    lat         numeric(9,6) NOT NULL,
    lng         numeric(9,6) NOT NULL,
    w3w         text,
    width_m     numeric(5,1),
    height_m    numeric(5,1),
    notes       text,
    artist_id   uuid         REFERENCES artist_profiles(id) ON DELETE SET NULL,
    created_at  timestamptz  NOT NULL DEFAULT now(),
    updated_at  timestamptz  NOT NULL DEFAULT now(),
    UNIQUE (festival_id, number)
);

CREATE UNIQUE INDEX festival_spots_artist_idx
    ON festival_spots (festival_id, artist_id)
    WHERE artist_id IS NOT NULL;

-- Migrate any existing pin data: one spot per festival_artist that has coords.
INSERT INTO festival_spots (festival_id, number, lat, lng, w3w, artist_id)
SELECT
    fa.festival_id,
    ROW_NUMBER() OVER (PARTITION BY fa.festival_id ORDER BY fa.created_at)::int AS number,
    fa.pin_lat,
    fa.pin_lng,
    fa.w3w,
    fa.artist_id
FROM festival_artists fa
WHERE fa.pin_lat IS NOT NULL AND fa.pin_lng IS NOT NULL;

ALTER TABLE festival_artists DROP COLUMN pin_lat;
ALTER TABLE festival_artists DROP COLUMN pin_lng;
ALTER TABLE festival_artists DROP COLUMN w3w;
