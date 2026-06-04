-- name: AddFestivalReviewer :one
INSERT INTO festival_reviewers (festival_id, user_id)
VALUES ($1, $2)
ON CONFLICT (festival_id, user_id) DO UPDATE SET festival_id = EXCLUDED.festival_id
RETURNING *;

-- name: GetFestivalReviewer :one
SELECT * FROM festival_reviewers WHERE festival_id = $1 AND user_id = $2;

-- name: ListFestivalReviewers :many
SELECT fr.*, u.email
FROM festival_reviewers fr
JOIN users u ON u.id = fr.user_id
WHERE fr.festival_id = $1
ORDER BY fr.created_at ASC;

-- name: ListAcceptedFestivalReviewers :many
SELECT fr.user_id, u.email, fr.accepted_at, fr.created_at
FROM festival_reviewers fr
JOIN users u ON u.id = fr.user_id
WHERE fr.festival_id = $1
  AND fr.accepted_at IS NOT NULL
ORDER BY fr.created_at ASC;

-- name: ListFestivalsForReviewer :many
SELECT f.id, f.name, f.slug, f.status, f.start_date, f.end_date
FROM festival_reviewers fr
JOIN festivals f ON f.id = fr.festival_id
WHERE fr.user_id = $1 AND f.deleted_at IS NULL
ORDER BY f.created_at DESC;

-- name: RemoveFestivalReviewer :exec
DELETE FROM festival_reviewers WHERE festival_id = $1 AND user_id = $2;
