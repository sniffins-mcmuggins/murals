# E15.2 — Shareable Preview Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an unguessable `preview_token` to every artist profile so draft profiles can be shared via a token URL before going public, with a rotate endpoint to invalidate old links.

**Architecture:** A `preview_token` TEXT column is added to `artist_profiles` with a DB-level random DEFAULT (`encode(gen_random_bytes(32), 'base64')`), so every profile — new and existing — gets a unique token at migration time. Two new routes are added: a public `GET /profiles/preview/{token}` that bypasses the visibility gate, and an owner-only `POST /profiles/me/preview-token/rotate` that regenerates the token in the DB. The token is returned to the profile owner in their GET /profiles/me response, but never exposed in public profile responses.

**Tech Stack:** Go, chi router, pgx/pgxpool, sqlc (task db:generate), testify (unit tests), Vitest (e2e API tests)

---

## File map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `db/migrations/000016_preview_token.up.sql` | Add preview_token column |
| Create | `db/migrations/000016_preview_token.down.sql` | Reverse migration |
| Modify | `db/queries/artist_profiles.sql` | Add GetArtistProfileByPreviewToken + RotateArtistProfilePreviewToken queries |
| Regen | `api/internal/sqlcdb/models.go` | ArtistProfile struct gains PreviewToken field (via task db:generate) |
| Regen | `api/internal/sqlcdb/artist_profiles.sql.go` | All scans updated + two new query functions (via task db:generate) |
| Modify | `api/internal/artist/profile.go` | Add PreviewToken to profileResponse; add PreviewByTokenHandler + RotatePreviewTokenHandler |
| Modify | `api/cmd/api/main.go` | Register two new routes |
| Modify | `api/internal/artist/profile_test.go` | Unit tests for both handlers |
| Create | `e2e/api/profile-preview.test.ts` | E2e API tests |

---

### Task 1: Migration — add preview_token column

**Files:**
- Create: `db/migrations/000016_preview_token.up.sql`
- Create: `db/migrations/000016_preview_token.down.sql`

- [ ] **Step 1.1: Write up migration**

```sql
-- db/migrations/000016_preview_token.up.sql
ALTER TABLE artist_profiles
  ADD COLUMN preview_token TEXT UNIQUE NOT NULL
    DEFAULT encode(gen_random_bytes(32), 'base64');
```

PostgreSQL evaluates `gen_random_bytes(32)` per-row during backfill, so every existing profile gets a unique token. The UNIQUE index guarantees no collision.

- [ ] **Step 1.2: Write down migration**

```sql
-- db/migrations/000016_preview_token.down.sql
ALTER TABLE artist_profiles DROP COLUMN preview_token;
```

- [ ] **Step 1.3: Verify migration number is correct**

```bash
ls db/migrations/ | sort | tail -5
```

Expected: highest number is `000015_*`. If 000016 already exists, check what it is.

- [ ] **Step 1.4: Apply migration**

```bash
task db:migrate
```

Expected: `Applied 1 migrations` or similar success message.

- [ ] **Step 1.5: Verify column exists**

```bash
docker compose -f infra/docker-compose.yml exec db psql -U render -d render \
  -c "\d artist_profiles" | grep preview_token
```

Expected: `preview_token | text | not null`

- [ ] **Step 1.6: Verify existing profiles got tokens**

```bash
docker compose -f infra/docker-compose.yml exec db psql -U render -d render \
  -c "SELECT count(*), count(preview_token), count(DISTINCT preview_token) FROM artist_profiles;"
```

Expected: all three counts equal (every row has a non-null unique token).

---

### Task 2: SQL queries for preview token

**Files:**
- Modify: `db/queries/artist_profiles.sql`

- [ ] **Step 2.1: Add GetArtistProfileByPreviewToken query**

Append to `db/queries/artist_profiles.sql`:

```sql
-- name: GetArtistProfileByPreviewToken :one
SELECT * FROM artist_profiles WHERE preview_token = $1;

-- name: RotateArtistProfilePreviewToken :one
UPDATE artist_profiles
SET preview_token = encode(gen_random_bytes(32), 'base64'),
    updated_at    = now()
WHERE user_id = $1
RETURNING *;
```

The `RotateArtistProfilePreviewToken` query generates a fresh cryptographically random token in the DB. If the user has no profile, `pgx.ErrNoRows` is returned.

---

### Task 3: Regenerate sqlc

**Files:**
- Regen: `api/internal/sqlcdb/models.go`
- Regen: `api/internal/sqlcdb/artist_profiles.sql.go`

- [ ] **Step 3.1: Run sqlc generate**

```bash
task db:generate
```

Expected: no errors. Files in `api/internal/sqlcdb/` are updated.

- [ ] **Step 3.2: Verify ArtistProfile struct has PreviewToken**

```bash
grep "PreviewToken" api/internal/sqlcdb/models.go
```

Expected: `PreviewToken string \`db:"preview_token" json:"preview_token"\``

- [ ] **Step 3.3: Verify all Scan calls are updated**

```bash
grep -c '&i\.' api/internal/sqlcdb/artist_profiles.sql.go
```

Expected: the count increased compared to before (all SELECT * / RETURNING * scans now include `&i.PreviewToken`). Every block of `row.Scan(...)` in that file should end with `&i.PreviewToken`.

- [ ] **Step 3.4: Verify new query functions exist**

```bash
grep "func.*GetArtistProfileByPreviewToken\|func.*RotateArtistProfilePreviewToken" \
  api/internal/sqlcdb/artist_profiles.sql.go
```

Expected: both function signatures are present.

- [ ] **Step 3.5: Verify the project compiles**

```bash
task api:test 2>&1 | tail -5
```

Expected: all tests pass (or the same failures as before this task). The compilation step catches any scan arity mismatches.

---

### Task 4: Add PreviewToken to profileResponse (owner only)

**Files:**
- Modify: `api/internal/artist/profile.go`

- [ ] **Step 4.1: Read current profileResponse struct**

Read `api/internal/artist/profile.go` lines 22–38 (the `profileResponse` struct and `toProfileResponse` function).

- [ ] **Step 4.2: Add PreviewToken field to profileResponse**

In `profileResponse`, add one field after `UpdatedAt`:

```go
type profileResponse struct {
	ID                string          `json:"id"`
	UserID            string          `json:"user_id"`
	DisplayName       string          `json:"display_name"`
	Bio               string          `json:"bio"`
	Visibility        string          `json:"visibility"`
	LocationLabel     *string         `json:"location_label,omitempty"`
	MediumTags        []string        `json:"medium_tags"`
	SocialLinks       json.RawMessage `json:"social_links"`
	AvatarS3Key       *string         `json:"avatar_s3_key,omitempty"`
	HeadlineImageUrls []string        `json:"headline_image_urls"`
	CreatedAt         string          `json:"created_at"`
	UpdatedAt         string          `json:"updated_at"`
	PreviewToken      *string         `json:"preview_token,omitempty"`
}
```

`*string` + `omitempty` so it's absent from public profile responses (when the caller passes `public=true`).

- [ ] **Step 4.3: Populate PreviewToken in toProfileResponse**

In `toProfileResponse`, after the `if !public || p.ShowLocation` block, add:

```go
if !public {
    resp.PreviewToken = &p.PreviewToken
}
```

The full updated `toProfileResponse` function:

```go
func toProfileResponse(p sqlcdb.ArtistProfile, public bool) profileResponse {
	headlineImageUrls := p.HeadlineImageUrls
	if headlineImageUrls == nil {
		headlineImageUrls = []string{}
	}
	resp := profileResponse{
		ID:                p.ID.String(),
		UserID:            p.UserID.String(),
		DisplayName:       p.DisplayName,
		Bio:               p.Bio,
		Visibility:        p.Visibility,
		MediumTags:        p.MediumTags,
		SocialLinks:       p.SocialLinks,
		AvatarS3Key:       p.AvatarS3Key,
		HeadlineImageUrls: headlineImageUrls,
		CreatedAt:         p.CreatedAt.Time.Format(time.RFC3339),
		UpdatedAt:         p.UpdatedAt.Time.Format(time.RFC3339),
	}
	if !public || p.ShowLocation {
		resp.LocationLabel = p.LocationLabel
	}
	if !public {
		resp.PreviewToken = &p.PreviewToken
	}
	return resp
}
```

- [ ] **Step 4.4: Compile check**

```bash
cd api && go build ./... && cd ..
```

Expected: no errors.

---

### Task 5: Implement PreviewByTokenHandler

**Files:**
- Modify: `api/internal/artist/profile.go`

- [ ] **Step 5.1: Add the handler function**

Append to `api/internal/artist/profile.go` (after the last existing handler):

```go
// PreviewByTokenHandler handles GET /profiles/preview/{token}.
// Public — no auth required. Returns the profile regardless of draft/public visibility,
// as long as the preview_token matches. The preview_token is NOT included in the response.
func PreviewByTokenHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := chi.URLParam(r, "token")
		if token == "" {
			httperr.BadRequest(w, "token is required")
			return
		}

		q := sqlcdb.New(pool)
		profile, err := q.GetArtistProfileByPreviewToken(r.Context(), token)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		// public=true: hides preview_token from response — the link IS the secret.
		_ = json.NewEncoder(w).Encode(toProfileResponse(profile, true))
	}
}
```

- [ ] **Step 5.2: Compile check**

```bash
cd api && go build ./... && cd ..
```

Expected: no errors.

---

### Task 6: Implement RotatePreviewTokenHandler

**Files:**
- Modify: `api/internal/artist/profile.go`

- [ ] **Step 6.1: Add the handler function**

Append to `api/internal/artist/profile.go`:

```go
// RotatePreviewTokenHandler handles POST /profiles/me/preview-token/rotate.
// Owner-only — requires auth. Generates a fresh preview_token, invalidating
// any previously shared links.
func RotatePreviewTokenHandler(pool *pgxpool.Pool) http.HandlerFunc {
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
		profile, err := q.RotateArtistProfilePreviewToken(r.Context(), userUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		// public=false: includes the new preview_token so the owner can share it.
		_ = json.NewEncoder(w).Encode(toProfileResponse(profile, false))
	}
}
```

- [ ] **Step 6.2: Compile check**

```bash
cd api && go build ./... && cd ..
```

Expected: no errors.

---

### Task 7: Register routes in main.go

**Files:**
- Modify: `api/cmd/api/main.go`

- [ ] **Step 7.1: Read current profile route block**

The route block currently looks like:

```go
r.Post("/profiles", artist.CreateProfileHandler(pool))
r.Get("/profiles/me", artist.GetMyProfileHandler(pool))
r.Patch("/profiles/me", artist.UpdateProfileHandler(pool))
r.Get("/profiles/me/qr", artist.ProfileQRHandler(pool, cfg.WebPublicBase))
r.Get("/profiles/me/analytics", analytics.MyAnalyticsHandler(pool))
r.Post("/profiles/{profileID}/link-click", analytics.LinkClickHandler(pool))
r.Get("/profiles/{profileID}", artist.GetProfileHandler(pool))
r.Get("/profiles/{profileID}/collections", artist.ListCollectionsHandler(pool))
```

- [ ] **Step 7.2: Add new routes before /{profileID}**

Chi matches top-to-bottom within a group. The literal prefix `/preview/{token}` and `/me/preview-token/rotate` must come before the parameterized `/{profileID}` route, or chi will parse `"preview"` as the profileID.

Replace the profile route block with:

```go
r.Post("/profiles", artist.CreateProfileHandler(pool))
r.Get("/profiles/me", artist.GetMyProfileHandler(pool))
r.Patch("/profiles/me", artist.UpdateProfileHandler(pool))
r.Get("/profiles/me/qr", artist.ProfileQRHandler(pool, cfg.WebPublicBase))
r.Get("/profiles/me/analytics", analytics.MyAnalyticsHandler(pool))
r.Post("/profiles/me/preview-token/rotate", artist.RotatePreviewTokenHandler(pool)) // literal /me before /{profileID}
r.Get("/profiles/preview/{token}", artist.PreviewByTokenHandler(pool))               // literal /preview before /{profileID}
r.Post("/profiles/{profileID}/link-click", analytics.LinkClickHandler(pool))
r.Get("/profiles/{profileID}", artist.GetProfileHandler(pool))
r.Get("/profiles/{profileID}/collections", artist.ListCollectionsHandler(pool))
r.Get("/profiles/{profileID}/festivals", festival.ListArtistFestivalsHandler(pool))
```

- [ ] **Step 7.3: Compile + run existing tests**

```bash
task api:test
```

Expected: all existing tests pass.

---

### Task 8: Unit tests

**Files:**
- Modify: `api/internal/artist/profile_test.go`

- [ ] **Step 8.1: Write the failing tests**

Append to `api/internal/artist/profile_test.go`:

```go
func TestPreviewByToken_ValidToken_Returns200(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	userID, _ := createTestUser(t, db, "preview-valid@example.com")
	profileID := createTestProfile(t, db, userID, "Preview Artist")
	_ = profileID

	// Fetch the preview token via the me endpoint
	_, token := createTestUser(t, db, "preview-valid@example.com")
	// token is already created above in createTestUser; re-use userID
	_, token = createTestUser(t, db, "preview-valid2@example.com")
	// use the first user's token instead
	_, token = func() (string, string) {
		return userID, func() string {
			tok, err := auth.IssueToken(userID, false, 1, testSecret)
			if err != nil {
				t.Fatalf("issue token: %v", err)
			}
			return tok
		}()
	}()

	// GET /profiles/me to retrieve the preview_token
	r := chi.NewRouter()
	r.Get("/profiles/me", auth.Middleware(db, testSecret)(artist.GetMyProfileHandler(db)))
	r.Get("/profiles/preview/{token}", artist.PreviewByTokenHandler(db))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	meReq, err := http.NewRequestWithContext(t.Context(), http.MethodGet, srv.URL+"/profiles/me", nil)
	require.NoError(t, err)
	meReq.Header.Set("Authorization", "Bearer "+token)
	meResp, err := http.DefaultClient.Do(meReq)
	require.NoError(t, err)
	defer func() { _ = meResp.Body.Close() }()
	require.Equal(t, http.StatusOK, meResp.StatusCode)
	var meBody map[string]any
	require.NoError(t, json.NewDecoder(meResp.Body).Decode(&meBody))
	previewToken, ok := meBody["preview_token"].(string)
	require.True(t, ok, "preview_token must be a string in /profiles/me response")
	require.NotEmpty(t, previewToken)

	// GET /profiles/preview/{token} without auth → 200
	prevReq, err := http.NewRequestWithContext(t.Context(), http.MethodGet, srv.URL+"/profiles/preview/"+previewToken, nil)
	require.NoError(t, err)
	prevResp, err := http.DefaultClient.Do(prevReq)
	require.NoError(t, err)
	defer func() { _ = prevResp.Body.Close() }()
	require.Equal(t, http.StatusOK, prevResp.StatusCode)
	var prevBody map[string]any
	require.NoError(t, json.NewDecoder(prevResp.Body).Decode(&prevBody))
	assert.Equal(t, "Preview Artist", prevBody["display_name"])
	// preview_token must NOT be in the public response
	_, hasToken := prevBody["preview_token"]
	assert.False(t, hasToken, "preview_token must not appear in preview response")
}

func TestPreviewByToken_BadToken_Returns404(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	r := chi.NewRouter()
	r.Get("/profiles/preview/{token}", artist.PreviewByTokenHandler(db))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, srv.URL+"/profiles/preview/notavalidtoken", nil)
	require.NoError(t, err)
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer func() { _ = resp.Body.Close() }()
	assert.Equal(t, http.StatusNotFound, resp.StatusCode)
}

func TestPreviewByToken_DraftVisible(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	userID, ownerToken := createTestUser(t, db, "preview-draft@example.com")
	profileID := createTestProfile(t, db, userID, "Draft Artist")
	// Profile is draft — not published. Public GET /{profileID} should return 404.
	// But preview/{token} should return 200.

	r := chi.NewRouter()
	r.Get("/profiles/me", auth.Middleware(db, testSecret)(artist.GetMyProfileHandler(db)))
	r.Get("/profiles/preview/{token}", artist.PreviewByTokenHandler(db))
	r.Get("/profiles/{profileID}", artist.GetProfileHandler(db))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	// Get preview token
	meReq, _ := http.NewRequestWithContext(t.Context(), http.MethodGet, srv.URL+"/profiles/me", nil)
	meReq.Header.Set("Authorization", "Bearer "+ownerToken)
	meResp, err := http.DefaultClient.Do(meReq)
	require.NoError(t, err)
	defer func() { _ = meResp.Body.Close() }()
	var meBody map[string]any
	require.NoError(t, json.NewDecoder(meResp.Body).Decode(&meBody))
	previewToken := meBody["preview_token"].(string)

	// Direct GET returns 404 (draft)
	dirReq, _ := http.NewRequestWithContext(t.Context(), http.MethodGet, srv.URL+"/profiles/"+profileID, nil)
	dirResp, err := http.DefaultClient.Do(dirReq)
	require.NoError(t, err)
	_ = dirResp.Body.Close()
	assert.Equal(t, http.StatusNotFound, dirResp.StatusCode, "draft should be 404 without auth")

	// Preview GET returns 200
	prevReq, _ := http.NewRequestWithContext(t.Context(), http.MethodGet, srv.URL+"/profiles/preview/"+previewToken, nil)
	prevResp, err := http.DefaultClient.Do(prevReq)
	require.NoError(t, err)
	defer func() { _ = prevResp.Body.Close() }()
	assert.Equal(t, http.StatusOK, prevResp.StatusCode, "draft should be 200 via preview token")
}

func TestRotatePreviewToken_InvalidatesOldToken(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	userID, ownerToken := createTestUser(t, db, "preview-rotate@example.com")
	_ = createTestProfile(t, db, userID, "Rotate Artist")

	r := chi.NewRouter()
	r.Get("/profiles/me", auth.Middleware(db, testSecret)(artist.GetMyProfileHandler(db)))
	r.Post("/profiles/me/preview-token/rotate", auth.Middleware(db, testSecret)(artist.RotatePreviewTokenHandler(db)))
	r.Get("/profiles/preview/{token}", artist.PreviewByTokenHandler(db))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	// Get original token
	meReq, _ := http.NewRequestWithContext(t.Context(), http.MethodGet, srv.URL+"/profiles/me", nil)
	meReq.Header.Set("Authorization", "Bearer "+ownerToken)
	meResp, _ := http.DefaultClient.Do(meReq)
	var meBody map[string]any
	_ = json.NewDecoder(meResp.Body).Decode(&meBody)
	_ = meResp.Body.Close()
	oldToken := meBody["preview_token"].(string)

	// Rotate
	rotReq, _ := http.NewRequestWithContext(t.Context(), http.MethodPost, srv.URL+"/profiles/me/preview-token/rotate", nil)
	rotReq.Header.Set("Authorization", "Bearer "+ownerToken)
	rotResp, err := http.DefaultClient.Do(rotReq)
	require.NoError(t, err)
	defer func() { _ = rotResp.Body.Close() }()
	require.Equal(t, http.StatusOK, rotResp.StatusCode)
	var rotBody map[string]any
	_ = json.NewDecoder(rotResp.Body).Decode(&rotBody)
	newToken := rotBody["preview_token"].(string)
	assert.NotEqual(t, oldToken, newToken, "rotate must produce a different token")

	// Old token → 404
	oldReq, _ := http.NewRequestWithContext(t.Context(), http.MethodGet, srv.URL+"/profiles/preview/"+oldToken, nil)
	oldResp, err := http.DefaultClient.Do(oldReq)
	require.NoError(t, err)
	_ = oldResp.Body.Close()
	assert.Equal(t, http.StatusNotFound, oldResp.StatusCode, "old token must be invalidated")

	// New token → 200
	newReq, _ := http.NewRequestWithContext(t.Context(), http.MethodGet, srv.URL+"/profiles/preview/"+newToken, nil)
	newResp, err := http.DefaultClient.Do(newReq)
	require.NoError(t, err)
	_ = newResp.Body.Close()
	assert.Equal(t, http.StatusOK, newResp.StatusCode, "new token must be valid")
}

func TestRotatePreviewToken_RequiresAuth(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	r := chi.NewRouter()
	r.Post("/profiles/me/preview-token/rotate", auth.Middleware(db, testSecret)(artist.RotatePreviewTokenHandler(db)))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	req, _ := http.NewRequestWithContext(t.Context(), http.MethodPost, srv.URL+"/profiles/me/preview-token/rotate", nil)
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	_ = resp.Body.Close()
	assert.Equal(t, http.StatusUnauthorized, resp.StatusCode)
}
```

- [ ] **Step 8.2: Run the new tests to see them fail (before the implementation is wired)**

Wait — the implementation is already done in Tasks 5 & 6. Run to confirm they pass:

```bash
task api:test 2>&1 | grep -E "PASS|FAIL|preview|rotate"
```

Expected: all new tests pass.

- [ ] **Step 8.3: Commit task 4–8**

```bash
git add db/migrations/000016_preview_token.up.sql \
        db/migrations/000016_preview_token.down.sql \
        db/queries/artist_profiles.sql \
        api/internal/sqlcdb/models.go \
        api/internal/sqlcdb/artist_profiles.sql.go \
        api/internal/artist/profile.go \
        api/internal/artist/profile_test.go \
        api/cmd/api/main.go
git commit -m "feat(artist): E15.2 — preview token + rotate endpoint (#177)"
```

---

### Task 9: E2e API tests

**Files:**
- Create: `e2e/api/profile-preview.test.ts`

The stack must be running (`task up && task db:migrate`) before running these tests.

- [ ] **Step 9.1: Ensure the stack has the migration**

```bash
docker compose -f infra/docker-compose.yml logs api --tail=5 | grep -E "building|running|api starting"
```

Expected: the API rebuilt after the migration files landed (air picks up Go changes). If not, restart: `docker compose -f infra/docker-compose.yml restart api`.

Confirm healthcheck: `curl -sf http://localhost:8080/healthz && echo OK`

- [ ] **Step 9.2: Write the e2e test file**

```typescript
// e2e/api/profile-preview.test.ts
// E15.2 — Shareable preview link (unguessable token)
// Covers: bad token → 404; valid token → 200 draft visible; rotate → old 404 + new 200
import { describe, it, expect } from 'vitest'

const API = process.env.API_URL ?? 'http://localhost:8080'
const SUFFIX = `preview-${Date.now()}`

function auth(token: string) {
  return { Authorization: `Bearer ${token}` }
}

async function signupAndLogin(email: string, password = 'testpass123') {
  await fetch(`${API}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const { token } = await res.json()
  return token as string
}

async function createProfile(token: string, displayName: string) {
  const res = await fetch(`${API}/profiles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth(token) },
    body: JSON.stringify({ displayName }),
  })
  return res.json() as Promise<{ id: string }>
}

async function getMyProfile(token: string) {
  const res = await fetch(`${API}/profiles/me`, { headers: auth(token) })
  return res.json() as Promise<{ preview_token: string; id: string; visibility: string }>
}

describe('E15.2 — profile preview token', () => {
  it('GET /profiles/preview/<bad-token> → 404', async () => {
    const res = await fetch(`${API}/profiles/preview/notavalidtokenXXXXXXXXXXX`)
    expect(res.status).toBe(404)
  })

  it('GET /profiles/me includes preview_token', async () => {
    const token = await signupAndLogin(`me-token-${SUFFIX}@preview.test`)
    await createProfile(token, `PreviewArtist-${SUFFIX}`)
    const me = await getMyProfile(token)
    expect(typeof me.preview_token).toBe('string')
    expect(me.preview_token.length).toBeGreaterThan(20)
  })

  it('GET /profiles/preview/{token} returns draft profile without auth', async () => {
    const token = await signupAndLogin(`draft-preview-${SUFFIX}@preview.test`)
    await createProfile(token, `DraftPreview-${SUFFIX}`)
    const me = await getMyProfile(token)
    // profile is draft — direct GET should 404 for unauth
    const directRes = await fetch(`${API}/profiles/${me.id}`)
    expect(directRes.status).toBe(404)
    // preview endpoint should 200
    const prevRes = await fetch(`${API}/profiles/preview/${me.preview_token}`)
    expect(prevRes.status).toBe(200)
    const prevBody = await prevRes.json()
    expect(prevBody.display_name).toBe(`DraftPreview-${SUFFIX}`)
    // preview_token must NOT be in the public preview response
    expect(prevBody.preview_token).toBeUndefined()
  })

  it('POST /profiles/me/preview-token/rotate without token → 401', async () => {
    const res = await fetch(`${API}/profiles/me/preview-token/rotate`, { method: 'POST' })
    expect(res.status).toBe(401)
  })

  it('rotate invalidates old token and produces new one', async () => {
    const token = await signupAndLogin(`rotate-${SUFFIX}@preview.test`)
    await createProfile(token, `RotateArtist-${SUFFIX}`)
    const before = await getMyProfile(token)
    const oldPreviewToken = before.preview_token

    // Rotate
    const rotRes = await fetch(`${API}/profiles/me/preview-token/rotate`, {
      method: 'POST',
      headers: auth(token),
    })
    expect(rotRes.status).toBe(200)
    const rotBody = await rotRes.json()
    const newPreviewToken = rotBody.preview_token as string
    expect(newPreviewToken).not.toBe(oldPreviewToken)

    // Old link → 404
    const oldRes = await fetch(`${API}/profiles/preview/${oldPreviewToken}`)
    expect(oldRes.status).toBe(404)

    // New link → 200
    const newRes = await fetch(`${API}/profiles/preview/${newPreviewToken}`)
    expect(newRes.status).toBe(200)
  })
})
```

- [ ] **Step 9.3: Run the e2e tests**

```bash
npx vitest run e2e/api/profile-preview.test.ts
```

Expected: all 5 tests pass.

- [ ] **Step 9.4: Commit e2e tests**

```bash
git add e2e/api/profile-preview.test.ts
git commit -m "test(e2e): E15.2 — preview token e2e probe (#177)"
```

---

## Self-review

### Spec coverage

| Requirement | Task |
|-------------|------|
| `preview_token` column, UNIQUE, generated on creation | Task 1 + 2 |
| Backfill existing rows | Task 1 (DB DEFAULT fills existing rows at migration) |
| `GET /profiles/preview/{token}` — no auth, serves draft | Task 5 + 9 |
| `POST /profiles/me/preview-token/rotate` — owner only | Task 6 + 9 |
| Old token 404s after rotate | Task 8 + 9 |
| `noindex` hint | NOT in scope — web route concern, noted as optional in issue |

### Route ordering

Literal `/preview/{token}` and `/me/preview-token/rotate` registered before parameterized `/{profileID}` in Task 7. ✓

### Auth checklist

- `PreviewByTokenHandler` — no auth required ✓
- `RotatePreviewTokenHandler` — checks `auth.User`, 401 on missing principal ✓
- `GetMyProfileHandler` wraps are not modified — existing auth unchanged ✓

### Token not leaked

`toProfileResponse(profile, true)` used in `PreviewByTokenHandler` → `PreviewToken` field is `nil` → `omitempty` drops it from JSON ✓
