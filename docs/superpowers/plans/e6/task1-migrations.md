# Task 1: DB Migrations (000006–000009)

**Files:**
- Create: `db/migrations/000006_festivals.up.sql`
- Create: `db/migrations/000006_festivals.down.sql`
- Create: `db/migrations/000007_festival_artists.up.sql`
- Create: `db/migrations/000007_festival_artists.down.sql`
- Create: `db/migrations/000008_application_forms.up.sql`
- Create: `db/migrations/000008_application_forms.down.sql`
- Create: `db/migrations/000009_applications.up.sql`
- Create: `db/migrations/000009_applications.down.sql`

**Context:** The repo uses `golang-migrate` with sequential numeric prefixes. The last existing migration is `000005_collection_images`. New migrations start at 000006. All migration files live in `db/migrations/`. Do NOT run migrations manually — testcontainers applies them automatically in tests.

---

- [ ] **Step 1: Create 000006_festivals.up.sql**

```sql
CREATE TYPE festival_status AS ENUM ('draft', 'open', 'live', 'archived');

CREATE TABLE festivals (
    id              uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    organiser_id    uuid            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            text            NOT NULL,
    slug            text            NOT NULL,
    description     text            NOT NULL DEFAULT '',
    location_label  text            NOT NULL DEFAULT '',
    start_date      date,
    end_date        date,
    status          festival_status NOT NULL DEFAULT 'draft',
    deleted_at      timestamptz,
    created_at      timestamptz     NOT NULL DEFAULT now(),
    updated_at      timestamptz     NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX festivals_slug_idx ON festivals (slug) WHERE deleted_at IS NULL;
```

- [ ] **Step 2: Create 000006_festivals.down.sql**

```sql
DROP TABLE IF EXISTS festivals;
DROP TYPE IF EXISTS festival_status;
```

- [ ] **Step 3: Create 000007_festival_artists.up.sql**

```sql
CREATE TYPE festival_artist_status AS ENUM ('invited', 'accepted', 'declined');

CREATE TABLE festival_artists (
    festival_id uuid                   NOT NULL REFERENCES festivals(id) ON DELETE CASCADE,
    artist_id   uuid                   NOT NULL REFERENCES artist_profiles(id) ON DELETE CASCADE,
    status      festival_artist_status NOT NULL DEFAULT 'invited',
    pin_lat     numeric(9,6),
    pin_lng     numeric(9,6),
    w3w         text,
    created_at  timestamptz            NOT NULL DEFAULT now(),
    updated_at  timestamptz            NOT NULL DEFAULT now(),
    PRIMARY KEY (festival_id, artist_id)
);
```

- [ ] **Step 4: Create 000007_festival_artists.down.sql**

```sql
DROP TABLE IF EXISTS festival_artists;
DROP TYPE IF EXISTS festival_artist_status;
```

- [ ] **Step 5: Create 000008_application_forms.up.sql**

```sql
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
```

- [ ] **Step 6: Create 000008_application_forms.down.sql**

```sql
DROP TABLE IF EXISTS application_forms;
```

- [ ] **Step 7: Create 000009_applications.up.sql**

```sql
CREATE TYPE application_status AS ENUM ('submitted', 'accepted', 'declined');

CREATE TABLE applications (
    id         uuid               PRIMARY KEY DEFAULT gen_random_uuid(),
    form_id    uuid               NOT NULL REFERENCES application_forms(id) ON DELETE CASCADE,
    artist_id  uuid               NOT NULL REFERENCES artist_profiles(id) ON DELETE CASCADE,
    status     application_status NOT NULL DEFAULT 'submitted',
    answers    jsonb              NOT NULL DEFAULT '{}',
    created_at timestamptz        NOT NULL DEFAULT now(),
    updated_at timestamptz        NOT NULL DEFAULT now(),
    UNIQUE (form_id, artist_id)
);
```

- [ ] **Step 8: Create 000009_applications.down.sql**

```sql
DROP TABLE IF EXISTS applications;
DROP TYPE IF EXISTS application_status;
```

- [ ] **Step 9: Verify migration files are named correctly**

```bash
ls db/migrations/ | grep -E "00000[6-9]"
```

Expected output (8 files):
```
000006_festivals.down.sql
000006_festivals.up.sql
000007_festival_artists.down.sql
000007_festival_artists.up.sql
000008_application_forms.down.sql
000008_application_forms.up.sql
000009_applications.down.sql
000009_applications.up.sql
```

- [ ] **Step 10: Commit**

```bash
git add db/migrations/000006_festivals.up.sql \
        db/migrations/000006_festivals.down.sql \
        db/migrations/000007_festival_artists.up.sql \
        db/migrations/000007_festival_artists.down.sql \
        db/migrations/000008_application_forms.up.sql \
        db/migrations/000008_application_forms.down.sql \
        db/migrations/000009_applications.up.sql \
        db/migrations/000009_applications.down.sql
git commit -m "feat(db): add festivals, festival_artists, application_forms, applications migrations"
```
