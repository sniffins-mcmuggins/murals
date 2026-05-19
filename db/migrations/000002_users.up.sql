CREATE TYPE user_role AS ENUM ('artist', 'organiser', 'admin');

CREATE TABLE users (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    email         text        NOT NULL,
    password_hash text        NOT NULL,
    role          user_role   NOT NULL DEFAULT 'artist',
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX users_email_idx ON users (email);
