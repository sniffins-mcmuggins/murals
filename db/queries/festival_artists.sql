-- name: AddFestivalArtist :one
INSERT INTO festival_artists (festival_id, artist_id, status)
VALUES ($1, $2, $3)
ON CONFLICT (festival_id, artist_id) DO UPDATE
    SET status = EXCLUDED.status, updated_at = now()
RETURNING *;

-- name: GetAcceptedArtistForFestival :one
SELECT fa.festival_id,
       fa.artist_id,
       ap.display_name
FROM festival_artists fa
JOIN artist_profiles ap ON ap.id = fa.artist_id
WHERE fa.festival_id = $1
  AND fa.artist_id = $2
  AND fa.status = 'accepted';

-- name: ListPublicFestivalsForArtist :many
-- Festivals where the given artist is accepted and/or has an assigned spot,
-- restricted to festivals the public can see (open or live, not soft-deleted).
-- Used by the public "Appearances" section on an artist profile.
SELECT f.id,
       f.name,
       f.slug,
       f.start_date,
       f.end_date,
       f.status
FROM festivals f
WHERE f.deleted_at IS NULL
  AND f.status IN ('open', 'live')
  AND (
    EXISTS (
      SELECT 1 FROM festival_artists fa
      WHERE fa.festival_id = f.id
        AND fa.artist_id = $1
        AND fa.status = 'accepted'
    )
    OR EXISTS (
      SELECT 1 FROM festival_spots fs
      WHERE fs.festival_id = f.id
        AND fs.artist_id = $1
    )
  )
ORDER BY f.start_date ASC NULLS LAST, f.created_at DESC;
