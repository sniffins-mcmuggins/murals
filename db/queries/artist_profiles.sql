-- name: CreateArtistProfile :one
INSERT INTO artist_profiles (user_id, display_name)
VALUES ($1, $2)
RETURNING *;

-- name: GetArtistProfileByID :one
SELECT * FROM artist_profiles WHERE id = $1;

-- name: GetArtistProfileByUserID :one
SELECT * FROM artist_profiles WHERE user_id = $1;

-- name: UpdateArtistProfile :one
UPDATE artist_profiles
SET display_name   = $2,
    bio            = $3,
    location_label = $4,
    show_location  = $5,
    medium_tags    = $6,
    social_links   = $7,
    avatar_s3_key  = $8,
    updated_at     = now()
WHERE id = $1
RETURNING *;
