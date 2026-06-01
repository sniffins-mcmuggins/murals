-- name: CreateOrUpdateEndorsement :one
INSERT INTO endorsements (endorser_id, endorsee_id, kind, festival_id, body, skills)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (endorser_id, endorsee_id) DO UPDATE
  SET kind        = EXCLUDED.kind,
      festival_id = EXCLUDED.festival_id,
      body        = EXCLUDED.body,
      skills      = EXCLUDED.skills,
      updated_at  = now()
RETURNING *;

-- name: GetEndorsementByID :one
SELECT * FROM endorsements WHERE id = $1;

-- name: DeleteEndorsement :exec
DELETE FROM endorsements WHERE id = $1;

-- name: ListPublicEndorsements :many
SELECT
  e.id,
  e.endorser_id,
  e.endorsee_id,
  e.kind,
  e.festival_id,
  e.body,
  e.skills,
  e.hidden_by_endorsee,
  e.moderation_status,
  e.created_at,
  e.updated_at,
  ap.display_name  AS endorser_display_name,
  ap.avatar_s3_key AS endorser_avatar_s3_key,
  f.name           AS festival_name
FROM endorsements e
LEFT JOIN artist_profiles ap ON ap.user_id = e.endorser_id
LEFT JOIN festivals f ON f.id = e.festival_id
WHERE e.endorsee_id = $1
  AND e.moderation_status = 'ok'
  AND e.hidden_by_endorsee = false
ORDER BY (e.kind = 'organiser') DESC, e.created_at DESC;

-- name: ListReceivedEndorsements :many
-- All endorsements for the authenticated endorsee (includes hidden + moderated).
SELECT
  e.id,
  e.endorser_id,
  e.endorsee_id,
  e.kind,
  e.festival_id,
  e.body,
  e.skills,
  e.hidden_by_endorsee,
  e.moderation_status,
  e.created_at,
  e.updated_at,
  ap.display_name  AS endorser_display_name,
  ap.avatar_s3_key AS endorser_avatar_s3_key,
  f.name           AS festival_name
FROM endorsements e
LEFT JOIN artist_profiles ap ON ap.user_id = e.endorser_id
LEFT JOIN festivals f ON f.id = e.festival_id
WHERE e.endorsee_id = $1
ORDER BY (e.kind = 'organiser') DESC, e.created_at DESC;

-- name: SetEndorsementVisibility :one
UPDATE endorsements
SET hidden_by_endorsee = $2,
    updated_at         = now()
WHERE id = $1
RETURNING *;

-- name: SetEndorsementModerationStatus :one
-- Called by E17 moderation machinery.
UPDATE endorsements
SET moderation_status = $2,
    updated_at        = now()
WHERE id = $1
RETURNING *;
