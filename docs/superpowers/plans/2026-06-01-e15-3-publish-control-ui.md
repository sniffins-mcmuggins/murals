# E15.3 — Artist Publish Control UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `POST /profiles/me/publish` + `POST /profiles/me/unpublish` API endpoints and a `PublishBar` web component so artists can publish, unpublish, and copy their preview link from the profile page.

**Architecture:** Two thin handler functions in `api/internal/artist/publish.go` wrap a new targeted SQL query. The web profile page gains a `PublishBar` client component that calls those endpoints and shows the live status + upsell when not entitled. A browser E2E spec covers the entitled and non-entitled paths.

**Tech Stack:** Go + chi + pgx/sqlc, Next.js App Router (client component), Playwright (E2E), Vitest (API unit tests).

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| Modify | `db/queries/artist_profiles.sql` | Add `SetArtistProfileVisibility` targeted UPDATE query |
| Modify | `api/internal/sqlcdb/artist_profiles.sql.go` | Regenerated — add new query method |
| **Create** | `api/internal/artist/publish.go` | `PublishHandler`, `UnpublishHandler` |
| **Create** | `api/internal/artist/publish_test.go` | Unit tests for both handlers |
| Modify | `api/cmd/api/main.go` | Register the two new routes (before `/{profileID}`) |
| Modify | `openapi/openapi.yaml` | Add `preview_token` to `ArtistProfile`; add publish/unpublish paths |
| Modify | `e2e/fixtures/db-helpers.ts` | Add `forceGrant` helper |
| **Create** | `web/src/app/(artist)/profile/PublishBar.tsx` | Client component: status pill, copy link, Go Public, Take Offline, upsell |
| Modify | `web/src/app/(artist)/profile/page.tsx` | Mount `PublishBar` above `ProfileForm` |
| **Create** | `e2e/browser/artist-publish-control.spec.ts` | Browser E2E: entitled publish/unpublish, non-entitled upsell |

---

### Task 1: Add `SetArtistProfileVisibility` SQL query and regenerate

**Files:**
- Modify: `db/queries/artist_profiles.sql`
- Modify (generated): `api/internal/sqlcdb/artist_profiles.sql.go`

- [ ] **Step 1.1: Add the query**

Append to `db/queries/artist_profiles.sql`:

```sql
-- name: SetArtistProfileVisibility :one
UPDATE artist_profiles
SET visibility = $2,
    updated_at = now()
WHERE user_id = $1
RETURNING *;
```

- [ ] **Step 1.2: Regenerate sqlc**

```bash
task db:generate
```

Expected: exits 0. `api/internal/sqlcdb/artist_profiles.sql.go` gains a `SetArtistProfileVisibility` method.

- [ ] **Step 1.3: Verify the generated method exists**

```bash
grep -n "SetArtistProfileVisibility" api/internal/sqlcdb/artist_profiles.sql.go
```

Expected: two matches — the `const` and the `func`.

- [ ] **Step 1.4: Commit**

```bash
git add db/queries/artist_profiles.sql api/internal/sqlcdb/artist_profiles.sql.go
git commit -m "feat(db): add SetArtistProfileVisibility query for targeted visibility update"
```

---

### Task 2: Write failing tests for publish and unpublish handlers

**Files:**
- Create: `api/internal/artist/publish_test.go`

- [ ] **Step 2.1: Create the test file**

Create `api/internal/artist/publish_test.go`:

```go
package artist_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/sniffins-mcmuggins/render/api/internal/artist"
	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

// ── Publish ──────────────────────────────────────────────────────────────────

func TestPublishHandler_EntitledArtist(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	userID, token, _ := testutil.CreateUser(t, db)
	createTestProfile(t, db, userID, "Alice")
	grantArtistBasic(t, db, userID)

	handler := auth.Middleware(db, testSecret)(artist.PublishHandler(db))
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/profiles/me/publish", bytes.NewBufferString("{}"))
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	var resp map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	assert.Equal(t, "public", resp["visibility"])
}

func TestPublishHandler_NotEntitled(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	userID, token, _ := testutil.CreateUser(t, db)
	createTestProfile(t, db, userID, "Bob")

	handler := auth.Middleware(db, testSecret)(artist.PublishHandler(db))
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/profiles/me/publish", bytes.NewBufferString("{}"))
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	require.Equal(t, http.StatusPaymentRequired, w.Code, w.Body.String())
	var resp map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	assert.Equal(t, "payment_required", resp["code"])
}

func TestPublishHandler_AlreadyPublic(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	userID, token, _ := testutil.CreateUser(t, db)
	profileID := createTestProfile(t, db, userID, "Carol")
	publishTestProfile(t, db, profileID)

	handler := auth.Middleware(db, testSecret)(artist.PublishHandler(db))
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/profiles/me/publish", bytes.NewBufferString("{}"))
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	var resp map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	assert.Equal(t, "public", resp["visibility"])
}

func TestPublishHandler_NoProfile(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	_, token, _ := testutil.CreateUser(t, db)

	handler := auth.Middleware(db, testSecret)(artist.PublishHandler(db))
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/profiles/me/publish", bytes.NewBufferString("{}"))
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestPublishHandler_Unauthenticated(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)

	handler := auth.Middleware(db, testSecret)(artist.PublishHandler(db))
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/profiles/me/publish", bytes.NewBufferString("{}"))
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

// ── Unpublish ─────────────────────────────────────────────────────────────────

func TestUnpublishHandler_Success(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	userID, token, _ := testutil.CreateUser(t, db)
	profileID := createTestProfile(t, db, userID, "Dave")
	publishTestProfile(t, db, profileID)

	handler := auth.Middleware(db, testSecret)(artist.UnpublishHandler(db))
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/profiles/me/unpublish", bytes.NewBufferString("{}"))
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	var resp map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	assert.Equal(t, "draft", resp["visibility"])
}

func TestUnpublishHandler_AlreadyDraft(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	userID, token, _ := testutil.CreateUser(t, db)
	createTestProfile(t, db, userID, "Eve")

	handler := auth.Middleware(db, testSecret)(artist.UnpublishHandler(db))
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/profiles/me/unpublish", bytes.NewBufferString("{}"))
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	var resp map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	assert.Equal(t, "draft", resp["visibility"])
}

func TestUnpublishHandler_NoProfile(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	_, token, _ := testutil.CreateUser(t, db)

	handler := auth.Middleware(db, testSecret)(artist.UnpublishHandler(db))
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/profiles/me/unpublish", bytes.NewBufferString("{}"))
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestUnpublishHandler_Unauthenticated(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)

	handler := auth.Middleware(db, testSecret)(artist.UnpublishHandler(db))
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/profiles/me/unpublish", bytes.NewBufferString("{}"))
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}
```

- [ ] **Step 2.2: Run tests — expect compile error (PublishHandler undefined)**

```bash
task api:test
```

Expected: compile error: `undefined: artist.PublishHandler`. This is the red state.

---

### Task 3: Implement PublishHandler and UnpublishHandler

**Files:**
- Create: `api/internal/artist/publish.go`

- [ ] **Step 3.1: Create the handler file**

Create `api/internal/artist/publish.go`:

```go
package artist

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/billing"
	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

// PublishHandler handles POST /profiles/me/publish.
// Flips the caller's profile from draft to public, gated on entitlement.
// Idempotent: already-public profiles return 200 immediately.
func PublishHandler(pool *pgxpool.Pool) http.HandlerFunc {
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
		existing, err := q.GetArtistProfileByUserID(r.Context(), userUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}

		if existing.Visibility == "public" {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(toProfileResponse(existing, false))
			return
		}

		canPub, err := billing.CanPublish(r.Context(), pool, userUUID)
		if err != nil {
			slog.Error("publish: check entitlement", "err", err, "user_id", principal.UserID)
			httperr.InternalServerError(w)
			return
		}
		if !canPub {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusPaymentRequired)
			_ = json.NewEncoder(w).Encode(map[string]string{
				"code":    "payment_required",
				"message": "An active artist subscription or comp grant is required to publish.",
			})
			return
		}

		updated, err := q.SetArtistProfileVisibility(r.Context(), sqlcdb.SetArtistProfileVisibilityParams{
			UserID:     userUUID,
			Visibility: "public",
		})
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(toProfileResponse(updated, false))
	}
}

// UnpublishHandler handles POST /profiles/me/unpublish.
// Flips the caller's profile from public to draft. Always allowed.
// Idempotent: already-draft profiles return 200 immediately.
func UnpublishHandler(pool *pgxpool.Pool) http.HandlerFunc {
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
		existing, err := q.GetArtistProfileByUserID(r.Context(), userUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}

		if existing.Visibility == "draft" {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(toProfileResponse(existing, false))
			return
		}

		updated, err := q.SetArtistProfileVisibility(r.Context(), sqlcdb.SetArtistProfileVisibilityParams{
			UserID:     userUUID,
			Visibility: "draft",
		})
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(toProfileResponse(updated, false))
	}
}
```

- [ ] **Step 3.2: Run tests — expect all to pass**

```bash
task api:test
```

Expected: all tests in `api/internal/artist/` pass, including the 9 new ones.

- [ ] **Step 3.3: Commit**

```bash
git add api/internal/artist/publish.go api/internal/artist/publish_test.go
git commit -m "feat(artist): E15.3 — publish and unpublish handlers with entitlement gate"
```

---

### Task 4: Register routes in main.go

**Files:**
- Modify: `api/cmd/api/main.go`

- [ ] **Step 4.1: Add the routes**

In `api/cmd/api/main.go`, after line `r.Post("/profiles/me/preview-token/rotate", ...)`, add:

```go
r.Post("/profiles/me/publish", artist.PublishHandler(pool))    // literal /me before /{profileID}
r.Post("/profiles/me/unpublish", artist.UnpublishHandler(pool)) // literal /me before /{profileID}
```

The block should look like:

```go
r.Get("/profiles/me", artist.GetMyProfileHandler(pool))
r.Patch("/profiles/me", artist.UpdateProfileHandler(pool))
r.Get("/profiles/me/qr", artist.ProfileQRHandler(pool, cfg.WebPublicBase))          // literal /me before /{profileID}
r.Get("/profiles/me/analytics", analytics.MyAnalyticsHandler(pool))                 // literal /me before /{profileID}
r.Post("/profiles/me/preview-token/rotate", artist.RotatePreviewTokenHandler(pool)) // literal /me before /{profileID}
r.Post("/profiles/me/publish", artist.PublishHandler(pool))                          // literal /me before /{profileID}
r.Post("/profiles/me/unpublish", artist.UnpublishHandler(pool))                      // literal /me before /{profileID}
r.Get("/profiles/preview/{token}", artist.PreviewByTokenHandler(pool))              // literal /preview before /{profileID}
```

- [ ] **Step 4.2: Compile check**

```bash
task api:test
```

Expected: passes (all existing + new tests).

- [ ] **Step 4.3: Commit**

```bash
git add api/cmd/api/main.go
git commit -m "feat(api): register publish/unpublish routes for E15.3"
```

---

### Task 5: Update OpenAPI spec and regenerate TypeScript client

**Files:**
- Modify: `openapi/openapi.yaml`

- [ ] **Step 5.1: Add `preview_token` to ArtistProfile schema**

In `openapi/openapi.yaml`, find the `ArtistProfile` schema (around line 155). After the `updated_at` property, add:

```yaml
        preview_token:
          type: string
          description: >-
            Opaque preview token. Only present in owner-facing responses
            (GET /profiles/me, POST /profiles/me/publish, POST /profiles/me/unpublish).
            Share /profiles/preview/{token} for pre-publish access. Omitted from
            public responses.
```

- [ ] **Step 5.2: Add publish and unpublish path entries**

In `openapi/openapi.yaml`, after the `/profiles/me/analytics` path block (around line 1190), add:

```yaml
  /profiles/me/publish:
    post:
      operationId: publishProfile
      summary: Publish own artist profile (draft → public)
      description: >-
        Flips the authenticated artist's profile from draft to public.
        Requires an active artist subscription or comp grant — returns 402
        with a payment_required payload if not entitled. Idempotent if
        already public.
      tags: [artist]
      security:
        - cookieAuth: []
        - bearerAuth: []
      responses:
        "200":
          description: Updated profile (visibility is now public).
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ArtistProfile"
        "402":
          description: Payment required — no active subscription or comp grant.
          content:
            application/json:
              schema:
                type: object
                required: [code, message]
                properties:
                  code:
                    type: string
                    example: payment_required
                  message:
                    type: string
        "401":
          $ref: "#/components/responses/Unauthorized"
        "404":
          $ref: "#/components/responses/NotFound"

  /profiles/me/unpublish:
    post:
      operationId: unpublishProfile
      summary: Unpublish own artist profile (public → draft)
      description: >-
        Flips the authenticated artist's profile from public to draft.
        Always allowed regardless of subscription state. Idempotent if
        already draft.
      tags: [artist]
      security:
        - cookieAuth: []
        - bearerAuth: []
      responses:
        "200":
          description: Updated profile (visibility is now draft).
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ArtistProfile"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "404":
          $ref: "#/components/responses/NotFound"
```

- [ ] **Step 5.3: Regenerate the TypeScript client**

```bash
task openapi:gen
```

Expected: exits 0. `openapi/` TS generated files updated.

- [ ] **Step 5.4: Verify the new operations are in the generated client**

```bash
grep -r "publishProfile\|unpublishProfile\|preview_token" openapi/ | head -10
```

Expected: hits in the generated TypeScript files.

- [ ] **Step 5.5: Commit**

```bash
git add openapi/openapi.yaml openapi/
git commit -m "feat(openapi): add preview_token field and publish/unpublish endpoints for E15.3"
```

---

### Task 6: Add `forceGrant` to db-helpers

**Files:**
- Modify: `e2e/fixtures/db-helpers.ts`

- [ ] **Step 6.1: Append forceGrant**

In `e2e/fixtures/db-helpers.ts`, after the `forcePublish` export, add:

```typescript
// forceGrant inserts an access_grants row for the given user so they pass
// billing.CanPublish. Use only in tests that are NOT testing the grant flow.
// Uses the userId as granted_by (self-grant shortcut — valid FK, test-only).
export async function forceGrant(db: Client, userId: string, plan = 'artist_basic'): Promise<void> {
  await db.query(
    `INSERT INTO access_grants (user_id, plan, valid_until, granted_by)
     VALUES ($1, $2, now() + interval '30 days', $1)`,
    [userId, plan],
  )
}
```

- [ ] **Step 6.2: Commit**

```bash
git add e2e/fixtures/db-helpers.ts
git commit -m "test(e2e): add forceGrant db helper for bypass-entitlement test setup"
```

---

### Task 7: Build the PublishBar component

**Files:**
- Create: `web/src/app/(artist)/profile/PublishBar.tsx`

- [ ] **Step 7.1: Create the component**

Create `web/src/app/(artist)/profile/PublishBar.tsx`:

```tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { apiClient } from '@/lib/api'
import type { components } from '@render/api-client'

type ArtistProfile = components['schemas']['ArtistProfile']

export default function PublishBar({ initialProfile }: { initialProfile: ArtistProfile | null }) {
  const [profile, setProfile] = useState(initialProfile)
  const [showUpsell, setShowUpsell] = useState(false)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!profile) return null

  async function handlePublish() {
    setBusy(true)
    setError(null)
    setShowUpsell(false)
    const res = await apiClient.POST('/profiles/me/publish', {})
    setBusy(false)
    if (res.response.status === 402) {
      setShowUpsell(true)
      return
    }
    if (!res.data) {
      setError('Something went wrong. Please try again.')
      return
    }
    setProfile(res.data)
  }

  async function handleUnpublish() {
    setBusy(true)
    setError(null)
    const res = await apiClient.POST('/profiles/me/unpublish', {})
    setBusy(false)
    if (!res.data) {
      setError('Something went wrong. Please try again.')
      return
    }
    setProfile(res.data)
    setShowUpsell(false)
  }

  function handleCopyPreviewLink() {
    const token = profile?.preview_token
    if (!token) return
    const url = `${window.location.origin}/profiles/preview/${token}`
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const isDraft = profile.visibility === 'draft'

  return (
    <div className="mb-8 space-y-3" data-testid="publish-bar">
      <div className="flex items-center gap-4 flex-wrap">
        <span
          data-testid="visibility-badge"
          className={`font-mono text-xs uppercase tracking-wider px-2 py-1 rounded border ${
            isDraft
              ? 'bg-warm text-mid border-light'
              : 'bg-amber text-ink border-amber'
          }`}
        >
          {isDraft ? 'Draft' : 'Public'}
        </span>

        {profile.preview_token && (
          <button
            type="button"
            onClick={handleCopyPreviewLink}
            className="font-sans text-sm text-ink underline hover:text-amber transition-colors"
          >
            {copied ? 'Copied!' : 'Copy preview link'}
          </button>
        )}

        {isDraft ? (
          <button
            type="button"
            onClick={handlePublish}
            disabled={busy}
            className="px-5 py-2 bg-amber text-ink font-sans font-medium text-sm rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {busy ? 'Publishing…' : 'Go Public'}
          </button>
        ) : (
          <button
            type="button"
            onClick={handleUnpublish}
            disabled={busy}
            className="px-5 py-2 border border-light text-mid font-sans text-sm rounded-lg hover:border-clay hover:text-clay transition-colors disabled:opacity-50"
          >
            {busy ? 'Taking offline…' : 'Take Offline'}
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="font-sans text-sm text-clay">
          {error}
        </p>
      )}

      {showUpsell && (
        <div className="p-4 bg-warm border border-light rounded-lg" data-testid="upsell-panel">
          <p className="font-sans text-sm text-ink mb-3">
            An active subscription is required to make your profile public.
          </p>
          <Link
            href="/billing"
            className="inline-block px-5 py-2 bg-amber text-ink font-sans text-sm rounded-lg hover:opacity-90 transition-opacity"
          >
            View plans
          </Link>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 7.2: Commit**

```bash
git add web/src/app/(artist)/profile/PublishBar.tsx
git commit -m "feat(web): E15.3 — PublishBar component (status, copy preview, publish/unpublish, upsell)"
```

---

### Task 8: Mount PublishBar in the profile page

**Files:**
- Modify: `web/src/app/(artist)/profile/page.tsx`

- [ ] **Step 8.1: Update the page**

Replace the current `web/src/app/(artist)/profile/page.tsx` with:

```tsx
import { requireAuth } from '@/lib/auth-server'
import { cookies } from 'next/headers'
import { createApiClient } from '@render/api-client'
import ProfileForm from './ProfileForm'
import PublishBar from './PublishBar'

export default async function ProfilePage() {
  const user = await requireAuth()

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
      <h1 className="font-serif text-4xl text-ink mb-2">Profile</h1>
      <p className="font-sans text-mid mb-8">How the world sees you.</p>
      <PublishBar initialProfile={profile} />
      <ProfileForm profile={profile} userId={user.id} />
    </div>
  )
}
```

- [ ] **Step 8.2: TypeScript check**

```bash
cd web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 8.3: Commit**

```bash
git add web/src/app/(artist)/profile/page.tsx
git commit -m "feat(web): mount PublishBar on profile page"
```

---

### Task 9: Write browser E2E test

**Files:**
- Create: `e2e/browser/artist-publish-control.spec.ts`

- [ ] **Step 9.1: Create the spec**

Create `e2e/browser/artist-publish-control.spec.ts`:

```typescript
import { test, expect } from '@playwright/test'
import { Client } from 'pg'
import { forceGrant } from '../fixtures/db-helpers.js'

const API = process.env.API_URL ?? 'http://localhost:8080'
const DB_URL = process.env.DATABASE_URL ?? 'postgres://render:render@localhost:5432/render'

async function signupAndLogin(
  page: import('@playwright/test').Page,
  email: string,
  password: string,
) {
  await page.goto('/signup')
  await page.fill('#email', email)
  await page.fill('#password', password)
  await page.click('button[type=submit]')
  await expect(page).toHaveURL(/\/login/)
  await page.fill('#email', email)
  await page.fill('#password', password)
  await page.click('button[type=submit]')
  await expect(page).toHaveURL('/dashboard')
}

test('entitled artist: publish → public → unpublish → draft', async ({ page }) => {
  const suffix = Date.now()
  const email = `pub-entitled-${suffix}@e2e.test`
  const password = 'testpass123'

  await signupAndLogin(page, email, password)

  // Create a profile
  await page.goto('/profile')
  await page.fill('input[name="displayName"]', 'Publish Test Artist')
  await page.getByRole('button', { name: /save/i }).click()
  await expect(page.getByText(/saved/i)).toBeVisible()

  // Get user_id via API for DB grant
  const profileRes = await page.request.get(`${API}/profiles/me`)
  expect(profileRes.ok()).toBe(true)
  const profile = await profileRes.json()

  // Grant access in DB
  const db = new Client({ connectionString: DB_URL })
  await db.connect()
  try {
    await forceGrant(db, profile.user_id)
  } finally {
    await db.end()
  }

  // Reload — should see Draft badge and Go Public button
  await page.reload()
  await expect(page.getByTestId('visibility-badge')).toHaveText('Draft')
  await expect(page.getByRole('button', { name: /go public/i })).toBeVisible()

  // Publish
  await page.getByRole('button', { name: /go public/i }).click()
  await expect(page.getByTestId('visibility-badge')).toHaveText('Public')
  await expect(page.getByRole('button', { name: /take offline/i })).toBeVisible()

  // Verify public page accessible (no auth)
  const publicContext = await page.context().browser()!.newPage()
  try {
    const publicRes = await publicContext.request.get(`${API}/profiles/${profile.id}`)
    expect(publicRes.ok()).toBe(true)
  } finally {
    await publicContext.close()
  }

  // Unpublish
  await page.getByRole('button', { name: /take offline/i }).click()
  await expect(page.getByTestId('visibility-badge')).toHaveText('Draft')
  await expect(page.getByRole('button', { name: /go public/i })).toBeVisible()

  // Verify no longer public
  const anonContext = await page.context().browser()!.newPage()
  try {
    const draftRes = await anonContext.request.get(`${API}/profiles/${profile.id}`)
    expect(draftRes.status()).toBe(404)
  } finally {
    await anonContext.close()
  }
})

test('non-entitled artist: Go Public shows upsell, profile stays draft', async ({ page }) => {
  const suffix = Date.now()
  const email = `pub-nopay-${suffix}@e2e.test`
  const password = 'testpass123'

  await signupAndLogin(page, email, password)

  await page.goto('/profile')
  await page.fill('input[name="displayName"]', 'No Pay Artist')
  await page.getByRole('button', { name: /save/i }).click()
  await expect(page.getByText(/saved/i)).toBeVisible()

  // Reload to render PublishBar from server
  await page.reload()
  await expect(page.getByTestId('visibility-badge')).toHaveText('Draft')

  // Click Go Public — no entitlement
  await page.getByRole('button', { name: /go public/i }).click()

  // Upsell panel appears
  await expect(page.getByTestId('upsell-panel')).toBeVisible()

  // Profile is still draft — button is still Go Public
  await expect(page.getByRole('button', { name: /go public/i })).toBeVisible()
  await expect(page.getByTestId('visibility-badge')).toHaveText('Draft')
})
```

- [ ] **Step 9.2: Ensure the Docker stack is running**

```bash
docker compose -f infra/docker-compose.yml ps
```

Expected: api, web, db, minio containers Up/healthy.

If not up: `task up` then wait ~30s.

- [ ] **Step 9.3: Run just the new spec**

```bash
npx playwright test e2e/browser/artist-publish-control.spec.ts
```

Expected: 2 passed.

- [ ] **Step 9.4: Run the full browser suite to check for regressions**

```bash
npx playwright test
```

Expected: all specs pass.

- [ ] **Step 9.5: Commit**

```bash
git add e2e/browser/artist-publish-control.spec.ts
git commit -m "test(e2e): E15.3 — browser spec for publish/unpublish and upsell flow"
```

---

### Task 10: Update specs and open PR

**Files:**
- Modify: `api/internal/artist/artist.spec.md`

- [ ] **Step 10.1: Update the artist spec**

In `api/internal/artist/artist.spec.md`:

**Contract section** — add after the preview token rotation line:
```
- Publish: `POST /profiles/me/publish` — flips draft → public, gated on `billing.CanPublish`; 402 if not entitled
- Unpublish: `POST /profiles/me/unpublish` — flips public → draft; always allowed
```

**Key Decisions section** — update the "Publish gate" line:
```
- **Publish/unpublish endpoints**: `POST /profiles/me/publish` and `POST /profiles/me/unpublish` are the canonical publish actions — use these in preference to `PATCH /profiles/me { visibility }`. The PATCH path retains the gate for backwards compatibility.
```

**AI Context section** — add:
```
- `publish.go`: `PublishHandler`, `UnpublishHandler` — thin wrappers around `SetArtistProfileVisibility` query + billing gate
```

Update the `Last updated` date to today.

- [ ] **Step 10.2: Commit the spec update**

```bash
git add api/internal/artist/artist.spec.md
git commit -m "docs(spec): update artist spec for E15.3 publish/unpublish endpoints"
```

- [ ] **Step 10.3: Run full test suite one final time**

```bash
task api:test
npx playwright test
```

Expected: all pass.

- [ ] **Step 10.4: Open the PR**

```bash
gh pr create \
  --title "[E15.3] Artist publish control UI — Edit / Preview / Go Public" \
  --body "$(cat <<'EOF'
## Summary
- `POST /profiles/me/publish` — flips draft → public, gated on `billing.CanPublish` (402 if not entitled)
- `POST /profiles/me/unpublish` — flips public → draft, always allowed
- `PublishBar` client component on the profile page: status badge, copy preview link, Go Public / Take Offline, inline upsell
- Browser E2E spec covering entitled publish/unpublish cycle and non-entitled upsell

Closes #178. Part of #175.

## Test plan
- [ ] `task api:test` passes
- [ ] `npx playwright test e2e/browser/artist-publish-control.spec.ts` — 2 passed
- [ ] `npx playwright test` — full suite passes

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

