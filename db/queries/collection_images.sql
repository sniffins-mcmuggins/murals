-- name: AttachCollectionImage :one
INSERT INTO collection_images (collection_id, s3_key, cdn_url, display_order)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: CountCollectionImages :one
SELECT COUNT(*) FROM collection_images WHERE collection_id = $1;

-- name: ListCollectionImages :many
SELECT * FROM collection_images
WHERE collection_id = $1
ORDER BY display_order, created_at;

-- name: GetCollectionImageByID :one
SELECT * FROM collection_images WHERE id = $1;

-- name: UpdateCollectionImageOrder :exec
UPDATE collection_images SET display_order = $2 WHERE id = $1;

-- name: DeleteCollectionImage :exec
DELETE FROM collection_images WHERE id = $1;
