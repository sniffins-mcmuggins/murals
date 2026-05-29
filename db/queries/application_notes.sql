-- name: ListNotesByApplications :many
SELECT * FROM application_notes
WHERE application_id = ANY($1::uuid[])
ORDER BY application_id, created_at ASC;

-- name: CreateApplicationNote :one
INSERT INTO application_notes (application_id, content, author_id)
VALUES ($1, $2, $3) RETURNING *;
