ALTER TABLE festival_artists ADD COLUMN pin_lat numeric(9,6);
ALTER TABLE festival_artists ADD COLUMN pin_lng numeric(9,6);
ALTER TABLE festival_artists ADD COLUMN w3w text;

UPDATE festival_artists fa
SET pin_lat = fs.lat,
    pin_lng = fs.lng,
    w3w     = fs.w3w
FROM festival_spots fs
WHERE fs.festival_id = fa.festival_id
  AND fs.artist_id   = fa.artist_id;

-- NOTE: Only spots migrated from festival_artists pin data (those with an artist_id)
-- are restored. Spots created by the application after this migration are dropped on
-- rollback — the old schema has no equivalent column to store them.
DROP INDEX IF EXISTS festival_spots_artist_idx;
DROP TABLE IF EXISTS festival_spots;
