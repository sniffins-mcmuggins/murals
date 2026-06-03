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

-- name: ListApplicationsByFormWithArtist :many
SELECT
  a.id,
  a.form_id,
  a.artist_id,
  a.status,
  a.rank,
  a.shortlisted,
  a.review_flag,
  a.staged_decision,
  a.answers,
  a.created_at,
  a.updated_at,
  ap.display_name,
  ap.avatar_s3_key,
  ap.medium_tags,
  ap.location_label
FROM applications a
JOIN artist_profiles ap ON ap.id = a.artist_id
WHERE a.form_id = $1
ORDER BY a.rank ASC, a.created_at ASC;

-- name: UpdateApplicationFlags :one
UPDATE applications
SET shortlisted = $2, review_flag = $3, staged_decision = $4, updated_at = now()
WHERE id = $1
RETURNING *;

-- name: UpdateApplicationRank :exec
UPDATE applications SET rank = $1, updated_at = now() WHERE id = $2;

-- name: ListApplicationsByFormWithArtistExcludingReviewer :many
-- Reviewer-scoped: hides the application belonging to the reviewer ($2 = user_id).
SELECT a.*, ap.display_name, ap.avatar_s3_key, ap.medium_tags, ap.location_label
FROM applications a
JOIN artist_profiles ap ON ap.id = a.artist_id
WHERE a.form_id = $1
  AND ap.user_id IS DISTINCT FROM $2
ORDER BY a.rank ASC, a.created_at ASC;

-- name: ListStagedApplicationsByFestival :many
SELECT a.*
FROM applications a
JOIN application_forms f ON a.form_id = f.id
WHERE f.festival_id = $1
  AND a.staged_decision IS NOT NULL;

-- name: ReleaseDecisionsForFestival :many
UPDATE applications a
SET
  status = CASE a.staged_decision
    WHEN 'accept'   THEN 'accepted'::application_status
    WHEN 'waitlist' THEN 'waitlisted'::application_status
    WHEN 'decline'  THEN 'declined'::application_status
  END,
  staged_decision = NULL,
  updated_at = now()
FROM application_forms f
WHERE a.form_id = f.id
  AND f.festival_id = $1
  AND a.staged_decision IS NOT NULL
RETURNING a.*;
