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
    support_url         = $11,
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

-- name: SetArtistProfileVisibility :one
UPDATE artist_profiles
SET visibility = $2,
    updated_at = now()
WHERE user_id = $1
RETURNING *;

-- name: CreateProspectProfile :one
-- Creates an unclaimed prospect profile (user_id NULL) seeded from admin data.
INSERT INTO artist_profiles (display_name, bio, location_label, medium_tags, social_links, created_by)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: GetArtistProfileByClaimToken :one
SELECT * FROM artist_profiles WHERE claim_token = $1;

-- name: ClaimArtistProfile :one
-- Atomically binds a profile to a user. Returns no row if already claimed
-- (user_id IS NOT NULL) or if the token doesn't exist — caller checks for
-- pgx.ErrNoRows and returns 409. Stamps setup_completed_at so the claimer
-- lands on the editor, not the first-run wizard (the page was pre-built).
UPDATE artist_profiles
SET user_id            = $1,
    claimed_at         = now(),
    setup_completed_at = now(),
    updated_at         = now()
WHERE claim_token = $2
  AND user_id IS NULL
RETURNING *;

-- name: SetProspectClaimToken :one
-- Sets a unique claim token on a prospect profile. Called during prospect creation.
UPDATE artist_profiles
SET claim_token = $2,
    updated_at  = now()
WHERE id = $1
RETURNING *;

-- name: GetProspectByNameAndCreator :one
-- Idempotency check: return an existing unclaimed prospect by name + admin creator.
SELECT * FROM artist_profiles
WHERE display_name = $1
  AND created_by   = $2
  AND user_id IS NULL
LIMIT 1;

-- name: CompleteArtistProfileSetup :one
-- Idempotently marks first-run setup complete. COALESCE keeps the first
-- completion timestamp if called more than once, and always returns the row.
UPDATE artist_profiles
SET setup_completed_at = COALESCE(setup_completed_at, now()),
    updated_at         = now()
WHERE user_id = $1
RETURNING *;

-- name: GetSpotHistoryForProfile :many
-- Returns festival spot placements for a given artist profile.
-- Only includes spots from live or closed festivals (not draft/open).
SELECT
    fs.id               AS spot_id,
    fs.lat,
    fs.lng,
    fs.mural_status,
    f.id                AS festival_id,
    f.name              AS festival_name,
    COALESCE(EXTRACT(YEAR FROM f.start_date)::int, 0) AS festival_year
FROM festival_spots fs
JOIN festivals f ON f.id = fs.festival_id
WHERE fs.artist_id = $1
  AND f.deleted_at IS NULL
  AND f.status IN ('live', 'closed')
ORDER BY f.start_date DESC NULLS LAST;
