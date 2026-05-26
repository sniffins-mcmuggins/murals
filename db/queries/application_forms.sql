-- name: UpsertApplicationForm :one
INSERT INTO application_forms (festival_id, fields, open_at, close_at, max_applications)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (festival_id) DO UPDATE
    SET fields           = EXCLUDED.fields,
        open_at          = EXCLUDED.open_at,
        close_at         = EXCLUDED.close_at,
        max_applications = EXCLUDED.max_applications,
        updated_at       = now()
RETURNING *;

-- name: GetApplicationFormByFestivalID :one
SELECT * FROM application_forms WHERE festival_id = $1;
