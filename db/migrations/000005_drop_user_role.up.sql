-- Drop the per-user role ENUM. Authorization is now ownership-of-entity:
-- "is an artist" = has a row in artist_profiles; "is an organiser" = owns at
-- least one row in festivals. Admin is the only remaining platform-level role,
-- and it becomes a boolean.
ALTER TABLE users ADD COLUMN is_admin boolean NOT NULL DEFAULT false;
UPDATE users SET is_admin = true WHERE role = 'admin';
ALTER TABLE users DROP COLUMN role;
DROP TYPE user_role;
