-- Published read-model snapshot for artist profiles (E29).
-- The live tables (artist_profiles + collections + collection_images) are the
-- editable DRAFT. profile_snapshots holds the frozen PUBLISHED page that the
-- public sees. PK on artist_profile_id => exactly one snapshot per profile.
CREATE TABLE profile_snapshots (
    artist_profile_id uuid        PRIMARY KEY REFERENCES artist_profiles(id) ON DELETE CASCADE,
    snapshot          jsonb       NOT NULL,
    published_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE artist_profiles
    ADD COLUMN has_unpublished_changes boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION mark_profile_dirty_from_collection() RETURNS trigger AS $$
BEGIN
    UPDATE artist_profiles
       SET has_unpublished_changes = true
     WHERE id = COALESCE(NEW.artist_profile_id, OLD.artist_profile_id);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION mark_profile_dirty_from_image() RETURNS trigger AS $$
BEGIN
    UPDATE artist_profiles
       SET has_unpublished_changes = true
     WHERE id = (SELECT artist_profile_id FROM collections
                  WHERE id = COALESCE(NEW.collection_id, OLD.collection_id));
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Only flag when an AUTHORED content column changes, so writing the flag
-- itself (publish) does NOT re-flag the row.
CREATE OR REPLACE FUNCTION mark_profile_dirty_self() RETURNS trigger AS $$
BEGIN
    IF (NEW.display_name        IS DISTINCT FROM OLD.display_name)
    OR (NEW.bio                 IS DISTINCT FROM OLD.bio)
    OR (NEW.location_label      IS DISTINCT FROM OLD.location_label)
    OR (NEW.show_location       IS DISTINCT FROM OLD.show_location)
    OR (NEW.medium_tags         IS DISTINCT FROM OLD.medium_tags)
    OR (NEW.social_links        IS DISTINCT FROM OLD.social_links)
    OR (NEW.avatar_s3_key       IS DISTINCT FROM OLD.avatar_s3_key)
    OR (NEW.headline_image_urls IS DISTINCT FROM OLD.headline_image_urls)
    OR (NEW.support_url         IS DISTINCT FROM OLD.support_url)
    THEN
        NEW.has_unpublished_changes := true;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_collections_dirty
    AFTER INSERT OR UPDATE OR DELETE ON collections
    FOR EACH ROW EXECUTE FUNCTION mark_profile_dirty_from_collection();

CREATE TRIGGER trg_collection_images_dirty
    AFTER INSERT OR UPDATE OR DELETE ON collection_images
    FOR EACH ROW EXECUTE FUNCTION mark_profile_dirty_from_image();

CREATE TRIGGER trg_artist_profiles_dirty
    BEFORE UPDATE ON artist_profiles
    FOR EACH ROW EXECUTE FUNCTION mark_profile_dirty_self();
