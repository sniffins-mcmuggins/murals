-- name: GetProfileSnapshot :one
SELECT snapshot, published_at FROM profile_snapshots
WHERE artist_profile_id = $1;

-- name: UpsertProfileSnapshot :exec
INSERT INTO profile_snapshots (artist_profile_id, snapshot, published_at)
VALUES ($1, $2, now())
ON CONFLICT (artist_profile_id)
DO UPDATE SET snapshot = EXCLUDED.snapshot, published_at = now();

-- name: ClearProfileChanges :exec
UPDATE artist_profiles SET has_unpublished_changes = false WHERE id = $1;
