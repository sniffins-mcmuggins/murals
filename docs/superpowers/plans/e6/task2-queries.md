# Task 2: sqlc Queries + Code Generation

**Files:**
- Create: `db/queries/festivals.sql`
- Create: `db/queries/festival_artists.sql`
- Create: `db/queries/application_forms.sql`
- Create: `db/queries/applications.sql`
- Regenerate: `api/internal/sqlcdb/` (run `task db:generate` from repo root)

**Context:** sqlc reads from `db/sqlc.yaml`. jsonb columns map to `json.RawMessage` (see override in sqlc.yaml). Nullable numeric columns become `pgtype.Numeric`. Nullable timestamptz columns become `*pgtype.Timestamptz` (because `emit_pointers_for_null_types: true`). Run `task db:generate` from the repo root to regenerate. The task command is `task db:generate` — check `Taskfile.yml` if unsure.

---

- [ ] **Step 1: Create db/queries/festivals.sql**

```sql
-- name: CreateFestival :one
INSERT INTO festivals (organiser_id, name, slug, description, location_label, start_date, end_date, status)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING *;

-- name: GetFestivalByID :one
SELECT * FROM festivals WHERE id = $1 AND deleted_at IS NULL;

-- name: GetFestivalBySlug :one
SELECT * FROM festivals WHERE slug = $1 AND deleted_at IS NULL;

-- name: ListFestivalsByOrganiser :many
SELECT * FROM festivals WHERE organiser_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC;

-- name: UpdateFestival :one
UPDATE festivals
SET name           = $2,
    slug           = $3,
    description    = $4,
    location_label = $5,
    start_date     = $6,
    end_date       = $7,
    status         = $8,
    updated_at     = now()
WHERE id = $1 AND deleted_at IS NULL
RETURNING *;

-- name: SoftDeleteFestival :exec
UPDATE festivals SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL;
```

- [ ] **Step 2: Create db/queries/festival_artists.sql**

```sql
-- name: AddFestivalArtist :one
INSERT INTO festival_artists (festival_id, artist_id, status)
VALUES ($1, $2, $3)
ON CONFLICT (festival_id, artist_id) DO UPDATE
    SET status = EXCLUDED.status, updated_at = now()
RETURNING *;

-- name: GetFestivalMapPins :many
SELECT fa.festival_id,
       fa.artist_id,
       fa.pin_lat,
       fa.pin_lng,
       fa.w3w,
       ap.display_name
FROM festival_artists fa
JOIN artist_profiles ap ON ap.id = fa.artist_id
WHERE fa.festival_id = $1
  AND fa.status = 'accepted'
  AND fa.pin_lat IS NOT NULL
  AND fa.pin_lng IS NOT NULL;
```

- [ ] **Step 3: Create db/queries/application_forms.sql**

```sql
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
```

- [ ] **Step 4: Create db/queries/applications.sql**

```sql
-- name: CreateApplication :one
INSERT INTO applications (form_id, artist_id, answers)
VALUES ($1, $2, $3)
RETURNING *;

-- name: GetApplicationByID :one
SELECT * FROM applications WHERE id = $1;

-- name: GetApplicationByFormAndArtist :one
SELECT * FROM applications WHERE form_id = $1 AND artist_id = $2;

-- name: ListApplicationsByForm :many
SELECT * FROM applications WHERE form_id = $1 ORDER BY created_at ASC;

-- name: UpdateApplicationStatus :one
UPDATE applications SET status = $2, updated_at = now() WHERE id = $1 RETURNING *;
```

- [ ] **Step 5: Run sqlc generate**

From the repo root (not api/):
```bash
task db:generate
```

If `task db:generate` doesn't exist, check `Taskfile.yml` for the right task name, or run directly:
```bash
cd db && sqlc generate
```

- [ ] **Step 6: Verify generated files exist**

```bash
ls api/internal/sqlcdb/ | grep -E "festival|application"
```

Expected (4 new files):
```
application_forms.sql.go
applications.sql.go
festival_artists.sql.go
festivals.sql.go
```

Also verify models.go was updated with new types:
```bash
grep -E "FestivalStatus|FestivalArtistStatus|ApplicationStatus" api/internal/sqlcdb/models.go
```

- [ ] **Step 7: Commit**

```bash
git add db/queries/festivals.sql \
        db/queries/festival_artists.sql \
        db/queries/application_forms.sql \
        db/queries/applications.sql \
        api/internal/sqlcdb/
git commit -m "feat(db): add festival domain queries and regenerate sqlc"
```
