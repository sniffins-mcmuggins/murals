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
SET display_name        = $2,
    bio                 = $3,
    location_label      = $4,
    show_location       = $5,
    medium_tags         = $6,
    social_links        = $7,
    avatar_s3_key       = $8,
    headline_image_urls = $9,
    visibility          = $10,
    updated_at          = now()
WHERE id = $1
RETURNING *;

-- name: ListPublicProfiles :many
SELECT * FROM artist_profiles
WHERE visibility = 'public'
ORDER BY created_at DESC
LIMIT $1 OFFSET $2;

-- name: CountPublicProfiles :one
SELECT COUNT(*) FROM artist_profiles
WHERE visibility = 'public';

-- name: GetArtistProfileByPreviewToken :one
SELECT * FROM artist_profiles WHERE preview_token = $1;

-- name: RotateArtistProfilePreviewToken :one
UPDATE artist_profiles
SET preview_token = replace(gen_random_uuid()::text, '-', ''),
    updated_at    = now()
WHERE user_id = $1
RETURNING *;
