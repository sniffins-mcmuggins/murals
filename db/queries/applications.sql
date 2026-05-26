-- name: CreateApplication :one
INSERT INTO applications (form_id, artist_id, answers)
VALUES ($1, $2, $3)
RETURNING *;

-- name: GetApplicationByID :one
SELECT * FROM applications WHERE id = $1;

-- name: GetApplicationByFormAndArtist :one
SELECT * FROM applications WHERE form_id = $1 AND artist_id = $2;

-- name: ListApplicationsByForm :many
SELECT * FROM applications WHERE form_id = $1 ORDER BY created_at ASC;

-- name: ListApplicationsByArtist :many
SELECT * FROM applications WHERE artist_id = $1 ORDER BY created_at DESC;

-- name: UpdateApplicationStatus :one
UPDATE applications SET status = $2, updated_at = now() WHERE id = $1 RETURNING *;
