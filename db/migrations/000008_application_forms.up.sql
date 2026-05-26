CREATE TABLE application_forms (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    festival_id      uuid        NOT NULL UNIQUE REFERENCES festivals(id) ON DELETE CASCADE,
    fields           jsonb       NOT NULL DEFAULT '[]',
    open_at          timestamptz,
    close_at         timestamptz,
    max_applications int,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);
