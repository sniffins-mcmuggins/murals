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

DROP INDEX IF EXISTS festival_spots_artist_idx;
DROP TABLE festival_spots;
