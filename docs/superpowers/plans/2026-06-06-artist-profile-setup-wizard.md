# Artist Profile Setup Wizard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat artist profile form with a slick, auto-saving 9-step first-run wizard, keeping the single-page editor for later edits, and add a "Support this artist" donation link.

**Architecture:** Three increments. (1) Backend — one migration adds `support_url` + `setup_completed_at` to `artist_profiles`, a `complete-setup` endpoint, and `support_url` write/validate on the existing PATCH. (2) Web wizard — a `'use client'` `ProfileWizard` with internal step index, auto-saving each step via `PATCH /profiles/me`; entry logic redirects un-set-up artists to it. (3) Editor refactor — extract shared field components (mediums chip-picker, support-link input, image slot) used by both wizard and the existing `ProfileForm`, and render the Support button on the public profile.

**Tech Stack:** Go (chi, pgx, sqlc), Postgres (golang-migrate), Next.js App Router + React Query + openapi-typed client (`@render/api-client`), Playwright + Vitest e2e against the Docker Compose stack.

**Spec:** `docs/superpowers/specs/2026-06-06-artist-profile-setup-wizard-design.md`

**Branch:** `feat/artist-profile-setup-wizard` (already checked out; the design spec is committed there).

---

## Conventions for every task

- **Docker mount trap (from e2e-debugging rule):** the API/web containers bind-mount the **main repo** (`/Users/adampowis/workspace/murals`), not any worktree. We are working directly in the main repo here, so a single edit is enough — but after editing Go, confirm the rebuild: `docker compose -f infra/docker-compose.yml logs api --tail=15 | grep -E 'building|running|api starting'`.
- **Stack must be up:** `task up` before running any e2e. Reset DB / apply migrations: `task db:migrate`.
- **sqlc regen:** after editing `db/queries/*.sql` or migrations, run `task db:generate` (regenerates `api/internal/sqlcdb/`). If unavailable, hand-edit per the sqlc-and-schema rule and run the grep-count check shown in Task 1.
- **Commit after each task** with the message shown in its final step.

---

## File Structure

**Create:**
- `db/migrations/000005_profile_setup_fields.up.sql` — adds two columns
- `db/migrations/000005_profile_setup_fields.down.sql` — drops them
- `api/internal/artist/setup.go` — `CompleteSetupHandler`
- `e2e/api/profile-setup-fields.test.ts` — backend canary
- `web/src/lib/mediums.ts` — controlled vocabulary constant
- `web/src/components/MediumPicker.tsx` — chip multi-select + add-your-own
- `web/src/components/SupportLinkField.tsx` — labelled URL input
- `web/src/components/ImageSlot.tsx` — extracted upload slot (shared)
- `web/src/components/wizard/StepShell.tsx` — wizard step chrome
- `web/src/app/(artist)/profile/setup/page.tsx` — wizard server wrapper
- `web/src/app/(artist)/profile/setup/ProfileWizard.tsx` — wizard controller + steps
- `e2e/browser/profile-setup-wizard.spec.ts` — wizard flow test

**Modify:**
- `db/queries/artist_profiles.sql` — `UpdateArtistProfile` sets `support_url`; new `CompleteArtistProfileSetup`; `ClaimArtistProfile` also stamps `setup_completed_at`
- `api/internal/artist/profile.go` — response + update handler carry `support_url` / `setup_completed_at`
- `api/cmd/api/main.go` — register `POST /profiles/me/complete-setup`
- `openapi/openapi.yaml` — `support_url` + `setup_completed_at` on `ArtistProfile`; `supportUrl` on `UpdateProfileRequest`; new path
- `web/src/app/(artist)/profile/page.tsx` — entry logic (redirect to wizard if not set up)
- `web/src/app/(artist)/profile/ProfileForm.tsx` — use shared `ImageSlot`, `MediumPicker`, `SupportLinkField`
- `web/src/app/(public)/artists/[id]/page.tsx` — render Support button
- `api/internal/artist/artist.spec.md`, `web/src/app/(artist)/artist.spec.md`, `db/db.spec.md` — spec updates

---

# Increment 1 — Backend fields

### Task 1: Migration + queries + sqlc regen

**Files:**
- Create: `db/migrations/000005_profile_setup_fields.up.sql`
- Create: `db/migrations/000005_profile_setup_fields.down.sql`
- Modify: `db/queries/artist_profiles.sql`
- Regenerated: `api/internal/sqlcdb/models.go`, `api/internal/sqlcdb/artist_profiles.sql.go`

> Note: the filesystem's highest migration is `000004` (domain-grouped: users, artists, festivals, billing). `db/db.spec.md` says "highest is 000016" — that is **stale**; trust the filesystem. Next number is `000005`. (We fix the stale spec line in Task 11.)

- [ ] **Step 1: Write the up migration**

Create `db/migrations/000005_profile_setup_fields.up.sql`:

```sql
-- Profile setup wizard support.
-- support_url: optional "Support this artist" donation link (Buy Me a Coffee / Ko-fi / etc.)
-- setup_completed_at: stamped when the artist finishes the setup wizard (or on prospect claim);
--                     null means the artist has not completed first-run setup → show the wizard.
ALTER TABLE artist_profiles
    ADD COLUMN support_url        text,
    ADD COLUMN setup_completed_at timestamptz;
```

- [ ] **Step 2: Write the down migration**

Create `db/migrations/000005_profile_setup_fields.down.sql` (reverse order):

```sql
ALTER TABLE artist_profiles
    DROP COLUMN IF EXISTS setup_completed_at,
    DROP COLUMN IF EXISTS support_url;
```

- [ ] **Step 3: Edit the queries**

In `db/queries/artist_profiles.sql`:

Change `UpdateArtistProfile` to set `support_url` (add `$11` and the SET line):

```sql
-- name: UpdateArtistProfile :one
UPDATE artist_profiles
SET display_name        = $2,
    bio                 = $3,
    location_label      = $4,
    show_location       = $5,
    medium_tags         = $6,
    social_links        = $7,
    avatar_s3_key       = $8,
    headline_image_urls = $9,
    visibility          = $10,
    support_url         = $11,
    updated_at          = now()
WHERE id = $1
RETURNING *;
```

Change `ClaimArtistProfile` to also stamp `setup_completed_at` (so claimed prospects skip the wizard):

```sql
-- name: ClaimArtistProfile :one
-- Atomically binds a profile to a user. Returns no row if already claimed
-- (user_id IS NOT NULL) or if the token doesn't exist — caller checks for
-- pgx.ErrNoRows and returns 409. Stamps setup_completed_at so the claimer
-- lands on the editor, not the first-run wizard (the page was pre-built).
UPDATE artist_profiles
SET user_id            = $1,
    claimed_at         = now(),
    setup_completed_at = now(),
    updated_at         = now()
WHERE claim_token = $2
  AND user_id IS NULL
RETURNING *;
```

Add a new query at the end of the file:

```sql
-- name: CompleteArtistProfileSetup :one
-- Idempotently marks first-run setup complete. COALESCE keeps the first
-- completion timestamp if called more than once, and always returns the row.
UPDATE artist_profiles
SET setup_completed_at = COALESCE(setup_completed_at, now()),
    updated_at         = now()
WHERE user_id = $1
RETURNING *;
```

- [ ] **Step 4: Regenerate sqlc**

Run: `task db:generate`
Expected: `api/internal/sqlcdb/models.go` gains `SupportURL *string` and `SetupCompletedAt pgtype.Timestamptz` on `ArtistProfile`; `artist_profiles.sql.go` gains the `CompleteArtistProfileSetup` func, the new `UpdateArtistProfileParams.SupportURL` field, and every `row.Scan(...)` now ends with `&i.SupportURL, &i.SetupCompletedAt`.

If `task db:generate` is unavailable: hand-add the two fields to `ArtistProfile` in `models.go`, add `SupportURL *string` to `UpdateArtistProfileParams` (and pass `arg.SupportURL` as the 11th query arg), append `support_url, setup_completed_at` to every `RETURNING ...` / `SELECT ...` column list in `artist_profiles.sql.go`, append `&i.SupportURL, &i.SetupCompletedAt` to every `row.Scan(`, and write the `CompleteArtistProfileSetup` func by copying `RotateArtistProfilePreviewToken`'s shape.

- [ ] **Step 5: Verify every full-row Scan got both new columns**

The two new fields must be scanned by every query that returns `artist_profiles.*`. There are **14** such queries in this file (Claim, CreateArtistProfile, CreateProspectProfile, GetArtistProfileByClaimToken, GetArtistProfileByID, GetArtistProfileByPreviewToken, GetArtistProfileByUserID, GetProspectByNameAndCreator, ListPublicProfiles, RotateArtistProfilePreviewToken, SetArtistProfileVisibility, SetProspectClaimToken, UpdateArtistProfile, and the new CompleteArtistProfileSetup).

Don't grep total `&i.` count — `GetSpotHistoryForProfile` lives in this same file and scans 7 unrelated fields, so the total is not a clean multiple. Instead check the two new fields directly:

Run: `grep -c 'i\.SupportURL' api/internal/sqlcdb/artist_profiles.sql.go && grep -c 'i\.SetupCompletedAt' api/internal/sqlcdb/artist_profiles.sql.go`
Expected: `14` and `14`. If either is lower, a full-row Scan/RETURNING missed the columns — fix before continuing.

Confirm the model struct gained both fields:
Run: `grep -E 'SupportURL|SetupCompletedAt' api/internal/sqlcdb/models.go`
Expected: both fields present on the `ArtistProfile` struct.

Also confirm no other generated file returns `artist_profiles.*`:
Run: `grep -rl 'FROM artist_profiles' api/internal/sqlcdb/ | grep -v artist_profiles.sql.go`
Expected: no output.

- [ ] **Step 6: Apply the migration and confirm the columns exist**

Run: `task db:migrate`
Then: `docker compose -f infra/docker-compose.yml exec db psql -U render -d render -c "\d artist_profiles" | grep -E 'support_url|setup_completed_at'`
Expected: both columns listed (`support_url | text`, `setup_completed_at | timestamp with time zone`).

- [ ] **Step 7: Confirm the API still builds**

Run: `task api:test`
Expected: PASS (compile + existing tests; nothing references the new fields yet, so behaviour is unchanged).

- [ ] **Step 8: Commit**

```bash
git add db/migrations/000005_profile_setup_fields.up.sql db/migrations/000005_profile_setup_fields.down.sql db/queries/artist_profiles.sql api/internal/sqlcdb/
git commit -m "feat(db): add support_url + setup_completed_at to artist_profiles"
```

---

### Task 2: API — response fields, support_url write, complete-setup endpoint

**Files:**
- Modify: `api/internal/artist/profile.go:35-90` (response struct + `toProfileResponse`), `:269-376` (update handler)
- Create: `api/internal/artist/setup.go`
- Modify: `api/cmd/api/main.go:172` (route)

- [ ] **Step 1: Add the two fields to the response struct**

In `api/internal/artist/profile.go`, add to `profileResponse` (after `PreviewToken`, before `SpotHistory`):

```go
	PreviewToken      *string            `json:"preview_token,omitempty"`
	SupportURL        *string            `json:"support_url,omitempty"`
	SetupCompletedAt  *string            `json:"setup_completed_at,omitempty"`
	SpotHistory       []spotHistoryEntry `json:"spot_history"`
```

- [ ] **Step 2: Populate them in `toProfileResponse`**

In `toProfileResponse`, after the `resp := profileResponse{...}` block and before `if !public || p.ShowLocation {`, add:

```go
	resp.SupportURL = p.SupportURL
	if p.SetupCompletedAt.Valid {
		s := p.SetupCompletedAt.Time.Format(time.RFC3339)
		resp.SetupCompletedAt = &s
	}
```

(`SupportURL` is shown publicly — a donation link is meant to be seen. `SetupCompletedAt` is harmless to expose and the server-rendered `/profile` page reads it for entry routing.)

- [ ] **Step 3: Accept + validate `supportUrl` in the update handler**

In `UpdateProfileHandler`, add `SupportURL *string` to the request struct (after `Visibility`):

```go
			Visibility        *string         `json:"visibility"`
			SupportURL        *string         `json:"supportUrl"`
```

After the `headlineImageUrls` merge block and before the `visibility` block, add the merge + validation:

```go
		supportURL := existing.SupportURL
		if req.SupportURL != nil {
			trimmed := strings.TrimSpace(*req.SupportURL)
			if trimmed == "" {
				supportURL = nil
			} else {
				u, perr := url.Parse(trimmed)
				if perr != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
					httperr.UnprocessableEntity(w, "supportUrl must be a valid http(s) URL")
					return
				}
				supportURL = &trimmed
			}
		}
```

Add `support_url` to the `UpdateArtistProfile` call (after `Visibility: visibility,`):

```go
			Visibility:        visibility,
			SupportURL:        supportURL,
		})
```

Add the imports `"net/url"` and `"strings"` to the import block (keep them ordered with the existing stdlib imports `"strconv"`, `"time"`).

- [ ] **Step 4: Create the complete-setup handler**

Create `api/internal/artist/setup.go`:

```go
package artist

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

// CompleteSetupHandler handles POST /profiles/me/complete-setup.
// Idempotently marks the artist's first-run setup wizard complete so future
// visits to /profile land on the editor instead of the wizard. Requires auth.
func CompleteSetupHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, err := auth.User(r.Context())
		if err != nil {
			httperr.Unauthorized(w)
			return
		}
		userUUID, err := pgUUIDFromString(principal.UserID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		q := sqlcdb.New(pool)
		profile, err := q.CompleteArtistProfileSetup(r.Context(), userUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(toProfileResponse(profile, false))
	}
}
```

- [ ] **Step 5: Register the route**

In `api/cmd/api/main.go`, after the `unpublish` line (`:172`), add (keep the literal-`/me`-before-`/{profileID}` grouping):

```go
		r.Post("/profiles/me/unpublish", artist.UnpublishHandler(pool))                       // literal /me before /{profileID}
		r.Post("/profiles/me/complete-setup", artist.CompleteSetupHandler(pool))              // literal /me before /{profileID}
```

- [ ] **Step 6: Build and confirm the API is running the new binary**

Run: `task api:test`
Expected: PASS.
Then: `docker compose -f infra/docker-compose.yml logs api --tail=15 | grep -E 'building|running|api starting'`
Expected: a fresh `building... → running... → api starting` cycle (air rebuilt). If you see `failed to build`, fix the compile error.

- [ ] **Step 7: Commit**

```bash
git add api/internal/artist/profile.go api/internal/artist/setup.go api/cmd/api/main.go
git commit -m "feat(api): support_url on profile + POST /profiles/me/complete-setup"
```

---

### Task 3: Backend canary (e2e API test)

**Files:**
- Create: `e2e/api/profile-setup-fields.test.ts`

This is the test that actually proves the new columns are scanned (per the sqlc-scan-mismatch rule — it writes a non-zero value and reads it back through the API).

- [ ] **Step 1: Write the canary test**

Create `e2e/api/profile-setup-fields.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createArtist } from '../fixtures/helpers.js'

const API = process.env.API_URL ?? 'http://localhost:8080'

describe('profile setup fields', () => {
  it('support_url round-trips through PATCH and public GET', async () => {
    const { token } = await createArtist()
    await fetch(`${API}/profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ displayName: 'Support Test Artist' }),
    })

    const patch = await fetch(`${API}/profiles/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ supportUrl: 'https://buymeacoffee.com/testartist' }),
    })
    expect(patch.status).toBe(200)
    const patched = await patch.json()
    expect(patched.support_url).toBe('https://buymeacoffee.com/testartist')

    const me = await fetch(`${API}/profiles/me`, { headers: { Authorization: `Bearer ${token}` } })
    const meBody = await me.json()
    expect(meBody.support_url).toBe('https://buymeacoffee.com/testartist')
  })

  it('rejects a non-http(s) support_url with 422', async () => {
    const { token } = await createArtist()
    await fetch(`${API}/profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ displayName: 'Bad URL Artist' }),
    })
    const res = await fetch(`${API}/profiles/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ supportUrl: 'javascript:alert(1)' }),
    })
    expect(res.status).toBe(422)
  })

  it('complete-setup stamps setup_completed_at and is idempotent', async () => {
    const { token } = await createArtist()
    await fetch(`${API}/profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ displayName: 'Setup Test Artist' }),
    })

    const before = await (await fetch(`${API}/profiles/me`, { headers: { Authorization: `Bearer ${token}` } })).json()
    expect(before.setup_completed_at == null).toBe(true)

    const first = await fetch(`${API}/profiles/me/complete-setup`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` },
    })
    expect(first.status).toBe(200)
    const firstBody = await first.json()
    expect(typeof firstBody.setup_completed_at).toBe('string')

    const second = await fetch(`${API}/profiles/me/complete-setup`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` },
    })
    const secondBody = await second.json()
    expect(secondBody.setup_completed_at).toBe(firstBody.setup_completed_at) // COALESCE keeps first stamp
  })
})
```

- [ ] **Step 2: Run the canary**

Run: `npx vitest run e2e/api/profile-setup-fields.test.ts`
Expected: 3 tests PASS. If `support_url` comes back `undefined`, a Scan is missing the column — return to Task 1 Step 5.

- [ ] **Step 3: Commit**

```bash
git add e2e/api/profile-setup-fields.test.ts
git commit -m "test(e2e): canary for support_url round-trip + complete-setup"
```

---

### Task 4: OpenAPI + client regen

**Files:**
- Modify: `openapi/openapi.yaml:224-268` (`ArtistProfile`), `:277-301` (`UpdateProfileRequest`), paths section
- Regenerated: `openapi/` TS client (`@render/api-client`)

- [ ] **Step 1: Add the two fields to the `ArtistProfile` schema**

In `openapi/openapi.yaml`, inside `ArtistProfile.properties`, after the `preview_token` property and before `spot_history`, add:

```yaml
        support_url:
          type: string
          nullable: true
          description: Optional "Support this artist" donation link (http/https). Shown publicly.
        setup_completed_at:
          type: string
          format: date-time
          nullable: true
          description: When the artist completed first-run setup. Null = wizard not yet finished.
```

- [ ] **Step 2: Add `supportUrl` to `UpdateProfileRequest`**

In `UpdateProfileRequest.properties`, after `avatarS3Key`, add:

```yaml
        supportUrl:
          type: string
          nullable: true
          description: Donation link. Empty string clears it; non-empty must be a valid http(s) URL.
```

- [ ] **Step 3: Add the complete-setup path**

Find the path entry for `/profiles/me/unpublish` in `openapi/openapi.yaml` and add a sibling immediately after it (match the surrounding style — copy the unpublish operation and adapt). It needs: `post`, bearer auth, `200` returning `ArtistProfile`, `401`, `404`:

```yaml
  /profiles/me/complete-setup:
    post:
      summary: Mark first-run profile setup complete
      description: Idempotently stamps setup_completed_at so /profile shows the editor, not the wizard.
      tags: [profiles]
      security:
        - bearerAuth: []
      responses:
        '200':
          description: Setup marked complete
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ArtistProfile'
        '401':
          description: Not authenticated
        '404':
          description: No profile for this user
```

- [ ] **Step 4: Regenerate the client**

Run: `task openapi:gen`
Expected: the generated TS client types now include `support_url` / `setup_completed_at` on the profile schema, `supportUrl` on the update body, and the `/profiles/me/complete-setup` path. No errors.

- [ ] **Step 5: Confirm web typechecks against the new client**

Run: `task web:lint` (or `docker compose -f infra/docker-compose.yml exec web npm run typecheck` if exposed)
Expected: PASS — nothing uses the new fields yet, so this only confirms the client regenerated cleanly.

- [ ] **Step 6: Commit**

```bash
git add openapi/
git commit -m "feat(openapi): support_url, setup_completed_at, complete-setup path"
```

---

# Increment 2 — The wizard

### Task 5: Controlled mediums vocabulary + MediumPicker component

**Files:**
- Create: `web/src/lib/mediums.ts`, `web/src/components/MediumPicker.tsx`

- [ ] **Step 1: Create the vocabulary constant**

Create `web/src/lib/mediums.ts`:

```ts
// Controlled vocabulary for artist mediums. Used by the setup wizard and the
// profile editor. medium_tags stays a free string[] server-side, so artists can
// still "add your own" beyond this list — these are just the quick-pick chips.
export const MEDIUMS = [
  'mural',
  'painting',
  'illustration',
  'stencil',
  'paste-up',
  'sculpture',
  'mixed media',
  'lettering',
  'mosaic',
  'installation',
] as const

export type Medium = (typeof MEDIUMS)[number]
```

- [ ] **Step 2: Create the MediumPicker**

Create `web/src/components/MediumPicker.tsx`:

```tsx
'use client'

import { useState, KeyboardEvent } from 'react'
import { MEDIUMS } from '@/lib/mediums'

type Props = {
  value: string[]
  onChange: (next: string[]) => void
}

export function MediumPicker({ value, onChange }: Props) {
  const [custom, setCustom] = useState('')

  function toggle(tag: string) {
    onChange(value.includes(tag) ? value.filter(t => t !== tag) : [...value, tag])
  }

  function addCustom() {
    const t = custom.trim().toLowerCase()
    if (t && !value.includes(t)) onChange([...value, t])
    setCustom('')
  }

  function onCustomKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      addCustom()
    }
  }

  // Custom values the artist already has that aren't in the canonical list.
  const extras = value.filter(t => !MEDIUMS.includes(t as (typeof MEDIUMS)[number]))

  return (
    <div data-testid="medium-picker">
      <div className="flex flex-wrap gap-2">
        {MEDIUMS.map(tag => {
          const on = value.includes(tag)
          return (
            <button
              key={tag}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(tag)}
              className={`font-sans text-sm rounded-full px-3 py-1.5 border transition-colors ${
                on
                  ? 'bg-amber border-amber text-ink'
                  : 'bg-offwhite border-light text-mid hover:border-amber'
              }`}
            >
              {tag}
            </button>
          )
        })}
        {extras.map(tag => (
          <button
            key={tag}
            type="button"
            aria-pressed
            onClick={() => toggle(tag)}
            className="font-sans text-sm rounded-full px-3 py-1.5 border bg-amber border-amber text-ink"
          >
            {tag} ✕
          </button>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <input
          type="text"
          value={custom}
          onChange={e => setCustom(e.target.value)}
          onKeyDown={onCustomKey}
          placeholder="Add your own…"
          aria-label="Add a custom medium"
          className="flex-1 border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite placeholder:text-mid focus:outline-none focus:border-amber"
        />
        <button
          type="button"
          onClick={addCustom}
          className="font-sans text-sm rounded-lg px-4 py-2 border border-light text-ink hover:border-amber"
        >
          Add
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Typecheck**

Run: `task web:lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/mediums.ts web/src/components/MediumPicker.tsx
git commit -m "feat(web): controlled medium vocabulary + MediumPicker"
```

---

### Task 6: SupportLinkField + extracted ImageSlot

**Files:**
- Create: `web/src/components/SupportLinkField.tsx`, `web/src/components/ImageSlot.tsx`

- [ ] **Step 1: Create the SupportLinkField**

Create `web/src/components/SupportLinkField.tsx`:

```tsx
'use client'

type Props = {
  value: string
  onChange: (next: string) => void
}

export function SupportLinkField({ value, onChange }: Props) {
  return (
    <div>
      <input
        type="url"
        inputMode="url"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="https://buymeacoffee.com/yourname"
        aria-label="Support link"
        data-testid="support-link-input"
        className="w-full border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite placeholder:text-mid focus:outline-none focus:border-amber"
      />
      <p className="mt-1 font-sans text-xs text-mid">
        Buy Me a Coffee, Ko-fi, Patreon, or any link where people can support you. Optional.
      </p>
    </div>
  )
}
```

- [ ] **Step 2: Extract the ImageSlot component**

Create `web/src/components/ImageSlot.tsx` (lifted verbatim from `ProfileForm.tsx:27-75`, exported):

```tsx
'use client'

import { useRef } from 'react'

export function ImageSlot({
  url,
  label,
  round,
  onFile,
  isUploading,
}: {
  url: string | null
  label: string
  round?: boolean
  onFile: (file: File) => void
  isUploading: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const shape = round ? 'rounded-full' : 'rounded-lg'
  const size = round ? 'w-24 h-24' : 'w-full h-40'

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={isUploading}
        className={`${size} ${shape} border-2 border-dashed border-light bg-warm flex items-center justify-center overflow-hidden hover:border-amber transition-colors disabled:opacity-50 relative`}
        aria-label={`Upload ${label}`}
      >
        {url ? (
          <img src={url} alt={label} className={`${size} ${shape} object-cover`} />
        ) : (
          <span className="font-mono text-xs uppercase tracking-widest text-mid">
            {isUploading ? '…' : '+'}
          </span>
        )}
      </button>
      <span className="font-sans text-xs text-mid">{label}</span>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="sr-only"
        onChange={e => {
          const file = e.target.files?.[0]
          if (file) onFile(file)
          e.target.value = ''
        }}
      />
    </div>
  )
}
```

- [ ] **Step 3: Typecheck**

Run: `task web:lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/SupportLinkField.tsx web/src/components/ImageSlot.tsx
git commit -m "feat(web): SupportLinkField + extracted ImageSlot"
```

---

### Task 7: StepShell (wizard chrome)

**Files:**
- Create: `web/src/components/wizard/StepShell.tsx`

- [ ] **Step 1: Create StepShell**

Create `web/src/components/wizard/StepShell.tsx`:

```tsx
'use client'

import { ReactNode } from 'react'

type Props = {
  stepIndex: number // 0-based
  total: number
  title: string
  lede?: string
  saved: boolean
  onBack?: () => void
  onSkip?: () => void
  onContinue: () => void
  continueLabel?: string
  busy?: boolean
  children: ReactNode
}

export function StepShell({
  stepIndex,
  total,
  title,
  lede,
  saved,
  onBack,
  onSkip,
  onContinue,
  continueLabel = 'Continue →',
  busy,
  children,
}: Props) {
  return (
    <div className="max-w-xl mx-auto bg-offwhite border border-light rounded-2xl p-8 md:p-10 shadow-sm">
      <div className="flex items-center justify-between mb-7">
        <div className="flex gap-1.5" aria-hidden="true">
          {Array.from({ length: total }).map((_, i) => (
            <span
              key={i}
              className={`h-2 w-2 rounded-full ${
                i < stepIndex ? 'bg-ink' : i === stepIndex ? 'bg-amber scale-125' : 'bg-light'
              }`}
            />
          ))}
        </div>
        <span className="font-mono text-xs uppercase tracking-widest text-mid">
          Step {stepIndex + 1} / {total}
        </span>
      </div>

      <h1 className="font-serif text-3xl md:text-4xl text-ink mb-2">{title}</h1>
      {lede && <p className="font-sans text-mid mb-6 leading-relaxed">{lede}</p>}

      <div className="mb-2">{children}</div>

      <div className="mt-3 flex justify-end">
        <span className="font-mono text-xs text-mid" aria-live="polite">
          {saved ? '✓ Saved automatically' : ''}
        </span>
      </div>

      <div className="mt-6 flex items-center justify-between">
        {onBack ? (
          <button type="button" onClick={onBack} className="font-sans text-sm text-mid hover:text-ink">
            ← Back
          </button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-4">
          {onSkip && (
            <button type="button" onClick={onSkip} className="font-sans text-sm text-mid hover:text-ink">
              Skip for now
            </button>
          )}
          <button
            type="button"
            onClick={onContinue}
            disabled={busy}
            className="bg-amber text-ink font-sans font-medium text-sm rounded-full px-7 py-2.5 hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {busy ? 'Saving…' : continueLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `task web:lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/wizard/StepShell.tsx
git commit -m "feat(web): wizard StepShell chrome"
```

---

### Task 8: ProfileWizard controller + steps

**Files:**
- Create: `web/src/app/(artist)/profile/setup/ProfileWizard.tsx`, `web/src/app/(artist)/profile/setup/page.tsx`

- [ ] **Step 1: Create the wizard server wrapper**

Create `web/src/app/(artist)/profile/setup/page.tsx`:

```tsx
import { requireAuth } from '@/lib/auth-server'
import { cookies } from 'next/headers'
import { createApiClient } from '@render/api-client'
import ProfileWizard from './ProfileWizard'

export default async function ProfileSetupPage() {
  await requireAuth()

  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('session')
  const authedClient = createApiClient({
    baseUrl: process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080',
  })
  if (sessionCookie?.value) {
    const sv = sessionCookie.value
    authedClient.use({ onRequest({ request }) { request.headers.set('Cookie', `session=${sv}`); return request } })
  }

  const profileRes = await authedClient.GET('/profiles/me', {})
  const profile = profileRes.data ?? null

  return (
    <div>
      <ProfileWizard initialProfile={profile} />
    </div>
  )
}
```

- [ ] **Step 2: Create the wizard controller**

Create `web/src/app/(artist)/profile/setup/ProfileWizard.tsx`:

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiClient } from '@/lib/api'
import type { components } from '@render/api-client'
import { StepShell } from '@/components/wizard/StepShell'
import { ImageSlot } from '@/components/ImageSlot'
import { MediumPicker } from '@/components/MediumPicker'
import { SupportLinkField } from '@/components/SupportLinkField'
import { SocialIcon, SOCIAL_PLATFORMS } from '@/components/SocialIcon'
import { useProfileImageUpload } from '@/hooks/useProfileImageUpload'

type ArtistProfile = components['schemas']['ArtistProfile']

const TOTAL = 9

type WizardState = {
  displayName: string
  bio: string
  locationLabel: string
  showLocation: boolean
  mediumTags: string[]
  socialLinks: Record<string, string>
  supportUrl: string
  avatarUrl: string | null
  headlineUrls: (string | null)[]
}

function initState(p: ArtistProfile | null): WizardState {
  const links: Record<string, string> = {}
  for (const { key } of SOCIAL_PLATFORMS) links[key] = p?.social_links?.[key] ?? ''
  const headlines = p?.headline_image_urls ?? []
  return {
    displayName: p?.display_name ?? '',
    bio: p?.bio ?? '',
    locationLabel: p?.location_label ?? '',
    showLocation: true,
    mediumTags: p?.medium_tags ?? [],
    socialLinks: links,
    supportUrl: p?.support_url ?? '',
    avatarUrl: p?.avatar_s3_key ?? null,
    headlineUrls: [headlines[0] ?? null, headlines[1] ?? null, headlines[2] ?? null],
  }
}

export default function ProfileWizard({ initialProfile }: { initialProfile: ArtistProfile | null }) {
  const router = useRouter()
  const [state, setState] = useState<WizardState>(() => initState(initialProfile))
  const [step, setStep] = useState(0)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const profileId = useRef<string | null>(initialProfile?.id ?? null)

  // Resume at the furthest step the artist reached (client-only; data itself is
  // already saved server-side per step).
  const storageKey = 'profile-wizard-step'
  useEffect(() => {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(storageKey) : null
    if (raw) {
      const n = parseInt(raw, 10)
      if (!Number.isNaN(n) && n >= 0 && n < TOTAL) setStep(n)
    }
  }, [])
  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem(storageKey, String(step))
  }, [step])

  function patch<K extends keyof WizardState>(key: K, val: WizardState[K]) {
    setState(s => ({ ...s, [key]: val }))
  }

  // Ensure a profile row exists, then PATCH the given body. Returns false on error.
  async function persist(body: Record<string, unknown>): Promise<boolean> {
    setError(null)
    if (!profileId.current) {
      const created = await apiClient.POST('/profiles', { body: { displayName: state.displayName || 'My profile' } })
      if (created.error || !created.data) {
        setError('Could not create your profile. Try again.')
        return false
      }
      profileId.current = created.data.id
    }
    if (Object.keys(body).length > 0) {
      const res = await apiClient.PATCH('/profiles/me', { body })
      if (res.error) {
        setError('Could not save. Check your details and try again.')
        return false
      }
    }
    setSaved(true)
    return true
  }

  // Save this step's slice, then advance.
  async function next(body: Record<string, unknown>) {
    setBusy(true)
    const ok = await persist(body)
    setBusy(false)
    if (ok) setStep(s => Math.min(s + 1, TOTAL - 1))
  }

  function back() {
    setSaved(false)
    setStep(s => Math.max(s - 1, 0))
  }

  function skip() {
    setSaved(false)
    setStep(s => Math.min(s + 1, TOTAL - 1))
  }

  // Image upload hooks (avatar + 3 headline slots).
  const { upload: uploadAvatar, isUploading: avatarUploading } = useProfileImageUpload(url => patch('avatarUrl', url))
  const setHeadline = (i: number, url: string) =>
    setState(s => { const n = [...s.headlineUrls]; n[i] = url; return { ...s, headlineUrls: n } })
  const h0 = useProfileImageUpload(url => setHeadline(0, url))
  const h1 = useProfileImageUpload(url => setHeadline(1, url))
  const h2 = useProfileImageUpload(url => setHeadline(2, url))
  const headlineHooks = [h0, h1, h2]

  const filteredSocials = () =>
    Object.fromEntries(Object.entries(state.socialLinks).filter(([, v]) => v.trim() !== ''))

  // ── Step bodies ────────────────────────────────────────────────────────────
  const shellBase = { stepIndex: step, total: TOTAL, saved, busy, onBack: step > 0 ? back : undefined }

  if (step === 0) {
    return (
      <Wrap error={error}>
        <StepShell {...shellBase} title="Let's build your page" lede="Start with the name people will know you by."
          onBack={undefined}
          onContinue={() => state.displayName.trim() && next({ displayName: state.displayName.trim() })}>
          <label className="block font-sans text-sm text-ink mb-1">Display name</label>
          <input autoFocus value={state.displayName} onChange={e => patch('displayName', e.target.value)}
            placeholder="e.g. Lady Gabe"
            className="w-full border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite placeholder:text-mid focus:outline-none focus:border-amber" />
        </StepShell>
      </Wrap>
    )
  }

  if (step === 1) {
    return (
      <Wrap error={error}>
        <StepShell {...shellBase} title="Add some photos" lede="A profile picture and up to three headline shots for the top of your page."
          onSkip={skip}
          onContinue={() => next({ avatarS3Key: state.avatarUrl, headlineImageUrls: state.headlineUrls.filter((u): u is string => u !== null) })}>
          <div className="flex items-end gap-4 flex-wrap">
            <ImageSlot url={state.avatarUrl} label="Profile pic" round onFile={uploadAvatar} isUploading={avatarUploading} />
            <div className="flex gap-3 flex-1">
              {[0, 1, 2].map(i => (
                <div key={i} className="flex-1 min-w-0">
                  <ImageSlot url={state.headlineUrls[i]} label={`Photo ${i + 1}`} onFile={headlineHooks[i].upload} isUploading={headlineHooks[i].isUploading} />
                </div>
              ))}
            </div>
          </div>
        </StepShell>
      </Wrap>
    )
  }

  if (step === 2) {
    return (
      <Wrap error={error}>
        <StepShell {...shellBase} title="Tell people who you are"
          lede="Write it like you'd say it. First person, no CV-speak — this is the voice on your public page."
          onSkip={skip} onContinue={() => next({ bio: state.bio })}>
          <div className="flex flex-wrap gap-2 mb-3">
            {['I’m a … based in …', 'My work is about …', 'I started painting when …'].map(p => (
              <button key={p} type="button" onClick={() => patch('bio', state.bio ? state.bio : p)}
                className="font-sans text-xs text-ink bg-warm border border-light rounded-full px-3 py-1.5 hover:border-amber">
                {p}
              </button>
            ))}
          </div>
          <textarea autoFocus value={state.bio} onChange={e => patch('bio', e.target.value)} rows={5}
            className="w-full border border-light rounded-xl px-4 py-3 font-serif text-lg text-ink bg-white focus:outline-none focus:border-amber resize-none" />
          <p className="mt-2 font-mono text-xs text-mid">{state.bio.length} characters · plenty of room</p>
        </StepShell>
      </Wrap>
    )
  }

  if (step === 3) {
    return (
      <Wrap error={error}>
        <StepShell {...shellBase} title="Where are you based?" lede="City or region only — never your address."
          onSkip={skip}
          onContinue={() => next({ locationLabel: state.locationLabel, showLocation: state.showLocation })}>
          <input autoFocus value={state.locationLabel} onChange={e => patch('locationLabel', e.target.value)}
            placeholder="e.g. Cheltenham, UK"
            className="w-full border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite placeholder:text-mid focus:outline-none focus:border-amber" />
          <label className="mt-3 flex items-center gap-2 font-sans text-sm text-ink">
            <input type="checkbox" checked={state.showLocation} onChange={e => patch('showLocation', e.target.checked)} />
            Show this on my public profile
          </label>
        </StepShell>
      </Wrap>
    )
  }

  if (step === 4) {
    return (
      <Wrap error={error}>
        <StepShell {...shellBase} title="What do you make?" lede="Pick the mediums that fit. Add your own if something's missing."
          onSkip={skip} onContinue={() => next({ mediumTags: state.mediumTags })}>
          <MediumPicker value={state.mediumTags} onChange={v => patch('mediumTags', v)} />
        </StepShell>
      </Wrap>
    )
  }

  if (step === 5) {
    return (
      <Wrap error={error}>
        <StepShell {...shellBase} title="Where can people find you?" lede="Add the links you want on your profile."
          onSkip={skip} onContinue={() => next({ socialLinks: filteredSocials() })}>
          <div className="space-y-2">
            {SOCIAL_PLATFORMS.map(({ key, label, placeholder }) => (
              <div key={key} className="flex items-center gap-2">
                <span className="text-mid shrink-0" aria-label={label}><SocialIcon platform={key} /></span>
                <input type="url" aria-label={label} value={state.socialLinks[key] ?? ''}
                  onChange={e => setState(s => ({ ...s, socialLinks: { ...s.socialLinks, [key]: e.target.value } }))}
                  placeholder={placeholder}
                  className="w-full border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite placeholder:text-mid focus:outline-none focus:border-amber" />
              </div>
            ))}
          </div>
        </StepShell>
      </Wrap>
    )
  }

  if (step === 6) {
    return (
      <Wrap error={error}>
        <StepShell {...shellBase} title="Let people support you" lede="Add a tip or support link if you have one. You can always add it later."
          onSkip={skip} onContinue={() => next({ supportUrl: state.supportUrl })}>
          <SupportLinkField value={state.supportUrl} onChange={v => patch('supportUrl', v)} />
        </StepShell>
      </Wrap>
    )
  }

  if (step === 7) {
    return <FirstWorkStep state={state} shellBase={shellBase} onSkip={skip} onDone={() => setStep(8)} error={error} ensureProfile={persist} />
  }

  // step === 8 : review + publish
  return (
    <Wrap error={error}>
      <StepShell {...shellBase} title="You're ready" lede="Here's your page. Publish it now, or finish and publish later."
        onSkip={undefined}
        continueLabel="Publish my page"
        onContinue={async () => {
          setBusy(true)
          const res = await apiClient.POST('/profiles/me/publish', {})
          setBusy(false)
          if (res.error) { setError('Publishing needs an active membership. You can finish and publish from your profile.'); return }
          await apiClient.POST('/profiles/me/complete-setup', {})
          window.localStorage.removeItem(storageKey)
          router.push('/profile')
        }}>
        <div className="rounded-xl border border-light bg-warm p-5">
          <p className="font-serif text-2xl text-ink">{state.displayName || 'Your name'}</p>
          {state.locationLabel && <p className="font-sans text-sm text-mid">{state.locationLabel}</p>}
          {state.bio && <p className="font-sans text-sm text-ink mt-3 leading-relaxed">{state.bio}</p>}
          {state.mediumTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {state.mediumTags.map(t => (
                <span key={t} className="font-mono text-xs uppercase tracking-widest bg-offwhite border border-light text-ink px-2 py-0.5 rounded">{t}</span>
              ))}
            </div>
          )}
        </div>
        <button type="button"
          onClick={async () => {
            await apiClient.POST('/profiles/me/complete-setup', {})
            window.localStorage.removeItem(storageKey)
            router.push('/profile')
          }}
          className="mt-4 font-sans text-sm text-mid hover:text-ink underline">
          Finish for now (publish later)
        </button>
      </StepShell>
    </Wrap>
  )
}

function Wrap({ children, error }: { children: React.ReactNode; error: string | null }) {
  return (
    <div className="py-10">
      {children}
      {error && <p role="alert" className="max-w-xl mx-auto mt-4 font-sans text-sm text-clay">{error}</p>}
    </div>
  )
}

// Optional "first work" step: create one collection, optionally upload a cover.
function FirstWorkStep({
  state, shellBase, onSkip, onDone, error, ensureProfile,
}: {
  state: WizardState
  shellBase: { stepIndex: number; total: number; saved: boolean; busy: boolean; onBack?: () => void }
  onSkip: () => void
  onDone: () => void
  error: string | null
  ensureProfile: (body: Record<string, unknown>) => Promise<boolean>
}) {
  const [name, setName] = useState('')
  const [coverUrl, setCoverUrl] = useState<string | null>(null)
  const [collectionId, setCollectionId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [localErr, setLocalErr] = useState<string | null>(null)
  const cover = useProfileImageUpload(url => setCoverUrl(url))

  async function ensureCollection(): Promise<string | null> {
    if (collectionId) return collectionId
    const res = await apiClient.POST('/collections', { body: { name: name.trim() || 'My first collection' } })
    if (res.error || !res.data) { setLocalErr('Could not create the collection.'); return null }
    setCollectionId(res.data.id)
    return res.data.id
  }

  async function continueStep() {
    setBusy(true)
    setLocalErr(null)
    // Make sure the profile exists (collections hang off the artist).
    await ensureProfile({})
    if (name.trim() || coverUrl) {
      const cid = await ensureCollection()
      if (cid && coverUrl) {
        // Attach the uploaded cover image to the collection.
        await apiClient.POST('/collections/{collectionID}/images', {
          params: { path: { collectionID: cid } },
          body: { s3Key: coverUrl },
        })
      }
    }
    setBusy(false)
    onDone()
  }

  void state
  return (
    <div className="py-10">
      <StepShell {...shellBase} busy={busy} title="Show your first piece"
        lede="Add a collection so your page isn't empty. You can add more in Collections later — this is optional."
        onSkip={onSkip} onContinue={continueStep}>
        <label className="block font-sans text-sm text-ink mb-1">Collection name</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Cheltenham 2026"
          className="w-full border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite placeholder:text-mid focus:outline-none focus:border-amber mb-4" />
        <ImageSlot url={coverUrl} label="Cover image" onFile={cover.upload} isUploading={cover.isUploading} />
      </StepShell>
      {(localErr || error) && <p role="alert" className="max-w-xl mx-auto mt-4 font-sans text-sm text-clay">{localErr || error}</p>}
    </div>
  )
}
```

> Note on the cover attach call: `POST /collections/{collectionID}/images` (route `main.go:193`, handler `AttachImageHandler`) takes an `s3Key`. The `useProfileImageUpload` hook returns the **confirmed CDN URL**, which is what is stored elsewhere on the profile (`avatar_s3_key` holds a URL). If `AttachImageHandler` rejects a URL and wants the raw key, change the body to the key the confirm step returns — verify against `collection_image.go` during implementation and adjust this one call. The step is skippable, so a mismatch here never blocks setup.

- [ ] **Step 2: Typecheck**

Run: `task web:lint`
Expected: PASS. If the `/collections/{collectionID}/images` body type errors, reconcile against the generated client (see the note above).

- [ ] **Step 3: Manual smoke (optional but recommended)**

With the stack up, sign up a fresh artist, verify email, visit `/profile/setup`, and click through. Confirm each Continue shows "✓ Saved automatically" and a reload keeps your answers.

- [ ] **Step 4: Commit**

```bash
git add "web/src/app/(artist)/profile/setup/"
git commit -m "feat(web): 9-step ProfileWizard with per-step auto-save"
```

---

### Task 9: Entry logic — redirect un-set-up artists to the wizard

**Files:**
- Modify: `web/src/app/(artist)/profile/page.tsx`

- [ ] **Step 1: Redirect to the wizard when setup isn't complete**

In `web/src/app/(artist)/profile/page.tsx`, add the `redirect` import and the guard. Replace the top of the component body so that after `profile` is loaded and `justClaimed` computed, it redirects:

```tsx
import { redirect } from 'next/navigation'
```

After the `const justClaimed = params.claimed === '1'` line and before the `return (`, insert:

```tsx
  // First-run artists (setup not completed) go to the guided wizard. Claimed
  // prospects have setup_completed_at stamped at claim time, so they fall through
  // to the editor here (with the celebratory banner).
  if (!profile || profile.setup_completed_at == null) {
    if (!justClaimed) redirect('/profile/setup')
  }
```

(Claimed prospects always have `setup_completed_at` set by the claim flow, so the `!justClaimed` guard is belt-and-braces; it also means a half-finished claim still shows the editor rather than bouncing.)

- [ ] **Step 2: Typecheck**

Run: `task web:lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "web/src/app/(artist)/profile/page.tsx"
git commit -m "feat(web): route un-set-up artists into the setup wizard"
```

---

### Task 10: Wizard e2e (Playwright)

**Files:**
- Create: `e2e/browser/profile-setup-wizard.spec.ts`

- [ ] **Step 1: Write the wizard flow spec**

Create `e2e/browser/profile-setup-wizard.spec.ts` (mirrors `artist-onboarding.spec.ts` setup; uses `forcePublish` to make the page public without billing, then asserts the public page):

```ts
import { test, expect } from '@playwright/test'
import { Client } from 'pg'
import { forcePublish } from '../fixtures/db-helpers.js'
import { verifyEmailViaMailpit } from '../fixtures/mailpit.js'

const API = process.env.API_URL ?? 'http://localhost:8080'
const DB_URL = process.env.DATABASE_URL ?? 'postgres://render:render@localhost:5432/render'

test('profile setup wizard: signup → walk wizard → public page shows bio/mediums/support', async ({ page }) => {
  const suffix = Date.now()
  const email = `wizard-${suffix}@e2e.test`
  const password = 'testpass123'

  // Sign up + verify (lands on /dashboard).
  await page.goto('/signup')
  await page.fill('#email', email)
  await page.fill('#password', password)
  await page.click('button[type=submit]')
  await expect(page.getByText(/check your inbox/i)).toBeVisible()
  await verifyEmailViaMailpit(page, email)
  await expect(page).toHaveURL('/dashboard')

  // Visiting /profile must redirect a brand-new artist to the wizard.
  await page.goto('/profile')
  await expect(page).toHaveURL(/\/profile\/setup$/)

  // Step 1 — name.
  await expect(page.getByRole('heading', { name: "Let's build your page" })).toBeVisible()
  await page.getByLabel('Display name').fill('Wizard Test Artist')
  await page.getByRole('button', { name: /Continue/ }).click()

  // Step 2 — photos: skip.
  await expect(page.getByRole('heading', { name: 'Add some photos' })).toBeVisible()
  await page.getByRole('button', { name: 'Skip for now' }).click()

  // Step 3 — bio.
  await expect(page.getByRole('heading', { name: 'Tell people who you are' })).toBeVisible()
  await page.locator('textarea').fill('I paint bold folkloric murals across the South West.')
  await page.getByRole('button', { name: /Continue/ }).click()

  // Step 4 — location: skip.
  await expect(page.getByRole('heading', { name: 'Where are you based?' })).toBeVisible()
  await page.getByRole('button', { name: 'Skip for now' }).click()

  // Step 5 — mediums: pick two.
  await expect(page.getByRole('heading', { name: 'What do you make?' })).toBeVisible()
  await page.getByTestId('medium-picker').getByRole('button', { name: 'mural' }).click()
  await page.getByTestId('medium-picker').getByRole('button', { name: 'lettering' }).click()
  await page.getByRole('button', { name: /Continue/ }).click()

  // Step 6 — social: skip.
  await expect(page.getByRole('heading', { name: 'Where can people find you?' })).toBeVisible()
  await page.getByRole('button', { name: 'Skip for now' }).click()

  // Step 7 — support link.
  await expect(page.getByRole('heading', { name: 'Let people support you' })).toBeVisible()
  await page.getByTestId('support-link-input').fill('https://buymeacoffee.com/wizardartist')
  await page.getByRole('button', { name: /Continue/ }).click()

  // Step 8 — first work: skip.
  await expect(page.getByRole('heading', { name: 'Show your first piece' })).toBeVisible()
  await page.getByRole('button', { name: 'Skip for now' }).click()

  // Step 9 — review. Finish for now (avoids the billing gate in the test).
  await expect(page.getByRole('heading', { name: "You're ready" })).toBeVisible()
  await page.getByRole('button', { name: /Finish for now/ }).click()
  await expect(page).toHaveURL('/profile')

  // Grab the profile id and force-publish (bypasses billing), then assert public page.
  const me = await page.request.get(`${API}/profiles/me`)
  const profile = await me.json()
  expect(profile.support_url).toBe('https://buymeacoffee.com/wizardartist')
  expect(profile.setup_completed_at).toBeTruthy()

  const db = new Client({ connectionString: DB_URL })
  await db.connect()
  await forcePublish(db, profile.id)
  await db.end()

  await page.goto(`/artists/${profile.id}`)
  await expect(page.getByRole('heading', { name: 'Wizard Test Artist' })).toBeVisible()
  await expect(page.getByText('I paint bold folkloric murals across the South West.')).toBeVisible()
  await expect(page.getByText('mural', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: /support/i })).toBeVisible()

  // Re-visiting /profile now lands on the editor, not the wizard.
  await page.goto('/profile')
  await expect(page).toHaveURL('/profile')
  await expect(page.getByRole('heading', { name: 'Profile', exact: true })).toBeVisible()
})
```

- [ ] **Step 2: Run the spec**

Run: `npx playwright test e2e/browser/profile-setup-wizard.spec.ts`
Expected: PASS. The Support link assertion depends on Task 11 (public-page button) — if you run this before Task 11, the final `support` link assertion fails; either do Task 11 first or temporarily comment that one line and restore it after Task 11.

If `forcePublish` signature differs, open `e2e/fixtures/db-helpers.ts` and match its actual parameters (it is used the same way in `artist-onboarding.spec.ts`).

- [ ] **Step 3: Commit**

```bash
git add e2e/browser/profile-setup-wizard.spec.ts
git commit -m "test(e2e): profile setup wizard end-to-end flow"
```

---

# Increment 3 — Editor refactor + public Support button + specs

### Task 11: Public Support button + editor reuse + spec updates

**Files:**
- Modify: `web/src/app/(public)/artists/[id]/page.tsx` (Support button)
- Modify: `web/src/app/(artist)/profile/ProfileForm.tsx` (use shared components)
- Modify: `api/internal/artist/artist.spec.md`, `web/src/app/(artist)/artist.spec.md`, `db/db.spec.md`

- [ ] **Step 1: Render the Support button on the public profile**

In `web/src/app/(public)/artists/[id]/page.tsx`, inside `<header>`, after the `<SocialLinks .../>` line and before the "Endorse this artist" `<Link>`, add:

```tsx
          {profile.support_url && (
            <a
              href={profile.support_url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="inline-block mt-4 mr-3 font-mono text-xs uppercase tracking-widest bg-amber text-ink hover:opacity-90 px-4 py-2 rounded transition-opacity"
            >
              Support this artist
            </a>
          )}
```

- [ ] **Step 2: Reuse shared components in the editor**

In `web/src/app/(artist)/profile/ProfileForm.tsx`:

(a) Delete the inline `ImageSlot` function (lines ~27-75) and import the shared one. At the top with the other imports add:

```tsx
import { ImageSlot } from '@/components/ImageSlot'
import { MediumPicker } from '@/components/MediumPicker'
import { SupportLinkField } from '@/components/SupportLinkField'
```

(b) Replace the medium-tags `<input>` block (the `Medium tags` label + text input + helper `<p>`) with the picker. Change the medium state from the comma string to an array — replace:

```tsx
  const [mediumTags, setMediumTags] = useState((profile?.medium_tags ?? []).join(', '))
```

with:

```tsx
  const [mediumTags, setMediumTags] = useState<string[]>(profile?.medium_tags ?? [])
```

and replace the JSX block:

```tsx
      <div>
        <label className="block font-sans text-sm text-ink mb-1">Medium tags</label>
        <MediumPicker value={mediumTags} onChange={setMediumTags} />
      </div>
```

and in `handleSubmit`, change the `mediumTags` payload from `mediumTags.split(',')...` to just `mediumTags`:

```tsx
      mediumTags,
```

(c) Add a support link field + state. Add state near the others:

```tsx
  const [supportUrl, setSupportUrl] = useState(profile?.support_url ?? '')
```

Add to the mutation body in **both** the create and update branches (alongside `socialLinks`):

```tsx
            supportUrl,
```

Extend the mutation's `data` type with `supportUrl: string` and pass `supportUrl` in `mutation.mutate({...})`. Then add the field to the form (after the Social links fieldset):

```tsx
      <div>
        <label className="block font-sans text-sm text-ink mb-1">Support link</label>
        <SupportLinkField value={supportUrl} onChange={setSupportUrl} />
      </div>
```

- [ ] **Step 3: Typecheck + run the full browser suite**

Run: `task web:lint`
Expected: PASS.
Run: `npx playwright test e2e/browser/profile-setup-wizard.spec.ts e2e/browser/artist-onboarding.spec.ts`
Expected: PASS (wizard spec's Support assertion now satisfied; onboarding spec — which edits the profile — still works with the new MediumPicker/SupportLinkField).

> The onboarding spec fills mediums via the old text input if it asserted on it. Check `artist-onboarding.spec.ts` for any `Medium tags` text-input interaction; if present, update it to click `medium-picker` chips. (At the time of writing it only fills display name + bio, so no change is expected.)

- [ ] **Step 4: Update the specs**

In `api/internal/artist/artist.spec.md` — under `## Contract`, add a bullet:

```
- Support link: `support_url` (nullable http(s)) on profile responses + `supportUrl` on PATCH /profiles/me (422 on malformed URL)
- Setup completion: `setup_completed_at` on profile responses; `POST /profiles/me/complete-setup` stamps it idempotently; claiming a prospect also stamps it
```

and add a Changelog line:

```
2026-06-06 — Profile setup wizard backend: support_url + setup_completed_at columns; complete-setup endpoint; claim stamps setup_completed_at.
```

In `web/src/app/(artist)/artist.spec.md` — under `## AI Context`, add:

```
- `profile/setup/`: first-run wizard (`ProfileWizard`) — one `'use client'` component, internal step index, auto-saves each step via PATCH /profiles/me. `profile/page.tsx` redirects here when `setup_completed_at` is null.
- Shared field components live in `web/src/components/`: `MediumPicker`, `SupportLinkField`, `ImageSlot` — used by BOTH the wizard and `ProfileForm`. Edit the shared component, not one copy.
```

and a Changelog line:

```
2026-06-06 — Added profile setup wizard (profile/setup/) + shared field components; editor reuses them.
```

In `db/db.spec.md` — fix the stale migration count. Change the `## Contract` line and the `## AI Context` line that say `000001_... through 000016_...` / `current highest is 000016` to reflect reality:

```
- `db/migrations/`: golang-migrate up/down SQL files, domain-grouped (`000001_users` … `000005_profile_setup_fields`); current highest is `000005`
```

and add a Changelog line:

```
2026-06-06 — Corrected stale migration count (filesystem highest is 000005, not 000016); added profile setup fields migration.
```

- [ ] **Step 5: Commit**

```bash
git add "web/src/app/(public)/artists/[id]/page.tsx" "web/src/app/(artist)/profile/ProfileForm.tsx" api/internal/artist/artist.spec.md "web/src/app/(artist)/artist.spec.md" db/db.spec.md
git commit -m "feat(web): public Support button + editor reuses shared fields; spec updates"
```

---

## Final verification

- [ ] **Run the API gate + the two relevant browser specs:**

```bash
task e2e:api
npx playwright test e2e/browser/profile-setup-wizard.spec.ts e2e/browser/artist-onboarding.spec.ts
```
Expected: all PASS.

- [ ] **Manual walkthrough:** fresh signup → `/profile` redirects to `/profile/setup` → walk all 9 steps (try Skip on a couple) → Finish → `/profile` shows the editor → edit a medium chip + support link → save → public `/artists/{id}` shows the Support button and the bio.

- [ ] **Open a PR** (per the separate-commit/PR preference):

```bash
git push -u origin feat/artist-profile-setup-wizard
gh pr create --title "Artist profile setup wizard" --body "<summary + screenshots>"
```

---

## Follow-ons after this PR

This plan ships one cohesive feature. The items below are **deliberately out of scope** here (per the design spec) and are the natural next steps once this merges. Each needs its **own** brainstorm → spec → plan cycle — they are not extensions of this branch.

| Follow-on | What it is | Why separate | Rough size |
|---|---|---|---|
| **Festival history on profile** | Surface the existing `spot_history` (E26) as a "Festivals" section on the public profile and (optionally) the editor | Public-page display feature, not a setup input; data already exists server-side | Small–medium (web-only) |
| **Work map** | Aggregate all collection location-pins onto one profile map, colour-coded by collection | Touches the Leaflet map stack and collection-image pin data; display feature | Medium (web + possibly a pins endpoint) |
| **AI onboarding (E19, iceboxed)** | Pre-fill wizard steps from a pasted link / existing site so setup is near-zero-effort | Layers *on top of* this wizard; needs an extraction service + provider decision | Large; revisit post-pilot |

Two knobs this PR settled rather than deferred (noted so they're not re-litigated): `complete-setup` is a dedicated idempotent endpoint (not folded into publish), and the medium vocabulary is the 10-term list in `web/src/lib/mediums.ts` (extend by editing that constant).

When picking up a follow-on: start a fresh `brainstorming` pass — don't graft it onto `feat/artist-profile-setup-wizard`.

## Self-review notes (addressed)

- **Spec coverage:** wizard shape (Tasks 7-9), 9 steps incl. controlled mediums (Task 5) + support link (Tasks 6, 11) + first work (Task 8 / FirstWorkStep), single-page editor retained & refactored (Task 11), entry via `setup_completed_at` (Tasks 1-2, 9), `support_url` ungated full-stack (Tasks 1-4, 11), out-of-scope items untouched, tests (Tasks 3, 10) — all present.
- **Type consistency:** `WizardState` is the single state type; `MediumPicker`/`SupportLinkField`/`ImageSlot` signatures match their call sites in both wizard and editor; `support_url`/`supportUrl` naming follows the existing camelCase-request / snake_case-response convention.
- **Known soft spot:** the `FirstWorkStep` cover-image attach call (`/collections/{collectionID}/images` body shape) is flagged for verification against `collection_image.go` at implementation time; the step is skippable so it cannot block the flow.
