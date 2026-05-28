-- name: CreateFestivalSpot :one
INSERT INTO festival_spots (festival_id, number, lat, lng, w3w, width_m, height_m, notes)
VALUES (
    $1,
    COALESCE((SELECT MAX(number) FROM festival_spots WHERE festival_id = $1), 0) + 1,
    $2, $3, $4, $5, $6, $7
)
RETURNING *;

-- name: GetFestivalSpot :one
SELECT fs.id,
       fs.festival_id,
       fs.number,
       fs.lat,
       fs.lng,
       fs.w3w,
       fs.width_m,
       fs.height_m,
       fs.notes,
       fs.artist_id,
       fs.created_at,
       fs.updated_at,
       ap.display_name AS artist_name
FROM festival_spots fs
LEFT JOIN artist_profiles ap ON ap.id = fs.artist_id
WHERE fs.id = $1 AND fs.festival_id = $2;

-- name: GetFestivalSpots :many
SELECT fs.id,
       fs.festival_id,
       fs.number,
       fs.lat,
       fs.lng,
       fs.w3w,
       fs.width_m,
       fs.height_m,
       fs.notes,
       fs.artist_id,
       fs.created_at,
       fs.updated_at,
       ap.display_name AS artist_name
FROM festival_spots fs
LEFT JOIN artist_profiles ap ON ap.id = fs.artist_id
WHERE fs.festival_id = $1
ORDER BY fs.number;

-- name: UpdateFestivalSpot :one
UPDATE festival_spots
SET lat        = $3,
    lng        = $4,
    w3w        = $5,
    width_m    = $6,
    height_m   = $7,
    notes      = $8,
    updated_at = now()
WHERE id = $1 AND festival_id = $2
RETURNING *;

-- name: DeleteFestivalSpot :exec
DELETE FROM festival_spots WHERE id = $1 AND festival_id = $2;

-- name: SetFestivalSpotArtist :one
UPDATE festival_spots
SET artist_id  = $3,
    updated_at = now()
WHERE id = $1 AND festival_id = $2
RETURNING *;

-- name: ClearFestivalSpotArtist :one
UPDATE festival_spots
SET artist_id  = NULL,
    updated_at = now()
WHERE id = $1 AND festival_id = $2
RETURNING *;

-- name: GetUnassignedAcceptedArtists :many
SELECT fa.artist_id, ap.display_name AS name
FROM festival_artists fa
JOIN artist_profiles ap ON ap.id = fa.artist_id
WHERE fa.festival_id = $1
  AND fa.status = 'accepted'
  AND NOT EXISTS (
    SELECT 1 FROM festival_spots fs
    WHERE fs.festival_id = $1 AND fs.artist_id = fa.artist_id
  )
ORDER BY ap.display_name;

-- name: GetFestivalMapPins :many
SELECT fs.festival_id,
       fs.artist_id,
       fs.lat      AS pin_lat,
       fs.lng      AS pin_lng,
       fs.w3w,
       ap.display_name
FROM festival_spots fs
JOIN artist_profiles ap ON ap.id = fs.artist_id
WHERE fs.festival_id = $1
  AND fs.artist_id IS NOT NULL;
