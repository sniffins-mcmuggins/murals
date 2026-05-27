-- name: ListFestivalsByOrganiser :many
SELECT id, name, slug, status, start_date, end_date
FROM festivals
WHERE organiser_id = $1 AND deleted_at IS NULL
ORDER BY created_at DESC;
