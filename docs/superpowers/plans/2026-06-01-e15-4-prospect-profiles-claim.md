# E15.4 — Prospect Profiles + Claim-on-Signup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow an admin to pre-register an artist profile from a `seed.json` file (produced by the `artist-preview-builder` skill), then have the artist claim and bind it to their account on signup via a unique claim token.

**Architecture:** A DB migration makes `user_id` nullable and adds `claim_token`/`claimed_at`/`created_by` columns with a partial unique index preserving the 1:1 user↔profile invariant for claimed profiles. `POST /admin/prospects` creates unclaimed profiles; `POST /auth/signup?claim=<token>` (token in request body) atomically binds the waiting profile. Image re-upload from `source_url` runs as bounded background work.

**Tech Stack:** Go + chi + pgx/sqlc + golang-migrate, Next.js App Router, Playwright + Vitest (E2E).

**Read before starting:** `.claude/rules/sqlc-and-schema.md`, `.claude/rules/background-work.md`, `.claude/rules/auth-changes.md`, `.claude/rules/api-handler-checklist.md`.

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| **Create** | `db/migrations/000018_prospect_profiles.up.sql` | Nullable user_id + partial index + claim columns |
| **Create** | `db/migrations/000018_prospect_profiles.down.sql` | Reverse the migration |
| Modify | `db/queries/artist_profiles.sql` | Add `CreateProspectProfile`, `GetArtistProfileByClaimToken`, `ClaimArtistProfile` |
| Modify | `api/internal/sqlcdb/models.go` | New fields on `ArtistProfile` struct |
| Modify | `api/internal/sqlcdb/artist_profiles.sql.go` | Scan calls updated for new columns; new query methods |
| Modify | `api/internal/artist/profile.go` | `toProfileResponse` handles nullable `user_id`; `profileResponse.UserID` → `*string` |
| **Create** | `api/internal/admin/prospects.go` | `CreateProspectHandler` |
| **Create** | `api/internal/admin/prospects_test.go` | Unit tests |
| Modify | `api/internal/auth/signup.go` | Accept `claim_token` in body; call shared claim helper after user creation |
| Modify | `api/internal/auth/signup_test.go` | Tests for claim path |
| Modify | `api/cmd/api/main.go` | Register `POST /admin/prospects` |
| Modify | `openapi/openapi.yaml` | Update `ArtistProfile` (`user_id` nullable), add prospect/claim endpoints |
| Modify | `web/src/app/(auth)/signup/page.tsx` | Read `?claim=` URL param, send `claim_token` in body, redirect on claim |
| Modify | `web/src/app/(artist)/profile/page.tsx` | Show "Your page is ready" banner when `?claimed=1` |
| **Create** | `e2e/api/prospect-claim.test.ts` | Full security + race + IDOR test matrix |

---

### Task 1: Write the schema migration

**Files:**
- Create: `db/migrations/000018_prospect_profiles.up.sql`
- Create: `db/migrations/000018_prospect_profiles.down.sql`

- [ ] **Step 1.1: Confirm next migration number**

```bash
ls db/migrations/ | sort -t_ -k1 -n | tail -3
```

Expected: highest number is `000017`. Confirm before proceeding.

- [ ] **Step 1.2: Create the up migration**

Create `db/migrations/000018_prospect_profiles.up.sql`:

```sql
-- Make user_id nullable to support unclaimed prospect profiles.
ALTER TABLE artist_profiles ALTER COLUMN user_id DROP NOT NULL;

-- Replace the hard unique index with a partial one: NULLs (unclaimed) can
-- coexist freely; only non-NULL user_ids must be unique.
DROP INDEX artist_profiles_user_id_idx;
CREATE UNIQUE INDEX artist_profiles_user_id_idx
  ON artist_profiles (user_id) WHERE user_id IS NOT NULL;

-- Claim flow columns.
ALTER TABLE artist_profiles
  ADD COLUMN claim_token TEXT UNIQUE,
  ADD COLUMN claimed_at  TIMESTAMPTZ,
  ADD COLUMN created_by  UUID REFERENCES users(id);
```

- [ ] **Step 1.3: Create the down migration**

Create `db/migrations/000018_prospect_profiles.down.sql`:

```sql
ALTER TABLE artist_profiles
  DROP COLUMN IF EXISTS created_by,
  DROP COLUMN IF EXISTS claimed_at,
  DROP COLUMN IF EXISTS claim_token;

DROP INDEX IF EXISTS artist_profiles_user_id_idx;
CREATE UNIQUE INDEX artist_profiles_user_id_idx ON artist_profiles (user_id);

ALTER TABLE artist_profiles ALTER COLUMN user_id SET NOT NULL;
```

- [ ] **Step 1.4: Apply the migration**

```bash
task db:migrate
```

Expected: `Migrating ... 000018/u prospect_profiles ... OK`.

- [ ] **Step 1.5: Verify the schema**

```bash
docker compose -f infra/docker-compose.yml exec db psql -U render -d render \
  -c "\d artist_profiles" | grep -E "user_id|claim"
```

Expected output includes:
```
 user_id     | uuid                        |           |          |
 claim_token | text                        |           |          |
 claimed_at  | timestamp with time zone    |           |          |
 created_by  | uuid                        |           |          |
```

And `user_id` should show no `not null` constraint.

- [ ] **Step 1.6: Commit**

```bash
git add db/migrations/000018_prospect_profiles.up.sql db/migrations/000018_prospect_profiles.down.sql
git commit -m "feat(db): migration 000018 — nullable user_id, partial unique index, claim columns"
```

---

### Task 2: Add new sqlc queries and regenerate

**Files:**
- Modify: `db/queries/artist_profiles.sql`
- Modify (generated): `api/internal/sqlcdb/models.go`
- Modify (generated): `api/internal/sqlcdb/artist_profiles.sql.go`

- [ ] **Step 2.1: Add new queries**

Append to `db/queries/artist_profiles.sql`:

```sql
-- name: CreateProspectProfile :one
-- Creates an unclaimed prospect profile (user_id NULL) seeded from admin data.
INSERT INTO artist_profiles (display_name, bio, location_label, medium_tags, social_links, created_by)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: GetArtistProfileByClaimToken :one
SELECT * FROM artist_profiles WHERE claim_token = $1;

-- name: ClaimArtistProfile :one
-- Atomically binds a profile to a user. Returns no row if already claimed
-- (user_id IS NOT NULL) or if the token doesn't exist — caller checks for
-- pgx.ErrNoRows and returns 409.
UPDATE artist_profiles
SET user_id    = $1,
    claimed_at = now(),
    updated_at = now()
WHERE claim_token = $2
  AND user_id IS NULL
RETURNING *;

-- name: SetProspectClaimToken :one
-- Sets a unique claim token on a prospect profile. Called during prospect creation.
UPDATE artist_profiles
SET claim_token = $2,
    updated_at  = now()
WHERE id = $1
RETURNING *;

-- name: GetProspectByNameAndCreator :one
-- Idempotency check: return an existing unclaimed prospect by name + admin creator.
SELECT * FROM artist_profiles
WHERE display_name = $1
  AND created_by   = $2
  AND user_id IS NULL
LIMIT 1;
```

- [ ] **Step 2.2: Regenerate sqlc**

```bash
task db:generate
```

Expected: exits 0.

- [ ] **Step 2.3: Verify new fields in models.go**

```bash
grep -A 25 "type ArtistProfile struct" api/internal/sqlcdb/models.go
```

Expected: struct now includes `ClaimToken`, `ClaimedAt`, `CreatedBy` fields.

- [ ] **Step 2.4: Verify all Scan calls include the new columns**

```bash
grep -c "&i\." api/internal/sqlcdb/artist_profiles.sql.go
```

Count the result. Then verify each `Scan` has the same number of fields as the struct (should be 17 now: 14 original + 3 new). If any `Scan` call has fewer, sqlc didn't generate them correctly — re-run `task db:generate`.

- [ ] **Step 2.5: Compile check**

```bash
task api:test
```

Expected: passes (existing tests still work against the updated schema).

- [ ] **Step 2.6: Commit**

```bash
git add db/queries/artist_profiles.sql api/internal/sqlcdb/models.go api/internal/sqlcdb/artist_profiles.sql.go
git commit -m "feat(db): prospect profile queries — CreateProspect, GetByClaimToken, ClaimArtistProfile"
```

---

### Task 3: Update `toProfileResponse` for nullable `user_id`

**Files:**
- Modify: `api/internal/artist/profile.go`

- [ ] **Step 3.1: Change `profileResponse.UserID` to `*string`**

In `api/internal/artist/profile.go`, change the `profileResponse` struct and `toProfileResponse` function.

Current `profileResponse`:
```go
type profileResponse struct {
	ID                string          `json:"id"`
	UserID            string          `json:"user_id"`
	// ...
}
```

Change `UserID` to:
```go
type profileResponse struct {
	ID                string          `json:"id"`
	UserID            *string         `json:"user_id"`
	// ...
}
```

In `toProfileResponse`, replace:
```go
resp := profileResponse{
	ID:                p.ID.String(),
	UserID:            p.UserID.String(),
```

With:
```go
var userID *string
if p.UserID.Valid {
	s := p.UserID.String()
	userID = &s
}
resp := profileResponse{
	ID:                p.ID.String(),
	UserID:            userID,
```

- [ ] **Step 3.2: Fix any compilation errors caused by the type change**

```bash
task api:test
```

If there are compile errors where callers dereference `UserID` as a `string` (e.g. `profile.UserID == something`), fix them. The existing tests in `profile_test.go` that decode JSON into `map[string]any` won't break; only places that use `toProfileResponse` result directly as a struct would be affected.

- [ ] **Step 3.3: Run tests**

```bash
task api:test
```

Expected: all pass.

- [ ] **Step 3.4: Commit**

```bash
git add api/internal/artist/profile.go
git commit -m "feat(artist): user_id nullable in profile response — handles unclaimed prospect profiles"
```

---

### Task 4: Write failing tests for CreateProspectHandler

**Files:**
- Create: `api/internal/admin/prospects_test.go`

- [ ] **Step 4.1: Create the test file**

Create `api/internal/admin/prospects_test.go`:

```go
package admin_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/sniffins-mcmuggins/render/api/internal/admin"
	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

const testSecret = testutil.TestSecret

func makeAdminToken(t *testing.T, pool interface{}) string {
	t.Helper()
	// Use the existing admin token helper from existing admin tests
	// (see middleware_test.go for createAdminUser)
	return ""
}

func TestCreateProspectHandler_Success(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	adminID, adminToken := createAdminUser(t, db)
	_ = adminID

	body := `{
		"display_name": "Street Artist",
		"bio": "I paint walls.",
		"location_label": "Cheltenham, UK",
		"medium_tags": ["mural", "stencil"],
		"social_links": {"instagram": "https://instagram.com/street"},
		"images": []
	}`

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Use(admin.RequireAdmin(db))
	r.Post("/admin/prospects", admin.CreateProspectHandler(db))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := testutil.DoRequest(t, srv, http.MethodPost, "/admin/prospects", body, adminToken)
	defer func() { _ = resp.Body.Close() }()

	require.Equal(t, http.StatusCreated, resp.StatusCode)
	var result map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&result))
	assert.NotEmpty(t, result["profile_id"])
	assert.NotEmpty(t, result["claim_token"])
	assert.NotEmpty(t, result["preview_url"])
}

func TestCreateProspectHandler_MissingDisplayName(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	_, adminToken := createAdminUser(t, db)

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Use(admin.RequireAdmin(db))
	r.Post("/admin/prospects", admin.CreateProspectHandler(db))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := testutil.DoRequest(t, srv, http.MethodPost, "/admin/prospects", `{"bio":"no name"}`, adminToken)
	defer func() { _ = resp.Body.Close() }()

	assert.Equal(t, http.StatusUnprocessableEntity, resp.StatusCode)
}

func TestCreateProspectHandler_Unauthenticated(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Use(admin.RequireAdmin(db))
	r.Post("/admin/prospects", admin.CreateProspectHandler(db))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := testutil.DoRequest(t, srv, http.MethodPost, "/admin/prospects", `{}`, "")
	defer func() { _ = resp.Body.Close() }()

	assert.Equal(t, http.StatusUnauthorized, resp.StatusCode)
}

func TestCreateProspectHandler_NonAdmin(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	_, userToken, _ := testutil.CreateUser(t, db)

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Use(admin.RequireAdmin(db))
	r.Post("/admin/prospects", admin.CreateProspectHandler(db))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := testutil.DoRequest(t, srv, http.MethodPost, "/admin/prospects", `{}`, userToken)
	defer func() { _ = resp.Body.Close() }()

	assert.Equal(t, http.StatusForbidden, resp.StatusCode)
}

func TestCreateProspectHandler_IdempotentByName(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	_, adminToken := createAdminUser(t, db)

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Use(admin.RequireAdmin(db))
	r.Post("/admin/prospects", admin.CreateProspectHandler(db))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	body := `{"display_name":"Idempotent Artist","bio":"","images":[]}`

	resp1 := testutil.DoRequest(t, srv, http.MethodPost, "/admin/prospects", body, adminToken)
	defer func() { _ = resp1.Body.Close() }()
	require.Equal(t, http.StatusCreated, resp1.StatusCode)
	var r1 map[string]any
	require.NoError(t, json.NewDecoder(resp1.Body).Decode(&r1))

	// Give slightly different timestamp to avoid same-ms collision
	time.Sleep(2 * time.Millisecond)

	resp2 := testutil.DoRequest(t, srv, http.MethodPost, "/admin/prospects", body, adminToken)
	defer func() { _ = resp2.Body.Close() }()
	require.Equal(t, http.StatusCreated, resp2.StatusCode)
	var r2 map[string]any
	require.NoError(t, json.NewDecoder(resp2.Body).Decode(&r2))

	// Same profile returned — not duplicated
	assert.Equal(t, r1["profile_id"], r2["profile_id"])
}
```

Note: the `createAdminUser` helper already exists in the `admin_test` package from `middleware_test.go` — do not add a duplicate. Check `api/internal/admin/middleware_test.go` before proceeding to find the exact helper signature.

- [ ] **Step 4.2: Check the existing createAdminUser helper**

```bash
grep -n "createAdminUser\|func create" api/internal/admin/middleware_test.go | head -5
```

If the signature differs from what `prospects_test.go` expects, update the call sites in Step 4.1 to match the actual signature.

- [ ] **Step 4.3: Run tests — expect compile error**

```bash
task api:test
```

Expected: compile error `undefined: admin.CreateProspectHandler`. This is the red state.

---

### Task 5: Implement CreateProspectHandler

**Files:**
- Create: `api/internal/admin/prospects.go`

- [ ] **Step 5.1: Create the handler**

Create `api/internal/admin/prospects.go`:

```go
package admin

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

type prospectImageInput struct {
	SourceURL string `json:"source_url"`
	Caption   string `json:"caption"`
}

type createProspectRequest struct {
	DisplayName   string               `json:"display_name"`
	Bio           string               `json:"bio"`
	LocationLabel *string              `json:"location_label"`
	MediumTags    []string             `json:"medium_tags"`
	SocialLinks   json.RawMessage      `json:"social_links"`
	Images        []prospectImageInput `json:"images"`
}

type createProspectResponse struct {
	ProfileID  string `json:"profile_id"`
	ClaimToken string `json:"claim_token"`
	PreviewURL string `json:"preview_url"`
}

// CreateProspectHandler handles POST /admin/prospects.
// Creates an unclaimed artist profile from seed data (artist-preview-builder output).
// Image uploads from source_url happen in a bounded background goroutine.
func CreateProspectHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, err := auth.User(r.Context())
		if err != nil {
			httperr.Unauthorized(w)
			return
		}
		adminUUID, err := pgUUIDFromString(principal.UserID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		var req createProspectRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.BadRequest(w, "invalid request body")
			return
		}
		if req.DisplayName == "" {
			httperr.UnprocessableEntity(w, "display_name is required")
			return
		}
		if req.MediumTags == nil {
			req.MediumTags = []string{}
		}
		if req.SocialLinks == nil {
			req.SocialLinks = json.RawMessage("{}")
		}

		q := sqlcdb.New(pool)

		// Idempotency: if a prospect with the same display_name from this admin exists, return it.
		existing, findErr := q.GetProspectByNameAndCreator(r.Context(), sqlcdb.GetProspectByNameAndCreatorParams{
			DisplayName: req.DisplayName,
			CreatedBy:   adminUUID,
		})
		if findErr == nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(createProspectResponse{
				ProfileID:  existing.ID.String(),
				ClaimToken: derefStr(existing.ClaimToken),
				PreviewURL: "/profiles/preview/" + existing.PreviewToken,
			})
			return
		}
		if !errors.Is(findErr, pgx.ErrNoRows) {
			httperr.InternalServerError(w)
			return
		}

		// Create the prospect profile (user_id NULL).
		profile, err := q.CreateProspectProfile(r.Context(), sqlcdb.CreateProspectProfileParams{
			DisplayName:   req.DisplayName,
			Bio:           req.Bio,
			LocationLabel: req.LocationLabel,
			MediumTags:    req.MediumTags,
			SocialLinks:   req.SocialLinks,
			CreatedBy:     adminUUID,
		})
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		// Generate claim token (UUID-derived, URL-safe).
		claimToken := generateToken()
		profile, err = q.SetProspectClaimToken(r.Context(), sqlcdb.SetProspectClaimTokenParams{
			ID:         profile.ID,
			ClaimToken: &claimToken,
		})
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		// Create a default collection for the prospect's images.
		collection, err := q.CreateCollection(r.Context(), sqlcdb.CreateCollectionParams{
			ProfileID: profile.ID,
			Name:      "Portfolio",
		})
		if err != nil {
			slog.Error("create prospect: create collection failed", "profile_id", profile.ID, "err", err)
			// Non-fatal — prospect is usable without a collection.
		}

		// Kick off bounded image re-upload if images were supplied.
		if len(req.Images) > 0 && collection.ID.Valid {
			images := req.Images
			collectionID := collection.ID
			profileIDStr := profile.ID.String()
			go func() {
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
				defer cancel()
				uploadProspectImages(ctx, pool, collectionID, profileIDStr, images)
			}()
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(createProspectResponse{
			ProfileID:  profile.ID.String(),
			ClaimToken: claimToken,
			PreviewURL: "/profiles/preview/" + profile.PreviewToken,
		})
	}
}

func derefStr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// generateToken returns a URL-safe opaque token for the claim link.
// Reuses the preview token pattern: UUID hex without dashes.
func generateToken() string {
	id, _ := uuid.NewRandom()
	return strings.ReplaceAll(id.String(), "-", "")
}

// uploadProspectImages re-uploads images from source_url to our CDN.
// Runs in a background goroutine — failures are logged but not surfaced.
func uploadProspectImages(ctx context.Context, pool *pgxpool.Pool, collectionID pgtype.UUID, profileIDStr string, images []prospectImageInput) {
	// Image upload pipeline: for each image, call the image package's presign
	// and confirm endpoints internally. This is intentionally left as a stub
	// placeholder — implement in concert with the image package's internal API.
	// For the MVP, log that images need manual attachment.
	for _, img := range images {
		slog.Info("prospect image pending upload", "source_url", img.SourceURL, "profile_id", profileIDStr)
	}
}
```

**Important:** The `generateToken()` stub above is intentionally incomplete. Replace the body with:

```go
func generateToken() string {
	id, _ := uuid.NewRandom()
	return strings.ReplaceAll(id.String(), "-", "")
}
```

And add to the import block:
```go
import (
	// existing imports...
	"strings"
	"github.com/google/uuid"
)
```

The `GetProspectByNameAndCreator` query was added to `db/queries/artist_profiles.sql` in Task 2 and is already available after `task db:generate` ran there.

- [ ] **Step 5.2: Compile check after writing prospects.go**

```bash
task api:test
```

Expected: compile error `undefined: admin.CreateProspectHandler` resolves; any remaining errors are in the test file. Fix import issues if needed.

- [ ] **Step 5.3: Run tests**

```bash
task api:test
```

Expected: the 5 new prospect tests pass. The `uploadProspectImages` function is a stub that logs `prospect image pending upload` — this is intentional for the MVP. Full image pipeline wiring is deferred until the image package exposes an internal API for it.

- [ ] **Step 5.4: Commit**

```bash
git add api/internal/admin/prospects.go api/internal/admin/prospects_test.go \
        db/queries/artist_profiles.sql api/internal/sqlcdb/artist_profiles.sql.go
git commit -m "feat(admin): CreateProspectHandler — unclaimed profiles from seed.json"
```

---

### Task 6: Register the admin/prospects route

**Files:**
- Modify: `api/cmd/api/main.go`

- [ ] **Step 6.1: Add the route**

In `api/cmd/api/main.go`, inside the `r.Route("/admin", ...)` block, after the existing admin routes, add:

```go
r.Post("/prospects", admin.CreateProspectHandler(pool))
```

The admin block should look like:

```go
r.Route("/admin", func(r chi.Router) {
    r.Use(admin.RequireAdmin(pool))
    r.Get("/users", admin.ListUsersHandler(pool))
    r.Get("/users/{userID}", admin.GetUserHandler(pool))
    r.Post("/users/{userID}/password-reset", admin.TriggerPasswordResetHandler(pool, mailer, cfg.WebPublicBase))
    r.Post("/users/{userID}/grants", admin.CreateGrantHandler(pool))
    r.Delete("/grants/{grantID}", admin.RevokeGrantHandler(pool))
    r.Get("/promo-codes", admin.ListPromoCodesHandler(pool))
    r.Post("/promo-codes", admin.CreatePromoCodeHandler(pool))
    r.Delete("/promo-codes/{codeID}", admin.RevokePromoCodeHandler(pool))
    r.Post("/prospects", admin.CreateProspectHandler(pool))
})
```

- [ ] **Step 6.2: Compile check**

```bash
task api:test
```

Expected: passes.

- [ ] **Step 6.3: Commit**

```bash
git add api/cmd/api/main.go
git commit -m "feat(api): register POST /admin/prospects route"
```

---

### Task 7: Add claim-on-signup to the auth package

**Files:**
- Modify: `api/internal/auth/signup.go`
- Modify: `api/internal/auth/signup_test.go`

- [ ] **Step 7.1: Write failing tests for claim signup**

Open `api/internal/auth/signup_test.go`. Add these tests at the bottom of the file:

```go
func TestSignupHandler_ClaimProfile(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)

	// Create a prospect profile with a claim token directly in the DB.
	const claimToken = "testclaimtoken123"
	_, err := db.Exec(
		t.Context(),
		`INSERT INTO artist_profiles (display_name, claim_token)
		 VALUES ('Pre-built Artist', $1)`,
		claimToken,
	)
	require.NoError(t, err)

	handler := auth.SignupHandler(db, config.Config{})
	body := `{"email":"claimer@e2e.test","password":"password123","claim_token":"testclaimtoken123"}`
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/auth/signup",
		bytes.NewBufferString(body))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
	var resp map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	assert.NotEmpty(t, resp["claimed_profile_id"])
}

func TestSignupHandler_ClaimAlreadyClaimed(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)

	// Create and pre-claim a prospect.
	userID, _, _ := testutil.CreateUser(t, db)
	userUUID, _ := uuid.Parse(userID)
	const claimToken = "alreadyclaimedtoken"
	_, err := db.Exec(
		t.Context(),
		`INSERT INTO artist_profiles (display_name, claim_token, user_id, claimed_at)
		 VALUES ('Claimed Already', $1, $2, now())`,
		claimToken, userUUID,
	)
	require.NoError(t, err)

	handler := auth.SignupHandler(db, config.Config{})
	body := `{"email":"latecomer@e2e.test","password":"password123","claim_token":"alreadyclaimedtoken"}`
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/auth/signup",
		bytes.NewBufferString(body))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	require.Equal(t, http.StatusConflict, w.Code, w.Body.String())
	var resp map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	assert.Equal(t, "already_claimed", resp["code"])
}

func TestSignupHandler_ClaimBadToken(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)

	handler := auth.SignupHandler(db, config.Config{})
	body := `{"email":"badtoken@e2e.test","password":"password123","claim_token":"nosuchtoken"}`
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/auth/signup",
		bytes.NewBufferString(body))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	require.Equal(t, http.StatusConflict, w.Code, w.Body.String())
	var resp map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	assert.Equal(t, "already_claimed", resp["code"])
}
```

Add required imports to the file (`"github.com/google/uuid"` if not present).

- [ ] **Step 7.2: Run tests — expect compile or test failures**

```bash
task api:test
```

Expected: tests fail (claim logic not yet implemented).

- [ ] **Step 7.3: Implement claim logic in signup.go**

In `api/internal/auth/signup.go`:

1. Add `ClaimToken string` to `signupRequest`:

```go
type signupRequest struct {
	Email      string `json:"email"`
	Password   string `json:"password"`
	InviteCode string `json:"invite_code"`
	ClaimToken string `json:"claim_token"`
}
```

2. Add a `claimProfile` helper function at the bottom of the file:

```go
// claimProfile atomically binds a prospect profile to newUserID.
// Returns (profileID, nil) on success, ("", pgx.ErrNoRows) if no unclaimed row
// matches the token, or ("", err) for DB errors.
func claimProfile(ctx context.Context, db sqlcdb.DBTX, userID pgtype.UUID, claimToken string) (string, error) {
	q := sqlcdb.New(db)
	profile, err := q.ClaimArtistProfile(ctx, sqlcdb.ClaimArtistProfileParams{
		UserID:     userID,
		ClaimToken: claimToken,
	})
	if err != nil {
		return "", err
	}
	return profile.ID.String(), nil
}
```

Note: `sqlcdb.DBTX` is the interface satisfied by both `*pgxpool.Pool` and `pgx.Tx`. This lets `claimProfile` work inside or outside a transaction.

3. In the non-beta `SignupHandler` path, after the user is created, add:

```go
type signupResponse struct {
	User            any    `json:"user"`
	ClaimedProfileID string `json:"claimed_profile_id,omitempty"`
}

userUUID, _ := pgUUIDFromString(user.ID.String())
claimedProfileID := ""
if req.ClaimToken != "" {
	cid, claimErr := claimProfile(r.Context(), pool, userUUID, req.ClaimToken)
	if claimErr != nil {
		if errors.Is(claimErr, pgx.ErrNoRows) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusConflict)
			_ = json.NewEncoder(w).Encode(map[string]string{
				"code":    "already_claimed",
				"message": "This claim link has already been used or is invalid.",
			})
			return
		}
		slog.Error("signup: claim profile failed", "err", claimErr)
		httperr.InternalServerError(w)
		return
	}
	claimedProfileID = cid
}

w.Header().Set("Content-Type", "application/json")
w.WriteHeader(http.StatusCreated)
_ = json.NewEncoder(w).Encode(signupResponse{
	User:            toUserResponse(user),
	ClaimedProfileID: claimedProfileID,
})
```

**Important:** This replaces the existing `json.NewEncoder(w).Encode(toUserResponse(user))` line in the non-beta path with the richer response. The `signupResponse.User` field preserves the existing `toUserResponse` output as a nested object — callers that only read `user.*` fields still work unchanged.

4. Apply the same `claimProfile` call in `signupBeta` after the `tx.Commit` succeeds. Extract the claim step after the commit so the profile binding runs outside the invite-redemption transaction:

```go
if err := tx.Commit(r.Context()); err != nil {
    httperr.InternalServerError(w)
    return
}

userUUID, _ := pgUUIDFromString(user.ID.String())
claimedProfileID := ""
if req.ClaimToken != "" {
    cid, claimErr := claimProfile(r.Context(), pool, userUUID, req.ClaimToken)
    if claimErr != nil {
        if errors.Is(claimErr, pgx.ErrNoRows) {
            w.Header().Set("Content-Type", "application/json")
            w.WriteHeader(http.StatusConflict)
            _ = json.NewEncoder(w).Encode(map[string]string{
                "code":    "already_claimed",
                "message": "This claim link has already been used or is invalid.",
            })
            return
        }
        slog.Error("signup beta: claim profile failed", "err", claimErr)
        httperr.InternalServerError(w)
        return
    }
    claimedProfileID = cid
}

w.Header().Set("Content-Type", "application/json")
w.WriteHeader(http.StatusCreated)
_ = json.NewEncoder(w).Encode(signupResponse{
    User:            toUserResponse(user),
    ClaimedProfileID: claimedProfileID,
})
```

Add required imports: `"context"`, `"github.com/jackc/pgx/v5/pgtype"`.

Note: `pgUUIDFromString` already exists in `auth` package — check `auth/login.go` or similar for the definition before adding a duplicate.

- [ ] **Step 7.4: Check for pgUUIDFromString in the auth package**

```bash
grep -rn "pgUUIDFromString\|func pgUUID" api/internal/auth/
```

If not found, add it to a suitable file (e.g. `auth/signup.go`):

```go
func pgUUIDFromString(s string) (pgtype.UUID, error) {
	parsed, err := uuid.Parse(s)
	if err != nil {
		return pgtype.UUID{}, err
	}
	return pgtype.UUID{Bytes: [16]byte(parsed), Valid: true}, nil
}
```

Add `"github.com/google/uuid"` to imports.

- [ ] **Step 7.5: Run tests**

```bash
task api:test
```

Expected: all pass including the 3 new claim tests.

- [ ] **Step 7.6: Commit**

```bash
git add api/internal/auth/signup.go api/internal/auth/signup_test.go
git commit -m "feat(auth): claim-on-signup — bind prospect profile atomically at account creation"
```

---

### Task 8: Update OpenAPI spec and regenerate TS client

**Files:**
- Modify: `openapi/openapi.yaml`

- [ ] **Step 8.1: Make `user_id` nullable in `ArtistProfile`**

In `openapi/openapi.yaml`, in the `ArtistProfile` schema:

1. Remove `user_id` from the `required` array (leave `id`, `display_name`, `bio`, `visibility`, `medium_tags`, `social_links`, `headline_image_urls`, `created_at`, `updated_at` in required).

2. Update the `user_id` property:
```yaml
        user_id:
          type: string
          format: uuid
          nullable: true
          description: >-
            UUID of the owning user. Null for unclaimed prospect profiles
            (only accessible via preview token; never returned by public endpoints).
```

- [ ] **Step 8.2: Update the signup request schema**

Find the `SignupRequest` schema in `openapi/openapi.yaml` (search for `SignupRequest` or the `/auth/signup` path). Add `claim_token` as an optional field:

```yaml
        claim_token:
          type: string
          description: >-
            Optional. If present, binds a pre-built prospect profile to this
            new account atomically. 409 if the token has already been claimed.
```

Also update the signup `201` response schema to include `claimed_profile_id`:

Find the `UserResponse` schema (or the inline `201` response for `/auth/signup`) and add:

```yaml
        claimed_profile_id:
          type: string
          format: uuid
          description: >-
            ID of the profile that was bound to this account via claim_token.
            Absent if no claim_token was provided.
```

- [ ] **Step 8.3: Add admin prospects path**

In `openapi/openapi.yaml`, in the `/admin/` paths section, add:

```yaml
  /admin/prospects:
    post:
      operationId: createProspect
      summary: Create a pre-registered prospect profile (admin only)
      description: >-
        Creates an unclaimed artist profile from seed data produced by the
        artist-preview-builder skill. Returns a claim token the artist uses
        at signup to bind the waiting profile to their account.
      tags: [admin]
      security:
        - cookieAuth: []
        - bearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/CreateProspectRequest"
      responses:
        "201":
          description: Prospect created.
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ProspectResponse"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
        "422":
          $ref: "#/components/responses/UnprocessableEntity"
```

Add these two schemas to the `components.schemas` section:

```yaml
    CreateProspectRequest:
      type: object
      required: [display_name]
      properties:
        display_name:
          type: string
        bio:
          type: string
        location_label:
          type: string
          nullable: true
        medium_tags:
          type: array
          items:
            type: string
        social_links:
          type: object
          additionalProperties:
            type: string
        images:
          type: array
          items:
            type: object
            required: [source_url]
            properties:
              source_url:
                type: string
                format: uri
              caption:
                type: string

    ProspectResponse:
      type: object
      required: [profile_id, claim_token, preview_url]
      properties:
        profile_id:
          type: string
          format: uuid
        claim_token:
          type: string
        preview_url:
          type: string
```

- [ ] **Step 8.4: Regenerate TS client**

```bash
task openapi:gen
```

Expected: exits 0.

- [ ] **Step 8.5: Commit**

```bash
git add openapi/openapi.yaml openapi/
git commit -m "feat(openapi): E15.4 — nullable user_id, claim_token on signup, admin prospects endpoint"
```

---

### Task 9: Web — signup claim flow and claimed banner

**Files:**
- Modify: `web/src/app/(auth)/signup/page.tsx`
- Modify: `web/src/app/(artist)/profile/page.tsx`

- [ ] **Step 9.1: Update signup page to read `?claim=` and redirect on success**

In `web/src/app/(auth)/signup/page.tsx`, make these changes:

1. Add `claimToken` state and read it from `searchParams` (already exists for `invite`):

```tsx
const [claimToken, setClaimToken] = useState('')

useEffect(() => {
  const code = searchParams.get('invite')
  if (code) setInviteCode(code)
  const claim = searchParams.get('claim')
  if (claim) setClaimToken(claim)
}, [searchParams])
```

2. Update the signup body to include `claim_token`:

```tsx
const body = {
  email,
  password,
  role,
  ...(inviteCode ? { invite_code: inviteCode } : {}),
  ...(claimToken ? { claim_token: claimToken } : {}),
}
```

3. Update the success handling to redirect to `/profile` with `?claimed=1` when a profile was claimed:

```tsx
if (!response.ok) {
  setError('Something went wrong. Please try again.')
  return
}

const data = await response.json()
if (data?.user?.claimed_profile_id || data?.claimed_profile_id) {
  router.push('/login?registered=1&claim=1')
} else {
  router.push('/login?registered=1')
}
```

Note: the user must log in after signup — the claim redirect goes through login first. The `claim=1` query param is passed through so the profile page can show the banner after login.

**Alternative (simpler):** if the claim UX is "sign up → auto-login → land on profile", that requires auto-login after signup, which is not the current architecture. Keep the current "signup → login" flow and just redirect to `/profile` after login when `claim=1` is in the URL. The banner check is in the profile page (next step).

For the login page: after login, if `?claim=1` was in the URL that brought the user to login, pass it through. The simplest implementation: the login page already redirects to `/dashboard`; for the claim flow, redirect to `/profile?claimed=1` instead.

In `web/src/app/(auth)/login/page.tsx`, find the success redirect and update:

```tsx
// After successful login:
const claimRedirect = searchParams.get('claim')
if (claimRedirect) {
  router.push('/profile?claimed=1')
} else {
  router.push('/dashboard')
}
```

- [ ] **Step 9.2: Show the "Your page is ready" banner on the profile page**

In `web/src/app/(artist)/profile/page.tsx`, the page is a server component — `searchParams` come as a prop. Update the function signature to accept searchParams:

```tsx
export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ claimed?: string }>
}) {
  const user = await requireAuth()
  const params = await searchParams
  const justClaimed = params.claimed === '1'

  // ... existing fetch logic ...

  return (
    <div>
      <h1 className="font-serif text-4xl text-ink mb-2">Profile</h1>
      <p className="font-sans text-mid mb-8">How the world sees you.</p>
      {justClaimed && (
        <div className="mb-6 p-4 bg-amber/20 border border-amber rounded-lg">
          <p className="font-serif text-lg text-ink">Your page is ready — take a look!</p>
          <p className="font-sans text-sm text-mid mt-1">
            We&apos;ve pre-built your profile. Edit it below, then go public when you&apos;re ready.
          </p>
        </div>
      )}
      <PublishBar initialProfile={profile} />
      <ProfileForm profile={profile} userId={user.id} />
    </div>
  )
}
```

- [ ] **Step 9.3: TypeScript check**

```bash
cd web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 9.4: Commit**

```bash
git add web/src/app/(auth)/signup/page.tsx web/src/app/(auth)/login/page.tsx \
        web/src/app/(artist)/profile/page.tsx
git commit -m "feat(web): E15.4 — claim token at signup, redirect to profile with claimed banner"
```

---

### Task 10: Write API E2E tests for the full prospect-claim flow

**Files:**
- Create: `e2e/api/prospect-claim.test.ts`

- [ ] **Step 10.1: Create the test file**

Create `e2e/api/prospect-claim.test.ts`:

```typescript
// e2e/api/prospect-claim.test.ts
// E15.4 — Pre-registered prospect profiles + claim-on-signup.
// Covers: admin creates prospect, preview access, IDOR isolation, claim flow,
// double-claim race, partial-index invariants.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { createHmac } from 'node:crypto'

const API = process.env.API_URL ?? 'http://localhost:8080'
const DB_URL = process.env.DATABASE_URL ?? 'postgres://render:render@localhost:5432/render'
const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-jwt-secret-change-in-prod'
const SUFFIX = `prospect-${Date.now()}`

function auth(token: string) { return { Authorization: `Bearer ${token}` } }

function base64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}
function signHS256(payload: Record<string, unknown>, secret: string): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = base64url(JSON.stringify(payload))
  const sig = base64url(createHmac('sha256', secret).update(`${header}.${body}`).digest())
  return `${header}.${body}.${sig}`
}

async function seedAdmin(db: Client, suffix: string): Promise<{ token: string; userId: string }> {
  const email = `admin-${suffix}@prospect.test`
  await fetch(`${API}/auth/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'adminpass123' }),
  })
  const { rows } = await db.query<{ id: string; session_version: number }>(
    `UPDATE users SET is_admin = true, mfa_enabled = true, mfa_secret = 'fake-totp'
     WHERE email = $1 RETURNING id, session_version`,
    [email],
  )
  const { id: userId, session_version: sv } = rows[0]
  const now = Math.floor(Date.now() / 1000)
  const token = signHS256({ sub: userId, is_admin: true, sv, iat: now, exp: now + 3600 }, JWT_SECRET)
  return { token, userId }
}

async function signupAndLogin(email: string, password = 'testpass123') {
  await fetch(`${API}/auth/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const { token } = await res.json()
  return token as string
}

describe('E15.4 — prospect profiles + claim-on-signup', () => {
  let db: Client
  let adminToken: string
  let prospectSeed: { display_name: string; bio: string }

  beforeAll(async () => {
    db = new Client({ connectionString: DB_URL })
    await db.connect()
    const admin = await seedAdmin(db, SUFFIX)
    adminToken = admin.token
    prospectSeed = { display_name: `Street Artist ${SUFFIX}`, bio: 'I paint walls.' }
  })

  afterAll(async () => { await db.end() })

  // ── Auth probe ──────────────────────────────────────────────────────────────

  it('POST /admin/prospects without token → 401', async () => {
    const res = await fetch(`${API}/admin/prospects`, { method: 'POST' })
    expect(res.status).toBe(401)
  })

  it('POST /admin/prospects as non-admin → 403', async () => {
    const token = await signupAndLogin(`nonAdmin-${SUFFIX}@prospect.test`)
    const res = await fetch(`${API}/admin/prospects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(token) },
      body: JSON.stringify(prospectSeed),
    })
    expect(res.status).toBe(403)
  })

  // ── Create prospect ─────────────────────────────────────────────────────────

  let profileId: string
  let claimToken: string
  let previewUrl: string

  it('admin creates prospect → 201 with claim_token and preview_url', async () => {
    const res = await fetch(`${API}/admin/prospects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(adminToken) },
      body: JSON.stringify({ ...prospectSeed, images: [] }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.profile_id).toBeTruthy()
    expect(body.claim_token).toBeTruthy()
    expect(body.preview_url).toMatch(/\/profiles\/preview\//)
    profileId = body.profile_id
    claimToken = body.claim_token
    previewUrl = body.preview_url
  })

  it('admin creates same prospect again → 201 with same profile_id (idempotent)', async () => {
    const res = await fetch(`${API}/admin/prospects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(adminToken) },
      body: JSON.stringify({ ...prospectSeed, images: [] }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.profile_id).toBe(profileId)
  })

  // ── Isolation: unclaimed profile is invisible ───────────────────────────────

  it('GET /profiles/{id} for unclaimed prospect → 404 (anonymous)', async () => {
    const res = await fetch(`${API}/profiles/${profileId}`)
    expect(res.status).toBe(404)
  })

  it('GET /profiles/{id} for unclaimed prospect → 404 (random auth user)', async () => {
    const token = await signupAndLogin(`randuser-${SUFFIX}@prospect.test`)
    const res = await fetch(`${API}/profiles/${profileId}`, { headers: auth(token) })
    expect(res.status).toBe(404)
  })

  it('unclaimed profile not in GET /public/profiles', async () => {
    const res = await fetch(`${API}/public/profiles`)
    expect(res.ok).toBe(true)
    const body = await res.json()
    const ids = (body.profiles as { id: string }[]).map(p => p.id)
    expect(ids).not.toContain(profileId)
  })

  // ── Preview token grants access ─────────────────────────────────────────────

  it('GET /profiles/preview/{token} → 200 with profile data', async () => {
    const token = previewUrl.replace('/profiles/preview/', '')
    const res = await fetch(`${API}/profiles/preview/${token}`)
    expect(res.ok).toBe(true)
    const body = await res.json()
    expect(body.display_name).toBe(prospectSeed.display_name)
  })

  // ── IDOR: user A cannot access user B's prospect collections ───────────────

  it('GET /profiles/{id}/collections for unclaimed prospect → 404', async () => {
    const token = await signupAndLogin(`idor-${SUFFIX}@prospect.test`)
    const res = await fetch(`${API}/profiles/${profileId}/collections`, { headers: auth(token) })
    expect(res.status).toBe(404)
  })

  // ── Claim at signup ─────────────────────────────────────────────────────────

  let claimerToken: string

  it('signup with claim_token → 201 with claimed_profile_id', async () => {
    const email = `claimer-${SUFFIX}@prospect.test`
    const res = await fetch(`${API}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'testpass123', claim_token: claimToken }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.claimed_profile_id ?? body.user?.claimed_profile_id).toBeTruthy()

    const loginRes = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'testpass123' }),
    })
    const { token } = await loginRes.json()
    claimerToken = token
  })

  it('after claim: owner can GET /profiles/me and see the profile', async () => {
    const res = await fetch(`${API}/profiles/me`, { headers: auth(claimerToken) })
    expect(res.ok).toBe(true)
    const body = await res.json()
    expect(body.id).toBe(profileId)
    expect(body.display_name).toBe(prospectSeed.display_name)
  })

  it('after claim: profile visible at GET /profiles/{id} to owner', async () => {
    const res = await fetch(`${API}/profiles/${profileId}`, { headers: auth(claimerToken) })
    expect(res.ok).toBe(true)
  })

  // ── Race-safe double claim ──────────────────────────────────────────────────

  it('two concurrent claim attempts → exactly one 201, one 409', async () => {
    // Create a fresh unclaimed prospect for the race test.
    const prospectRes = await fetch(`${API}/admin/prospects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(adminToken) },
      body: JSON.stringify({ display_name: `Race Prospect ${SUFFIX}`, bio: '', images: [] }),
    })
    const { claim_token: raceToken } = await prospectRes.json()

    const email1 = `racer1-${SUFFIX}@prospect.test`
    const email2 = `racer2-${SUFFIX}@prospect.test`

    const [r1, r2] = await Promise.all([
      fetch(`${API}/auth/signup`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email1, password: 'testpass123', claim_token: raceToken }),
      }),
      fetch(`${API}/auth/signup`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email2, password: 'testpass123', claim_token: raceToken }),
      }),
    ])

    const statuses = [r1.status, r2.status].sort()
    expect(statuses).toEqual([201, 409])
  })

  it('re-claim already-claimed token → 409 with already_claimed', async () => {
    const email = `reclaimer-${SUFFIX}@prospect.test`
    const res = await fetch(`${API}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'testpass123', claim_token: claimToken }),
    })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('already_claimed')
  })

  // ── Partial index: two NULL-user prospects coexist ──────────────────────────

  it('two unclaimed prospects can coexist (partial index allows multiple NULLs)', async () => {
    const r1 = await fetch(`${API}/admin/prospects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(adminToken) },
      body: JSON.stringify({ display_name: `Coexist A ${SUFFIX}`, bio: '', images: [] }),
    })
    const r2 = await fetch(`${API}/admin/prospects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(adminToken) },
      body: JSON.stringify({ display_name: `Coexist B ${SUFFIX}`, bio: '', images: [] }),
    })
    expect(r1.status).toBe(201)
    expect(r2.status).toBe(201)
    const b1 = await r1.json()
    const b2 = await r2.json()
    expect(b1.profile_id).not.toBe(b2.profile_id)
  })
})
```

- [ ] **Step 10.2: Ensure the stack is running**

```bash
docker compose -f infra/docker-compose.yml ps
```

If not: `task up && sleep 30`.

- [ ] **Step 10.3: Run the new test file**

```bash
npx vitest run e2e/api/prospect-claim.test.ts
```

Expected: all tests pass.

- [ ] **Step 10.4: Run the full API e2e suite**

```bash
task e2e:api
```

Expected: all existing tests still pass.

- [ ] **Step 10.5: Commit**

```bash
git add e2e/api/prospect-claim.test.ts
git commit -m "test(e2e): E15.4 — prospect claim flow, IDOR matrix, race-safe double-claim"
```

---

### Task 11: Update specs and open PR

- [ ] **Step 11.1: Update artist.spec.md**

In `api/internal/artist/artist.spec.md`:

- Add to **Contract**: `- Unclaimed prospect profiles: accessible only via preview token; never returned by GET /profiles/{id} or public listing`
- Update **Invariants**: add `- GET /profiles/{profileID} MUST 404 for unclaimed profiles (user_id IS NULL) regardless of requester's auth state`
- Update **AI Context**: note `user_id` is nullable since migration 000018; `toProfileResponse` returns `UserID *string`
- Add to **Key Decisions**: `- Nullable user_id: profiles owned by nobody until claimed; the partial unique index (WHERE user_id IS NOT NULL) enforces 1:1 user↔profile invariant only for claimed profiles`

- [ ] **Step 11.2: Update admin.spec.md**

In `api/internal/admin/admin.spec.md`:

- Add to **Contract**: `- Prospect profiles: POST /admin/prospects — creates unclaimed profiles from seed.json; returns claim_token + preview_url`
- Add to **AI Context**: `- prospects.go: CreateProspectHandler — creates null-user_id prospect profiles; image upload is fire-and-forget background work (see background-work.md)`

- [ ] **Step 11.3: Update auth.spec.md**

In `api/internal/auth/auth.spec.md`:

- Add to **Contract**: `- Claim-on-signup: POST /auth/signup accepts optional claim_token; atomically binds a waiting prospect profile after account creation; 409 if token already used`

- [ ] **Step 11.4: Commit specs**

```bash
git add api/internal/artist/artist.spec.md api/internal/admin/admin.spec.md api/internal/auth/auth.spec.md
git commit -m "docs(spec): update artist/admin/auth specs for E15.4 prospect + claim changes"
```

- [ ] **Step 11.5: Run full suite**

```bash
task api:test
task e2e:api
npx playwright test
```

Expected: all pass.

- [ ] **Step 11.6: Open the PR**

```bash
gh pr create \
  --title "[E15.4] Pre-registered prospect profiles + claim-on-signup" \
  --body "$(cat <<'EOF'
## Summary
- Migration 000018: `artist_profiles.user_id` nullable + partial unique index (WHERE NOT NULL) + `claim_token`/`claimed_at`/`created_by` columns
- `POST /admin/prospects` — creates unclaimed profiles from seed.json; returns claim token + preview URL; image upload is bounded background work
- `POST /auth/signup` + `claim_token` — atomically binds a waiting prospect profile to a new account; 409 on double-claim
- Web: signup reads `?claim=` param, passes `claim_token` in body, redirects to `/profile?claimed=1` on success; profile page shows "Your page is ready" banner
- API E2E: IDOR matrix, preview access, race-safe double-claim (`Promise.all` → exactly one 200, one 409), partial-index coexistence

Closes #179. Part of #175.

## Test plan
- [ ] `task api:test` passes
- [ ] `npx vitest run e2e/api/prospect-claim.test.ts` — all tests pass
- [ ] `task e2e:api` — full API suite passes
- [ ] `npx playwright test` — browser suite passes

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

