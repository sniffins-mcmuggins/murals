-- name: AddFestivalArtist :one
INSERT INTO festival_artists (festival_id, artist_id, status)
VALUES ($1, $2, $3)
ON CONFLICT (festival_id, artist_id) DO UPDATE
    SET status = EXCLUDED.status, updated_at = now()
RETURNING *;

-- name: SetFestivalArtistPin :one
UPDATE festival_artists
SET pin_lat    = $3,
    pin_lng    = $4,
    w3w        = $5,
    updated_at = now()
WHERE festival_id = $1 AND artist_id = $2
RETURNING *;

-- name: GetFestivalMapPins :many
SELECT fa.festival_id,
       fa.artist_id,
       fa.pin_lat,
       fa.pin_lng,
       fa.w3w,
       ap.display_name
FROM festival_artists fa
JOIN artist_profiles ap ON ap.id = fa.artist_id
WHERE fa.festival_id = $1
  AND fa.status = 'accepted'
  AND fa.pin_lat IS NOT NULL
  AND fa.pin_lng IS NOT NULL;

-- name: GetAcceptedArtistsForFestival :many
SELECT fa.festival_id,
       fa.artist_id,
       fa.pin_lat,
       fa.pin_lng,
       fa.w3w,
       ap.display_name
FROM festival_artists fa
JOIN artist_profiles ap ON ap.id = fa.artist_id
WHERE fa.festival_id = $1
  AND fa.status = 'accepted';
