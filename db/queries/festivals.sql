-- name: CreateFestival :one
INSERT INTO festivals (organiser_id, name, slug, description, location_label, start_date, end_date, status)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING *;

-- name: GetFestivalByID :one
SELECT * FROM festivals WHERE id = $1 AND deleted_at IS NULL;

-- name: GetFestivalBySlug :one
SELECT * FROM festivals WHERE slug = $1 AND deleted_at IS NULL;

-- name: ListFestivalsByOrganiser :many
SELECT * FROM festivals WHERE organiser_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC;

-- name: UpdateFestival :one
UPDATE festivals
SET name           = $2,
    slug           = $3,
    description    = $4,
    location_label = $5,
    start_date     = $6,
    end_date       = $7,
    status         = $8,
    updated_at     = now()
WHERE id = $1 AND deleted_at IS NULL
RETURNING *;

-- name: SoftDeleteFestival :exec
UPDATE festivals SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL;

-- name: ListPublicFestivals :many
SELECT * FROM festivals WHERE deleted_at IS NULL AND status = $1 ORDER BY start_date ASC NULLS LAST, created_at DESC;

-- name: OpenReviewRound :one
UPDATE festivals
SET review_opened_at = now(), review_closed_at = NULL, updated_at = now()
WHERE id = $1
  AND deleted_at IS NULL
  AND review_closed_at IS NULL
RETURNING *;

-- name: CloseReviewRound :one
UPDATE festivals
SET review_closed_at = now(), updated_at = now()
WHERE id = $1
  AND deleted_at IS NULL
  AND review_opened_at IS NOT NULL
  AND review_closed_at IS NULL
RETURNING *;

-- name: SetFestivalCenter :one
UPDATE festivals
SET center_lat = $2,
    center_lng = $3,
    updated_at = now()
WHERE id = $1 AND deleted_at IS NULL
RETURNING *;
