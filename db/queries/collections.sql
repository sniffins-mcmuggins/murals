-- name: CreateCollection :one
INSERT INTO collections (artist_profile_id, name, description)
VALUES ($1, $2, $3)
RETURNING *;

-- name: GetCollectionByID :one
SELECT * FROM collections WHERE id = $1;

-- name: ListCollectionsByProfileID :many
SELECT * FROM collections
WHERE artist_profile_id = $1
ORDER BY display_order, created_at;

-- name: UpdateCollection :one
UPDATE collections
SET name           = $2,
    description    = $3,
    cover_s3_key   = $4,
    status         = $5,
    cover_focal_x  = $6,
    cover_focal_y  = $7,
    updated_at     = now()
WHERE id = $1
RETURNING *;

-- name: UpdateCollectionOrder :exec
UPDATE collections SET display_order = $2 WHERE id = $1;

-- name: DeleteCollection :exec
DELETE FROM collections WHERE id = $1;
