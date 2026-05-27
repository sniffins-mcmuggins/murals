-- Reverses 000005_drop_user_role. A user may be both an artist AND an organiser
-- in the new model; the enum can only hold one value, so we pick organiser
-- over artist (organiser is the higher-billing relationship), and admin wins
-- over both.
CREATE TYPE user_role AS ENUM ('artist', 'organiser', 'admin');
ALTER TABLE users ADD COLUMN role user_role NOT NULL DEFAULT 'artist';

UPDATE users SET role = 'organiser'
  WHERE id IN (SELECT DISTINCT organiser_id FROM festivals WHERE deleted_at IS NULL);

UPDATE users SET role = 'admin' WHERE is_admin;

ALTER TABLE users DROP COLUMN is_admin;
