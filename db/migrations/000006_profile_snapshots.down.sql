DROP TRIGGER IF EXISTS trg_artist_profiles_dirty ON artist_profiles;
DROP TRIGGER IF EXISTS trg_collection_images_dirty ON collection_images;
DROP TRIGGER IF EXISTS trg_collections_dirty ON collections;
DROP FUNCTION IF EXISTS mark_profile_dirty_self();
DROP FUNCTION IF EXISTS mark_profile_dirty_from_image();
DROP FUNCTION IF EXISTS mark_profile_dirty_from_collection();
ALTER TABLE artist_profiles DROP COLUMN IF EXISTS has_unpublished_changes;
DROP TABLE IF EXISTS profile_snapshots;
