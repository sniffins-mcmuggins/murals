# E8 — React Native App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the public-facing React Native mobile app (festivals, maps, artist profiles, discovery) on top of the completed Go API (E1–E6).

**Architecture:** Two small API additions land first (public festival listing + public profile listing). Then the bare RN scaffold with TS strict, Metro path alias, navigation, auth infra, and API client. Four screen tasks run **in parallel** after the foundation merges (Tasks 12–15 are independent). Smoke tests follow.

**Tech Stack:** React Native 0.74 (bare, no Expo), TypeScript strict, React Navigation 6 (bottom tabs + native stack), TanStack Query v5, react-native-webview, react-native-keychain, @react-native-community/geolocation, openapi-fetch (shared `openapi/client` package), Jest + @testing-library/react-native.

**Repo module path:** `github.com/sniffins-mcmuggins/render/api`  
**Working directory:** repo root (all paths are relative to it unless noted)

---

## File Map

### API additions
| Action | Path |
|--------|------|
| Modify | `db/queries/festivals.sql` |
| Modify | `db/queries/artist_profiles.sql` |
| Generated | `api/internal/sqlcdb/festivals.sql.go` |
| Generated | `api/internal/sqlcdb/artist_profiles.sql.go` |
| Modify | `api/internal/festival/festival.go` |
| Create | `api/internal/festival/public_test.go` |
| Modify | `api/internal/artist/profile.go` |
| Create | `api/internal/artist/public_test.go` |
| Modify | `api/cmd/api/main.go` |
| Modify | `openapi/openapi.yaml` |
| Generated | `openapi/client/index.ts` (regenerated) |

### Mobile foundation
| Action | Path |
|--------|------|
| Modify | `mobile/package.json` |
| Create | `mobile/tsconfig.json` |
| Create | `mobile/metro.config.js` |
| Create | `mobile/babel.config.js` |
| Create | `mobile/.eslintrc.js` |
| Create | `mobile/prettier.config.js` |
| Create | `mobile/jest.config.js` |
| Create | `mobile/index.js` |
| Create | `mobile/App.tsx` |
| Create | `mobile/src/lib/auth.ts` |
| Create | `mobile/src/lib/api.ts` |
| Create | `mobile/src/navigation/types.ts` |
| Create | `mobile/src/navigation/BottomTabNavigator.tsx` |
| Create | `mobile/src/navigation/HomeStack.tsx` |
| Create | `mobile/src/navigation/MapStack.tsx` |
| Create | `mobile/src/navigation/DiscoverStack.tsx` |
| Create | `mobile/src/navigation/RootNavigator.tsx` |
| Create | `mobile/src/components/LoadingSkeleton.tsx` |
| Create | `mobile/src/assets/mapHtml.ts` |

### Screens (parallel — Tasks 12–15)
| Action | Path |
|--------|------|
| Create | `mobile/src/screens/Home/HomeScreen.tsx` |
| Create | `mobile/src/components/FestivalCard.tsx` |
| Create | `mobile/src/screens/FestivalMap/FestivalMapScreen.tsx` |
| Create | `mobile/src/screens/ArtistProfile/ArtistProfileScreen.tsx` |
| Create | `mobile/src/components/ArtistCard.tsx` |
| Create | `mobile/src/lib/location.ts` |
| Create | `mobile/src/screens/Discover/DiscoverScreen.tsx` |

### Smoke tests
| Action | Path |
|--------|------|
| Create | `mobile/src/screens/Home/__tests__/HomeScreen.test.tsx` |
| Create | `mobile/src/screens/FestivalMap/__tests__/FestivalMapScreen.test.tsx` |
| Create | `mobile/src/screens/ArtistProfile/__tests__/ArtistProfileScreen.test.tsx` |
| Create | `mobile/src/screens/Discover/__tests__/DiscoverScreen.test.tsx` |

### Platform deep links
| Action | Path |
|--------|------|
| Modify | `mobile/ios/RenderMobile/Info.plist` |
| Modify | `mobile/android/app/src/main/AndroidManifest.xml` |

---

## Task 1: Add `ListPublicFestivals` SQL query

**Files:**
- Modify: `db/queries/festivals.sql`
- Generated: `api/internal/sqlcdb/festivals.sql.go`

- [ ] **Add query to `db/queries/festivals.sql`** (append after the last existing query):

```sql
-- name: ListPublicFestivals :many
SELECT * FROM festivals
WHERE deleted_at IS NULL AND status = $1
ORDER BY start_date ASC NULLS LAST, created_at DESC;
```

- [ ] **Regenerate sqlc from repo root:**

```bash
task db:generate
```

Expected: no errors. Check `api/internal/sqlcdb/festivals.sql.go` — it should now contain a `ListPublicFestivals` function with signature:
```go
func (q *Queries) ListPublicFestivals(ctx context.Context, status FestivalStatus) ([]Festival, error)
```

- [ ] **Commit:**

```bash
git add db/queries/festivals.sql api/internal/sqlcdb/festivals.sql.go
git commit -m "feat(db): add ListPublicFestivals query"
```

---

## Task 2: Add `GET /public/festivals` handler + route + test

**Files:**
- Modify: `api/internal/festival/festival.go`
- Create: `api/internal/festival/public_test.go`
- Modify: `api/cmd/api/main.go`

- [ ] **Write the failing test** in `api/internal/festival/public_test.go`:

```go
package festival_test

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/sniffins-mcmuggins/render/api/internal/festival"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

func TestListPublicFestivals(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	orgID, _ := createTestUser(t, db, "pub-org@example.com", "organiser")

	// Create one live and one draft festival
	createTestFestival(t, db, orgID, "live-fest-2027", "live")
	createTestFestival(t, db, orgID, "draft-fest-2027", "draft")

	r := chi.NewRouter()
	r.Get("/public/festivals", festival.ListPublicHandler(db))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "GET", "/public/festivals", "", "")
	require.Equal(t, http.StatusOK, resp.StatusCode)

	var body []map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	_ = resp.Body.Close()

	assert.Len(t, body, 1)
	assert.Equal(t, "live-fest-2027", body[0]["slug"])
}

func TestListPublicFestivals_StatusFilter(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	orgID, _ := createTestUser(t, db, "pub-org2@example.com", "organiser")

	createTestFestival(t, db, orgID, "open-fest-2027", "open")
	createTestFestival(t, db, orgID, "live-fest2-2027", "live")

	r := chi.NewRouter()
	r.Get("/public/festivals", festival.ListPublicHandler(db))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "GET", "/public/festivals?status=open", "", "")
	require.Equal(t, http.StatusOK, resp.StatusCode)

	var body []map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	_ = resp.Body.Close()

	assert.Len(t, body, 1)
	assert.Equal(t, "open-fest-2027", body[0]["slug"])
}

func TestListPublicFestivals_InvalidStatus(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)

	r := chi.NewRouter()
	r.Get("/public/festivals", festival.ListPublicHandler(db))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "GET", "/public/festivals?status=invalid", "", "")
	assert.Equal(t, http.StatusBadRequest, resp.StatusCode)
	_ = resp.Body.Close()
}
```

- [ ] **Run the test to confirm it fails:**

```bash
task api:test:unit 2>&1 | grep -E "FAIL|PASS|ListPublicFestivals"
```

Expected: FAIL — `festival.ListPublicHandler` undefined.

- [ ] **Add `ListPublicHandler`** to `api/internal/festival/festival.go` (append before the final closing brace, after `ListHandler`):

```go
// ListPublicHandler handles GET /public/festivals. No auth required.
// Returns festivals filtered by status (default: live).
func ListPublicHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		statusParam := r.URL.Query().Get("status")
		if statusParam == "" {
			statusParam = "live"
		}
		status := sqlcdb.FestivalStatus(statusParam)
		switch status {
		case sqlcdb.FestivalStatusLive, sqlcdb.FestivalStatusOpen, sqlcdb.FestivalStatusArchived:
		default:
			httperr.BadRequest(w, "status must be live, open, or archived")
			return
		}

		q := sqlcdb.New(pool)
		festivals, err := q.ListPublicFestivals(r.Context(), status)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		resp := make([]festivalResponse, len(festivals))
		for i, f := range festivals {
			resp[i] = toFestivalResponse(f)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}
}
```

- [ ] **Register the route** in `api/cmd/api/main.go`. After the line `r.Get("/festivals/slug/{slug}/map", festival.GetMapDataHandler(pool))`, add:

```go
r.Get("/public/festivals", festival.ListPublicHandler(pool))
```

- [ ] **Run tests to confirm they pass:**

```bash
task api:test:unit 2>&1 | grep -E "FAIL|ok|ListPublicFestivals"
```

Expected: all `ok`, no `FAIL`.

- [ ] **Commit:**

```bash
git add api/internal/festival/festival.go api/internal/festival/public_test.go \
        api/internal/festival/testhelpers_test.go api/cmd/api/main.go
git commit -m "feat(api): add GET /public/festivals endpoint"
```

---

## Task 3: Add `ListPublicProfiles` SQL queries + regenerate

**Files:**
- Modify: `db/queries/artist_profiles.sql`
- Generated: `api/internal/sqlcdb/artist_profiles.sql.go`

- [ ] **Append to `db/queries/artist_profiles.sql`:**

```sql
-- name: ListPublicProfiles :many
SELECT * FROM artist_profiles
ORDER BY created_at DESC
LIMIT $1 OFFSET $2;

-- name: CountPublicProfiles :one
SELECT COUNT(*) FROM artist_profiles;
```

- [ ] **Regenerate:**

```bash
task db:generate
```

Expected: `api/internal/sqlcdb/artist_profiles.sql.go` now has:
```go
func (q *Queries) ListPublicProfiles(ctx context.Context, arg ListPublicProfilesParams) ([]ArtistProfile, error)
func (q *Queries) CountPublicProfiles(ctx context.Context) (int64, error)
```

Where `ListPublicProfilesParams` has `Limit int32` and `Offset int32`.

- [ ] **Commit:**

```bash
git add db/queries/artist_profiles.sql api/internal/sqlcdb/artist_profiles.sql.go
git commit -m "feat(db): add ListPublicProfiles + CountPublicProfiles queries"
```

---

## Task 4: Add `GET /public/profiles` handler + route + test

**Files:**
- Modify: `api/internal/artist/profile.go`
- Create: `api/internal/artist/public_test.go`
- Modify: `api/cmd/api/main.go`

- [ ] **Add `profileListResponse` type** to `api/internal/artist/profile.go`. After the existing `profileResponse` struct definition, add:

```go
type profileListResponse struct {
	Profiles []profileResponse `json:"profiles"`
	Total    int               `json:"total"`
	Page     int               `json:"page"`
	PerPage  int               `json:"per_page"`
}
```

- [ ] **Write the failing test** in `api/internal/artist/public_test.go`:

```go
package artist_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"

	"github.com/sniffins-mcmuggins/render/api/internal/artist"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

func createArtistWithProfile(t *testing.T, pool *pgxpool.Pool, email, displayName string) {
	t.Helper()
	hash, _ := bcrypt.GenerateFromPassword([]byte("pass"), bcrypt.MinCost)
	q := sqlcdb.New(pool)
	user, err := q.CreateUser(context.Background(), sqlcdb.CreateUserParams{
		Email:        email,
		PasswordHash: string(hash),
		Role:         sqlcdb.UserRoleArtist,
	})
	require.NoError(t, err)
	_, err = q.CreateArtistProfile(context.Background(), sqlcdb.CreateArtistProfileParams{
		UserID:      user.ID,
		DisplayName: displayName,
	})
	require.NoError(t, err)
}

func TestListPublicProfiles(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)

	r := chi.NewRouter()
	r.Get("/public/profiles", artist.ListPublicProfilesHandler(db))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	// Empty initially
	resp, err := http.Get(srv.URL + "/public/profiles")
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var empty struct {
		Profiles []any `json:"profiles"`
		Total    int   `json:"total"`
	}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&empty))
	_ = resp.Body.Close()
	assert.Equal(t, 0, empty.Total)
	assert.Empty(t, empty.Profiles)
}

func TestListPublicProfiles_Pagination(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)

	// Insert 3 profiles
	for i := range 3 {
		email := "artist" + string(rune('a'+i)) + "@example.com"
		createArtistWithProfile(t, db, email, "Artist "+string(rune('A'+i)))
	}

	r := chi.NewRouter()
	r.Get("/public/profiles", artist.ListPublicProfilesHandler(db))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp, err := http.Get(srv.URL + "/public/profiles?page=1&per_page=2")
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, resp.StatusCode)

	var body struct {
		Profiles []any `json:"profiles"`
		Total    int   `json:"total"`
		Page     int   `json:"page"`
		PerPage  int   `json:"per_page"`
	}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	_ = resp.Body.Close()

	assert.Equal(t, 3, body.Total)
	assert.Equal(t, 2, len(body.Profiles))
	assert.Equal(t, 1, body.Page)
	assert.Equal(t, 2, body.PerPage)
}
```

- [ ] **Run to confirm it fails:**

```bash
cd api && go test ./internal/artist/... -run TestListPublicProfiles -count=1 -short 2>&1 | tail -5
```

Expected: FAIL — `artist.ListPublicProfilesHandler` undefined.

- [ ] **Add `ListPublicProfilesHandler`** to `api/internal/artist/profile.go`. Add `"strconv"` to the import block. Append the handler after `UpdateProfileHandler`:

```go
// ListPublicProfilesHandler handles GET /public/profiles. No auth required.
// Returns paginated public artist profiles.
func ListPublicProfilesHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		page, perPage := 1, 20
		if p := r.URL.Query().Get("page"); p != "" {
			if n, err := strconv.Atoi(p); err == nil && n > 0 {
				page = n
			}
		}
		if pp := r.URL.Query().Get("per_page"); pp != "" {
			if n, err := strconv.Atoi(pp); err == nil && n > 0 && n <= 100 {
				perPage = n
			}
		}

		q := sqlcdb.New(pool)
		profiles, err := q.ListPublicProfiles(r.Context(), sqlcdb.ListPublicProfilesParams{
			Limit:  int32(perPage),
			Offset: int32((page - 1) * perPage),
		})
		if err != nil {
			httperr.InternalServerError(w)
			return
		}
		total, err := q.CountPublicProfiles(r.Context())
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		resp := profileListResponse{
			Profiles: make([]profileResponse, len(profiles)),
			Total:    int(total),
			Page:     page,
			PerPage:  perPage,
		}
		for i, p := range profiles {
			resp.Profiles[i] = toProfileResponse(p, true)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}
}
```

- [ ] **Register route** in `api/cmd/api/main.go`. After `r.Get("/public/festivals", ...)`, add:

```go
r.Get("/public/profiles", artist.ListPublicProfilesHandler(pool))
```

- [ ] **Run tests to confirm pass:**

```bash
cd api && go test ./internal/artist/... -run TestListPublicProfiles -count=1 -short 2>&1 | tail -5
```

Expected: PASS.

- [ ] **Run full unit suite to confirm nothing broke:**

```bash
task api:test:unit 2>&1 | tail -20
```

Expected: all `ok`, no `FAIL`.

- [ ] **Commit:**

```bash
git add api/internal/artist/profile.go api/internal/artist/public_test.go \
        api/cmd/api/main.go
git commit -m "feat(api): add GET /public/profiles paginated endpoint"
```

---

## Task 5: Update OpenAPI spec + regenerate TS client

**Files:**
- Modify: `openapi/openapi.yaml`
- Generated: `openapi/client/index.ts` (via `task openapi:gen`)

- [ ] **Add `ProfileListResponse` schema** to `openapi/openapi.yaml`. Find the `components: schemas:` section (around line 28). Add after the last existing schema (before `securitySchemes:`):

```yaml
    ProfileListResponse:
      type: object
      required: [profiles, total, page, per_page]
      properties:
        profiles:
          type: array
          items:
            $ref: "#/components/schemas/ArtistProfile"
        total:
          type: integer
          description: Total number of profiles.
        page:
          type: integer
          description: Current page number (1-based).
        per_page:
          type: integer
          description: Number of profiles per page.
```

- [ ] **Add `GET /public/festivals` path** to `openapi/openapi.yaml`. Add after the `GET /festivals` section (around line 1040, before `/festivals/slug/{slug}/map:`):

```yaml
  /public/festivals:
    get:
      operationId: listPublicFestivals
      summary: List public festivals by status
      description: Returns festivals visible to unauthenticated visitors, filtered by status.
      tags: [festival]
      security: []
      parameters:
        - name: status
          in: query
          required: false
          schema:
            type: string
            enum: [live, open, archived]
            default: live
      responses:
        "200":
          description: List of matching festivals.
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: "#/components/schemas/Festival"
        "400":
          $ref: "#/components/responses/BadRequest"
```

- [ ] **Add `GET /public/profiles` path** to `openapi/openapi.yaml`. Add after the `/public/festivals` section just added:

```yaml
  /public/profiles:
    get:
      operationId: listPublicProfiles
      summary: Paginated list of public artist profiles
      tags: [artist]
      security: []
      parameters:
        - name: page
          in: query
          required: false
          schema:
            type: integer
            default: 1
            minimum: 1
        - name: per_page
          in: query
          required: false
          schema:
            type: integer
            default: 20
            minimum: 1
            maximum: 100
      responses:
        "200":
          description: Paginated artist profiles.
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ProfileListResponse"
```

- [ ] **Regenerate the TS client:**

```bash
task openapi:gen
```

Expected: no errors. The file `openapi/generated/client.d.ts` (or equivalent) will update.

- [ ] **Run OpenAPI client tests:**

```bash
task openapi:test
```

Expected: 6 tests pass (existing tests, no regressions).

- [ ] **Commit:**

```bash
git add openapi/openapi.yaml openapi/generated/ openapi/client/
git commit -m "feat(openapi): add /public/festivals and /public/profiles endpoints"
```

---

## Task 6: RN scaffold — init bare project

**Files:**
- Replaces: `mobile/package.json`, `mobile/tsconfig.json`, `mobile/babel.config.js`, `mobile/metro.config.js`
- Creates: `mobile/index.js`, `mobile/App.tsx`, `mobile/ios/`, `mobile/android/`
- Preserves: `mobile/Taskfile.yml`

- [ ] **Back up the existing Taskfile:**

```bash
cp mobile/Taskfile.yml /tmp/mobile_taskfile_backup.yml
```

- [ ] **Run RN init into a temp dir (takes ~2 minutes):**

```bash
cd /tmp && npx @react-native-community/cli@latest init RenderMobile --skip-install 2>&1
```

Expected: directory `/tmp/RenderMobile/` created with `ios/`, `android/`, `index.js`, `App.tsx`, `package.json`, `tsconfig.json`, `babel.config.js`, `metro.config.js`, etc.

- [ ] **Copy generated project into `mobile/`:**

```bash
# Copy everything, overwriting existing files
cp -r /tmp/RenderMobile/. /path/to/repo/mobile/
```

Replace `/path/to/repo` with the repo root path from `git rev-parse --show-toplevel`.

- [ ] **Restore Taskfile:**

```bash
cp /tmp/mobile_taskfile_backup.yml mobile/Taskfile.yml
```

- [ ] **Replace `mobile/package.json`** with the following (merge the init-generated scripts with our extras — use this exact content, adjusting the RN version to match what was installed):

```json
{
  "name": "render-mobile",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "ios": "react-native run-ios",
    "android": "react-native run-android",
    "start": "react-native start",
    "lint": "eslint src --ext .ts,.tsx",
    "typecheck": "tsc --noEmit",
    "test": "jest --passWithNoTests"
  },
  "dependencies": {
    "react": "18.2.0",
    "react-native": "0.74.5",
    "@react-navigation/native": "^6.1.18",
    "@react-navigation/bottom-tabs": "^6.6.1",
    "@react-navigation/stack": "^6.4.1",
    "@tanstack/react-query": "^5.56.2",
    "react-native-screens": "^3.34.0",
    "react-native-safe-area-context": "^4.11.0",
    "react-native-gesture-handler": "^2.20.0",
    "react-native-webview": "^13.12.2",
    "react-native-keychain": "^8.2.0",
    "@react-native-community/geolocation": "^3.3.0"
  },
  "devDependencies": {
    "@babel/core": "^7.20.0",
    "@babel/preset-env": "^7.20.0",
    "@babel/runtime": "^7.20.0",
    "@react-native/babel-preset": "^0.74.87",
    "@react-native/eslint-config": "^0.74.87",
    "@react-native/metro-config": "^0.74.87",
    "@react-native/typescript-config": "^0.74.87",
    "@testing-library/react-native": "^12.7.2",
    "@types/jest": "^29.5.13",
    "@types/react": "^18.2.6",
    "@types/react-test-renderer": "^18.0.7",
    "babel-jest": "^29.6.3",
    "babel-plugin-module-resolver": "^5.0.2",
    "eslint": "^8.57.0",
    "jest": "^29.6.3",
    "prettier": "3.3.3",
    "react-test-renderer": "18.2.0",
    "typescript": "5.0.4"
  },
  "jest": {
    "preset": "react-native"
  },
  "engines": {
    "node": ">=18"
  }
}
```

> **Note:** Match the exact `react-native` and `@react-native/*` versions that were installed by the init command (`cat /tmp/RenderMobile/package.json | grep react-native`).

- [ ] **Install dependencies:**

```bash
cd mobile && npm install
```

Expected: `node_modules/` populated, no peer-dep errors.

- [ ] **Verify iOS build entry point:**

```bash
cd mobile && npx react-native run-ios --simulator "iPhone 15" 2>&1 | tail -5
```

Expected: Metro bundler starts, simulator opens with the default RN welcome screen. If you see the welcome screen, the scaffold is working.

> **Troubleshooting:** If the build fails with missing pods, run `cd mobile/ios && pod install && cd ../..` first.

- [ ] **Commit everything:**

```bash
git add mobile/
git commit -m "feat(mobile): initialise React Native 0.74 bare project"
```

---

## Task 7: TypeScript strict config + Metro path alias

**Files:**
- Modify: `mobile/tsconfig.json`
- Create: `mobile/metro.config.js` (replace init-generated)
- Modify: `mobile/babel.config.js`

- [ ] **Replace `mobile/tsconfig.json`:**

```json
{
  "extends": "@react-native/typescript-config/tsconfig.json",
  "compilerOptions": {
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "baseUrl": ".",
    "paths": {
      "@render/api-client": ["../openapi/client/index.ts"]
    }
  },
  "include": ["src", "App.tsx", "index.js"]
}
```

- [ ] **Replace `mobile/metro.config.js`:**

```js
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config')
const path = require('path')

const repoRoot = path.resolve(__dirname, '..')

const config = {
  watchFolders: [path.resolve(repoRoot, 'openapi/client')],
  resolver: {
    extraNodeModules: {
      '@render/api-client': path.resolve(repoRoot, 'openapi/client'),
    },
  },
}

module.exports = mergeConfig(getDefaultConfig(__dirname), config)
```

- [ ] **Replace `mobile/babel.config.js`:**

```js
module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    [
      'module-resolver',
      {
        root: ['./src'],
        alias: {
          '@render/api-client': '../openapi/client/index.ts',
        },
      },
    ],
  ],
}
```

- [ ] **Verify TypeScript compiles with no errors:**

```bash
cd mobile && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors (or only errors from files not yet created — that's OK at this stage, as long as the config itself is valid).

- [ ] **Commit:**

```bash
git add mobile/tsconfig.json mobile/metro.config.js mobile/babel.config.js
git commit -m "feat(mobile): add TS strict config + Metro path alias for @render/api-client"
```

---

## Task 8: ESLint + Prettier + Jest config

**Files:**
- Create: `mobile/.eslintrc.js`
- Create: `mobile/prettier.config.js`
- Modify: `mobile/jest.config.js`

- [ ] **Create `mobile/.eslintrc.js`:**

```js
module.exports = {
  root: true,
  extends: ['@react-native'],
  plugins: ['prettier'],
  rules: {
    'prettier/prettier': 'error',
  },
}
```

- [ ] **Create `mobile/prettier.config.js`:**

```js
module.exports = {
  singleQuote: true,
  trailingComma: 'all',
  semi: false,
  printWidth: 100,
}
```

- [ ] **Replace `mobile/jest.config.js`** (or create if absent):

```js
module.exports = {
  preset: 'react-native',
  moduleNameMapper: {
    '^@render/api-client$': '<rootDir>/../openapi/client/index.ts',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(react-native|@react-native|@react-navigation|react-native-screens|react-native-safe-area-context|react-native-gesture-handler|react-native-webview|react-native-keychain|@react-native-community)/)',
  ],
  setupFilesAfterFramework: ['@testing-library/react-native/extend-expect'],
  testPathPattern: 'src/.*\\.test\\.tsx?$',
}
```

- [ ] **Run lint to verify config is valid:**

```bash
cd mobile && npm run lint -- --max-warnings 0 2>&1 | tail -10
```

Expected: 0 warnings, 0 errors (against `App.tsx` / `index.js` which exist from init).

- [ ] **Run tests:**

```bash
cd mobile && npm test 2>&1 | tail -5
```

Expected: `Test Suites: 0 skipped` (no tests yet, `--passWithNoTests` ensures exit 0).

- [ ] **Commit:**

```bash
git add mobile/.eslintrc.js mobile/prettier.config.js mobile/jest.config.js
git commit -m "feat(mobile): add ESLint + Prettier + Jest config"
```

---

## Task 9: Auth infrastructure

**Files:**
- Create: `mobile/src/lib/auth.ts`
- Modify: `mobile/App.tsx`

- [ ] **Create `mobile/src/lib/auth.ts`:**

```ts
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import * as Keychain from 'react-native-keychain'

const KEYCHAIN_SERVICE = 'render-mobile-jwt'

interface AuthContextValue {
  token: string | null
  setToken: (token: string) => Promise<void>
  clearToken: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue>({
  token: null,
  setToken: async () => {},
  clearToken: async () => {},
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setTokenState] = useState<string | null>(null)

  useEffect(() => {
    Keychain.getGenericPassword({ service: KEYCHAIN_SERVICE }).then((result) => {
      if (result) setTokenState(result.password)
    })
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      setToken: async (t: string) => {
        await Keychain.setGenericPassword('jwt', t, { service: KEYCHAIN_SERVICE })
        setTokenState(t)
      },
      clearToken: async () => {
        await Keychain.resetGenericPassword({ service: KEYCHAIN_SERVICE })
        setTokenState(null)
      },
    }),
    [token],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext)
}
```

- [ ] **Verify TypeScript is happy:**

```bash
cd mobile && npx tsc --noEmit 2>&1 | grep auth
```

Expected: no errors for `src/lib/auth.ts`.

- [ ] **Commit:**

```bash
git add mobile/src/lib/auth.ts
git commit -m "feat(mobile): add AuthProvider + useAuth hook (keychain-backed)"
```

---

## Task 10: API client singleton

**Files:**
- Create: `mobile/src/lib/api.ts`

- [ ] **Create `mobile/src/lib/api.ts`:**

```ts
import { Platform } from 'react-native'
import { createApiClient } from '@render/api-client'

const DEV_BASE_URL =
  Platform.OS === 'android' ? 'http://10.0.2.2:3001' : 'http://localhost:3001'

const PROD_BASE_URL = 'https://api.renderltd.com'

export const apiClient = createApiClient({
  baseUrl: __DEV__ ? DEV_BASE_URL : PROD_BASE_URL,
  // Phase 1: all calls are unauthenticated (public-only app).
  // Phase 2: wire getToken from AuthContext when auth screens are added.
})

export type { components, paths, operations } from '@render/api-client'
```

- [ ] **Verify import resolves:**

```bash
cd mobile && npx tsc --noEmit 2>&1 | grep api
```

Expected: no errors for `src/lib/api.ts`. The `@render/api-client` alias should resolve.

- [ ] **Commit:**

```bash
git add mobile/src/lib/api.ts
git commit -m "feat(mobile): add apiClient singleton with platform-aware base URL"
```

---

## Task 11: Navigation structure + App.tsx stub screens

**Files:**
- Create: `mobile/src/navigation/types.ts`
- Create: `mobile/src/navigation/HomeStack.tsx`
- Create: `mobile/src/navigation/MapStack.tsx`
- Create: `mobile/src/navigation/DiscoverStack.tsx`
- Create: `mobile/src/navigation/BottomTabNavigator.tsx`
- Create: `mobile/src/navigation/RootNavigator.tsx`
- Create: `mobile/src/screens/Home/HomeScreen.tsx` (stub)
- Create: `mobile/src/screens/FestivalMap/FestivalMapScreen.tsx` (stub)
- Create: `mobile/src/screens/ArtistProfile/ArtistProfileScreen.tsx` (stub)
- Create: `mobile/src/screens/Discover/DiscoverScreen.tsx` (stub)
- Create: `mobile/src/components/LoadingSkeleton.tsx`
- Modify: `mobile/App.tsx`

- [ ] **Create `mobile/src/navigation/types.ts`:**

```ts
import type { StackScreenProps } from '@react-navigation/stack'
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs'
import type { CompositeScreenProps } from '@react-navigation/native'

export type RootTabParamList = {
  Home: undefined
  Map: { festivalSlug?: string }
  Discover: undefined
}

export type HomeStackParamList = {
  HomeScreen: undefined
  ArtistProfile: { profileID: string }
}

export type MapStackParamList = {
  FestivalMap: { festivalSlug?: string }
  ArtistProfile: { profileID: string }
}

export type DiscoverStackParamList = {
  DiscoverScreen: undefined
  ArtistProfile: { profileID: string }
}

export type HomeScreenProps = CompositeScreenProps<
  StackScreenProps<HomeStackParamList, 'HomeScreen'>,
  BottomTabScreenProps<RootTabParamList>
>

export type FestivalMapScreenProps = CompositeScreenProps<
  StackScreenProps<MapStackParamList, 'FestivalMap'>,
  BottomTabScreenProps<RootTabParamList>
>

export type ArtistProfileScreenProps<T extends HomeStackParamList | MapStackParamList | DiscoverStackParamList> =
  StackScreenProps<T, 'ArtistProfile'>

export type DiscoverScreenProps = CompositeScreenProps<
  StackScreenProps<DiscoverStackParamList, 'DiscoverScreen'>,
  BottomTabScreenProps<RootTabParamList>
>
```

- [ ] **Create `mobile/src/navigation/HomeStack.tsx`:**

```tsx
import { createStackNavigator } from '@react-navigation/stack'
import React from 'react'
import { ArtistProfileScreen } from '../screens/ArtistProfile/ArtistProfileScreen'
import { HomeScreen } from '../screens/Home/HomeScreen'
import type { HomeStackParamList } from './types'

const Stack = createStackNavigator<HomeStackParamList>()

export function HomeStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="HomeScreen" component={HomeScreen} options={{ title: 'Render' }} />
      <Stack.Screen name="ArtistProfile" component={ArtistProfileScreen} options={{ title: '' }} />
    </Stack.Navigator>
  )
}
```

- [ ] **Create `mobile/src/navigation/MapStack.tsx`:**

```tsx
import { createStackNavigator } from '@react-navigation/stack'
import React from 'react'
import { ArtistProfileScreen } from '../screens/ArtistProfile/ArtistProfileScreen'
import { FestivalMapScreen } from '../screens/FestivalMap/FestivalMapScreen'
import type { MapStackParamList } from './types'

const Stack = createStackNavigator<MapStackParamList>()

export function MapStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="FestivalMap" component={FestivalMapScreen} options={{ title: 'Map' }} />
      <Stack.Screen name="ArtistProfile" component={ArtistProfileScreen} options={{ title: '' }} />
    </Stack.Navigator>
  )
}
```

- [ ] **Create `mobile/src/navigation/DiscoverStack.tsx`:**

```tsx
import { createStackNavigator } from '@react-navigation/stack'
import React from 'react'
import { ArtistProfileScreen } from '../screens/ArtistProfile/ArtistProfileScreen'
import { DiscoverScreen } from '../screens/Discover/DiscoverScreen'
import type { DiscoverStackParamList } from './types'

const Stack = createStackNavigator<DiscoverStackParamList>()

export function DiscoverStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="DiscoverScreen" component={DiscoverScreen} options={{ title: 'Discover' }} />
      <Stack.Screen name="ArtistProfile" component={ArtistProfileScreen} options={{ title: '' }} />
    </Stack.Navigator>
  )
}
```

- [ ] **Create `mobile/src/navigation/BottomTabNavigator.tsx`:**

```tsx
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import React from 'react'
import { DiscoverStack } from './DiscoverStack'
import { HomeStack } from './HomeStack'
import { MapStack } from './MapStack'
import type { RootTabParamList } from './types'

const Tab = createBottomTabNavigator<RootTabParamList>()

const INK = '#1A1A2E'
const AMBER = '#E8A838'
const MID = '#8A8896'

export function BottomTabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: AMBER,
        tabBarInactiveTintColor: MID,
        tabBarStyle: { backgroundColor: INK },
      }}
    >
      <Tab.Screen name="Home" component={HomeStack} />
      <Tab.Screen name="Map" component={MapStack} />
      <Tab.Screen name="Discover" component={DiscoverStack} />
    </Tab.Navigator>
  )
}
```

- [ ] **Create `mobile/src/navigation/RootNavigator.tsx`:**

```tsx
import { NavigationContainer } from '@react-navigation/native'
import React from 'react'
import { BottomTabNavigator } from './BottomTabNavigator'

const linking = {
  prefixes: ['render://'],
  config: {
    screens: {
      Home: {
        screens: { HomeScreen: '', ArtistProfile: 'artists/:profileID' },
      },
      Map: {
        screens: {
          FestivalMap: 'festivals/:festivalSlug/map',
          ArtistProfile: 'artists/:profileID',
        },
      },
      Discover: {
        screens: { DiscoverScreen: 'discover', ArtistProfile: 'artists/:profileID' },
      },
    },
  },
}

export function RootNavigator() {
  return (
    <NavigationContainer linking={linking}>
      <BottomTabNavigator />
    </NavigationContainer>
  )
}
```

- [ ] **Create stub screen files.** These will be replaced by Tasks 12–15 but are needed for the navigation to compile now:

`mobile/src/screens/Home/HomeScreen.tsx`:
```tsx
import React from 'react'
import { Text, View } from 'react-native'
export function HomeScreen() {
  return <View testID="home-screen"><Text>Home</Text></View>
}
```

`mobile/src/screens/FestivalMap/FestivalMapScreen.tsx`:
```tsx
import React from 'react'
import { Text, View } from 'react-native'
export function FestivalMapScreen() {
  return <View testID="festival-map-screen"><Text>Map</Text></View>
}
```

`mobile/src/screens/ArtistProfile/ArtistProfileScreen.tsx`:
```tsx
import React from 'react'
import { Text, View } from 'react-native'
export function ArtistProfileScreen() {
  return <View testID="artist-profile-screen"><Text>Artist Profile</Text></View>
}
```

`mobile/src/screens/Discover/DiscoverScreen.tsx`:
```tsx
import React from 'react'
import { Text, View } from 'react-native'
export function DiscoverScreen() {
  return <View testID="discover-screen"><Text>Discover</Text></View>
}
```

- [ ] **Create `mobile/src/components/LoadingSkeleton.tsx`:**

```tsx
import React from 'react'
import { StyleSheet, View } from 'react-native'

interface Props {
  height?: number
  width?: string | number
  borderRadius?: number
}

export function LoadingSkeleton({ height = 80, width = '100%', borderRadius = 8 }: Props) {
  return <View style={[styles.base, { height, width: width as any, borderRadius }]} />
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: '#E2DDD6',
    opacity: 0.6,
    marginVertical: 4,
  },
})
```

- [ ] **Replace `mobile/App.tsx`:**

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { AuthProvider } from './src/lib/auth'
import { RootNavigator } from './src/navigation/RootNavigator'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
})

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <QueryClientProvider client={queryClient}>
            <RootNavigator />
          </QueryClientProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
```

- [ ] **Run typecheck:**

```bash
cd mobile && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Run lint:**

```bash
cd mobile && npm run lint -- --max-warnings 0 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Run tests:**

```bash
cd mobile && npm test 2>&1 | tail -5
```

Expected: passes (no test files yet).

- [ ] **Commit:**

```bash
git add mobile/src/ mobile/App.tsx
git commit -m "feat(mobile): add React Navigation structure + stub screens + QueryClient"
```

---

> **PARALLELISM GATE:** Tasks 12–15 below are independent of each other and can run simultaneously. Each task replaces one stub screen file. They must NOT run before Task 11 is committed. A subagent-driven-development executor should dispatch all four in parallel after Task 11 merges.

---

## Task 12: Home screen

**Files:**
- Create: `mobile/src/components/FestivalCard.tsx`
- Replace: `mobile/src/screens/Home/HomeScreen.tsx`
- Test: `mobile/src/screens/Home/__tests__/HomeScreen.test.tsx`

- [ ] **Write the failing test** at `mobile/src/screens/Home/__tests__/HomeScreen.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react-native'
import React from 'react'
import { HomeScreen } from '../HomeScreen'

// Mock the API client
jest.mock('../../../lib/api', () => ({
  apiClient: {
    GET: jest.fn().mockResolvedValue({
      data: [
        {
          id: 'abc',
          name: 'Summer Walls',
          slug: 'summer-walls-2027',
          status: 'live',
          location_label: 'Bristol',
          start_date: '2027-06-01',
          end_date: '2027-06-07',
          description: '',
          organiser_id: 'org-1',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
      error: undefined,
    }),
  },
}))

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn() }),
}))

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('HomeScreen', () => {
  it('renders without crashing', async () => {
    render(<HomeScreen />, { wrapper: Wrapper })
    expect(await screen.findByTestId('home-screen')).toBeTruthy()
  })

  it('shows festival name after data loads', async () => {
    render(<HomeScreen />, { wrapper: Wrapper })
    expect(await screen.findByText('Summer Walls')).toBeTruthy()
  })
})
```

- [ ] **Run to confirm failure:**

```bash
cd mobile && npm test -- --testPathPattern HomeScreen --passWithNoTests 2>&1 | tail -10
```

Expected: FAIL — stub `HomeScreen` doesn't show 'Summer Walls'.

- [ ] **Create `mobile/src/components/FestivalCard.tsx`:**

```tsx
import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import type { components } from '../lib/api'

type Festival = components['schemas']['Festival']

interface Props {
  festival: Festival
  onPress: () => void
}

export function FestivalCard({ festival, onPress }: Props) {
  const dateRange =
    festival.start_date && festival.end_date
      ? `${festival.start_date} – ${festival.end_date}`
      : festival.start_date ?? ''

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.8}>
      <View style={styles.header}>
        <Text style={styles.name}>{festival.name}</Text>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{festival.status}</Text>
        </View>
      </View>
      {festival.location_label ? (
        <Text style={styles.location}>{festival.location_label}</Text>
      ) : null}
      {dateRange ? <Text style={styles.dates}>{dateRange}</Text> : null}
    </TouchableOpacity>
  )
}

const OFFWHITE = '#FAF7F2'
const INK = '#1A1A2E'
const AMBER = '#E8A838'
const MID = '#8A8896'
const LIGHT = '#E2DDD6'

const styles = StyleSheet.create({
  card: {
    backgroundColor: OFFWHITE,
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    marginVertical: 8,
    borderWidth: 1,
    borderColor: LIGHT,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  name: { flex: 1, fontSize: 18, fontWeight: '600', color: INK, marginRight: 8 },
  badge: {
    backgroundColor: AMBER,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: { fontSize: 11, fontWeight: '700', color: INK, textTransform: 'uppercase' },
  location: { color: MID, marginTop: 4, fontSize: 14 },
  dates: { color: MID, marginTop: 2, fontSize: 13 },
})
```

- [ ] **Replace `mobile/src/screens/Home/HomeScreen.tsx`:**

```tsx
import { useQuery } from '@tanstack/react-query'
import { useNavigation } from '@react-navigation/native'
import React from 'react'
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { apiClient } from '../../lib/api'
import { FestivalCard } from '../../components/FestivalCard'
import { LoadingSkeleton } from '../../components/LoadingSkeleton'
import type { HomeScreenProps } from '../../navigation/types'
import type { components } from '../../lib/api'

type Festival = components['schemas']['Festival']

export function HomeScreen(_props: Partial<HomeScreenProps>) {
  const navigation = useNavigation<HomeScreenProps['navigation']>()

  const { data: festivals, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['public-festivals'],
    queryFn: async () => {
      const { data, error } = await apiClient.GET('/public/festivals', {
        params: { query: { status: 'live' } },
      })
      if (error) throw new Error('Failed to load festivals')
      return data as Festival[]
    },
  })

  if (isLoading) {
    return (
      <View style={styles.container} testID="home-screen">
        {[1, 2, 3].map((n) => (
          <LoadingSkeleton key={n} height={100} />
        ))}
      </View>
    )
  }

  if (isError) {
    return (
      <View style={styles.center} testID="home-screen">
        <Text style={styles.errorText}>Couldn't load festivals</Text>
        <Text style={styles.retryLink} onPress={() => refetch()}>
          Try again
        </Text>
      </View>
    )
  }

  return (
    <FlatList
      testID="home-screen"
      data={festivals}
      keyExtractor={(f) => f.id}
      renderItem={({ item }) => (
        <FestivalCard
          festival={item}
          onPress={() =>
            navigation.navigate('Map', { festivalSlug: item.slug })
          }
        />
      )}
      refreshControl={
        <RefreshControl refreshing={isFetching} onRefresh={refetch} />
      }
      contentContainerStyle={styles.list}
      ListEmptyComponent={
        <View style={styles.center}>
          <Text style={styles.emptyText}>No live festivals right now — check back soon</Text>
        </View>
      }
    />
  )
}

const OFFWHITE = '#FAF7F2'
const INK = '#1A1A2E'
const MID = '#8A8896'
const AMBER = '#E8A838'

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: OFFWHITE, padding: 16 },
  list: { paddingVertical: 8, backgroundColor: OFFWHITE, flexGrow: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  errorText: { color: INK, fontSize: 16, marginBottom: 8 },
  retryLink: { color: AMBER, fontSize: 14, textDecorationLine: 'underline' },
  emptyText: { color: MID, fontSize: 15, textAlign: 'center' },
})
```

- [ ] **Run tests to confirm pass:**

```bash
cd mobile && npm test -- --testPathPattern HomeScreen 2>&1 | tail -10
```

Expected: 2 tests pass.

- [ ] **Run typecheck:**

```bash
cd mobile && npx tsc --noEmit 2>&1 | grep -E "Home|FestivalCard"
```

Expected: no errors.

- [ ] **Commit:**

```bash
git add mobile/src/screens/Home/ mobile/src/components/FestivalCard.tsx
git commit -m "feat(mobile): implement Home screen with live festival listing"
```

---

## Task 13: FestivalMap screen + Leaflet HTML

**Files:**
- Replace: `mobile/src/screens/FestivalMap/FestivalMapScreen.tsx`
- Create: `mobile/src/assets/mapHtml.ts` (HTML as a TS string — avoids Metro HTML bundling config)
- Test: `mobile/src/screens/FestivalMap/__tests__/FestivalMapScreen.test.tsx`

- [ ] **Write the failing test** at `mobile/src/screens/FestivalMap/__tests__/FestivalMapScreen.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react-native'
import React from 'react'
import { FestivalMapScreen } from '../FestivalMapScreen'

jest.mock('../../../lib/api', () => ({
  apiClient: {
    GET: jest.fn().mockResolvedValue({
      data: { pins: [] },
      error: undefined,
    }),
  },
}))

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn() }),
  useRoute: () => ({ params: { festivalSlug: 'summer-walls-2027' } }),
}))

jest.mock('react-native-webview', () => {
  const { View } = require('react-native')
  return { WebView: (props: any) => <View testID="webview" {...props} /> }
})

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('FestivalMapScreen', () => {
  it('renders without crashing', () => {
    render(<FestivalMapScreen />, { wrapper: Wrapper })
    expect(screen.getByTestId('festival-map-screen')).toBeTruthy()
  })

  it('renders the WebView', () => {
    render(<FestivalMapScreen />, { wrapper: Wrapper })
    expect(screen.getByTestId('webview')).toBeTruthy()
  })
})
```

- [ ] **Run to confirm failure:**

```bash
cd mobile && npm test -- --testPathPattern FestivalMap 2>&1 | tail -10
```

Expected: FAIL — stub doesn't contain WebView.

- [ ] **Create `mobile/src/assets/mapHtml.ts`** (exporting the Leaflet HTML as a string avoids Metro HTML asset config):

```ts
// Exported as a TS string so WebView can use source={{ html: MAP_HTML }}.
// Leaflet loaded from CDN; requires network access.
export const MAP_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <title>Festival Map</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body, #map { width: 100%; height: 100%; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    var INK = '#1A1A2E';
    var AMBER = '#E8A838';
    var map = L.map('map', { zoomControl: true }).setView([51.9000, -2.0800], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '\\u00a9 OpenStreetMap contributors'
    }).addTo(map);
    var markers = [];
    function clearMarkers() { markers.forEach(function(m) { map.removeLayer(m); }); markers = []; }
    function addPins(pins) {
      clearMarkers();
      pins.forEach(function(pin) {
        if (!pin.lat || !pin.lng) return;
        var marker = L.circleMarker([pin.lat, pin.lng], {
          radius: 10, fillColor: AMBER, color: INK, weight: 2, opacity: 1, fillOpacity: 0.9
        }).addTo(map);
        marker.bindPopup('<b style="color:' + INK + '">' + (pin.name || 'Artist') + '<\\/b>');
        marker.on('click', function() {
          var msg = JSON.stringify({ type: 'ARTIST_TAPPED', profileID: pin.artist_id });
          if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(msg);
        });
        markers.push(marker);
      });
    }
    function handleMessage(event) {
      try {
        var msg = JSON.parse(event.data || event);
        if (msg.type === 'SET_PINS') addPins(msg.pins || []);
        else if (msg.type === 'SET_CENTER') map.setView([msg.lat, msg.lng], msg.zoom || 14);
      } catch (e) {}
    }
    window.addEventListener('message', handleMessage);
    document.addEventListener('message', handleMessage);
  <\/script>
</body>
</html>`
```

- [ ] **Replace `mobile/src/screens/FestivalMap/FestivalMapScreen.tsx`:**

```tsx
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import { useQuery } from '@tanstack/react-query'
import React, { useCallback, useRef } from 'react'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import WebView, { type WebViewMessageEvent } from 'react-native-webview'
import { MAP_HTML } from '../../assets/mapHtml'
import { apiClient } from '../../lib/api'
import type { FestivalMapScreenProps, MapStackParamList } from '../../navigation/types'

type MapRoute = RouteProp<MapStackParamList, 'FestivalMap'>

export function FestivalMapScreen() {
  const navigation = useNavigation<FestivalMapScreenProps['navigation']>()
  const route = useRoute<MapRoute>()
  const festivalSlug = route.params?.festivalSlug
  const webViewRef = useRef<WebView>(null)

  const { data: mapData } = useQuery({
    queryKey: ['festival-map', festivalSlug],
    queryFn: async () => {
      if (!festivalSlug) return { pins: [] }
      const { data, error } = await apiClient.GET('/festivals/slug/{slug}/map', {
        params: { path: { slug: festivalSlug } },
      })
      if (error) return { pins: [] }
      return data
    },
    enabled: !!festivalSlug,
  })

  const onWebViewLoad = useCallback(() => {
    if (!webViewRef.current || !mapData?.pins) return
    webViewRef.current.postMessage(
      JSON.stringify({ type: 'SET_PINS', pins: mapData.pins }),
    )
  }, [mapData])

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      try {
        const msg = JSON.parse(event.nativeEvent.data)
        if (msg.type === 'ARTIST_TAPPED' && msg.profileID) {
          navigation.navigate('ArtistProfile', { profileID: msg.profileID })
        }
      } catch {}
    },
    [navigation],
  )

  return (
    <View style={styles.container} testID="festival-map-screen">
      <WebView
        testID="webview"
        ref={webViewRef}
        source={{ html: MAP_HTML }}
        onLoadEnd={onWebViewLoad}
        onMessage={onMessage}
        style={styles.webview}
        originWhitelist={['*']}
      />
      {!mapData && (
        <View style={styles.loadingOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color="#E8A838" />
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  webview: { flex: 1 },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(250,247,242,0.7)',
  },
})
```

- [ ] **Run tests:**

```bash
cd mobile && npm test -- --testPathPattern FestivalMap 2>&1 | tail -10
```

Expected: 2 tests pass.

- [ ] **Commit:**

```bash
git add mobile/src/screens/FestivalMap/ mobile/src/assets/map.html
git commit -m "feat(mobile): implement FestivalMap screen with WebView + Leaflet"
```

---

## Task 14: ArtistProfile screen + deep link platform config

**Files:**
- Create: `mobile/src/components/ArtistCard.tsx`
- Replace: `mobile/src/screens/ArtistProfile/ArtistProfileScreen.tsx`
- Modify: `mobile/ios/RenderMobile/Info.plist`
- Modify: `mobile/android/app/src/main/AndroidManifest.xml`
- Test: `mobile/src/screens/ArtistProfile/__tests__/ArtistProfileScreen.test.tsx`

- [ ] **Write the failing test** at `mobile/src/screens/ArtistProfile/__tests__/ArtistProfileScreen.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react-native'
import React from 'react'
import { ArtistProfileScreen } from '../ArtistProfileScreen'

const mockProfile = {
  id: 'profile-1',
  user_id: 'user-1',
  display_name: 'Elena Vasquez',
  bio: 'Muralist based in Bristol',
  medium_tags: ['acrylic', 'paste-up'],
  social_links: {},
  avatar_s3_key: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}

const mockCollections = [
  { id: 'col-1', artist_profile_id: 'profile-1', name: 'Street Series', description: '', status: 'published', display_order: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
]

jest.mock('../../../lib/api', () => ({
  apiClient: {
    GET: jest.fn().mockImplementation(({ params }: any) => {
      if (params?.path?.profileID === 'profile-1') {
        return Promise.resolve({ data: mockProfile, error: undefined })
      }
      return Promise.resolve({ data: mockCollections, error: undefined })
    }),
  },
}))

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn() }),
  useRoute: () => ({ params: { profileID: 'profile-1' } }),
}))

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('ArtistProfileScreen', () => {
  it('renders without crashing', () => {
    render(<ArtistProfileScreen />, { wrapper: Wrapper })
    expect(screen.getByTestId('artist-profile-screen')).toBeTruthy()
  })

  it('shows artist name after data loads', async () => {
    render(<ArtistProfileScreen />, { wrapper: Wrapper })
    expect(await screen.findByText('Elena Vasquez')).toBeTruthy()
  })
})
```

- [ ] **Run to confirm failure:**

```bash
cd mobile && npm test -- --testPathPattern ArtistProfile 2>&1 | tail -10
```

Expected: FAIL.

- [ ] **Create `mobile/src/components/ArtistCard.tsx`:**

```tsx
import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import type { components } from '../lib/api'

type Profile = components['schemas']['ArtistProfile']

interface Props {
  profile: Profile
  onPress: () => void
  distanceLabel?: string
}

export function ArtistCard({ profile, onPress, distanceLabel }: Props) {
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.8}>
      <View style={styles.row}>
        <View style={styles.avatar} />
        <View style={styles.info}>
          <Text style={styles.name}>{profile.display_name}</Text>
          {profile.location_label ? (
            <Text style={styles.meta}>{profile.location_label}</Text>
          ) : null}
          {distanceLabel ? <Text style={styles.distance}>{distanceLabel}</Text> : null}
        </View>
      </View>
      {profile.medium_tags && profile.medium_tags.length > 0 && (
        <View style={styles.tags}>
          {profile.medium_tags.slice(0, 4).map((tag) => (
            <View key={tag} style={styles.tag}>
              <Text style={styles.tagText}>{tag}</Text>
            </View>
          ))}
        </View>
      )}
    </TouchableOpacity>
  )
}

const OFFWHITE = '#FAF7F2'
const INK = '#1A1A2E'
const AMBER = '#E8A838'
const MID = '#8A8896'
const LIGHT = '#E2DDD6'
const WARM = '#F0EAE0'

const styles = StyleSheet.create({
  card: {
    backgroundColor: OFFWHITE,
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 16,
    marginVertical: 6,
    borderWidth: 1,
    borderColor: LIGHT,
  },
  row: { flexDirection: 'row', alignItems: 'center' },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: WARM,
    marginRight: 12,
  },
  info: { flex: 1 },
  name: { fontSize: 16, fontWeight: '600', color: INK },
  meta: { color: MID, fontSize: 13, marginTop: 2 },
  distance: { color: AMBER, fontSize: 12, marginTop: 1 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8, gap: 4 },
  tag: { backgroundColor: WARM, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  tagText: { fontSize: 11, color: INK },
})
```

- [ ] **Replace `mobile/src/screens/ArtistProfile/ArtistProfileScreen.tsx`:**

```tsx
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import { useQuery } from '@tanstack/react-query'
import React from 'react'
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { apiClient } from '../../lib/api'

// Works regardless of which stack this screen appears in (Home, Map, or Discover).
type ArtistProfileRoute = RouteProp<{ ArtistProfile: { profileID: string } }, 'ArtistProfile'>

export function ArtistProfileScreen() {
  const route = useRoute<ArtistProfileRoute>()
  const { profileID } = route.params

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ['profile', profileID],
    queryFn: async () => {
      const { data, error } = await apiClient.GET('/profiles/{profileID}', {
        params: { path: { profileID } },
      })
      if (error) throw new Error('Not found')
      return data
    },
  })

  const { data: collections } = useQuery({
    queryKey: ['collections', profileID],
    queryFn: async () => {
      const { data, error } = await apiClient.GET('/profiles/{profileID}/collections', {
        params: { path: { profileID } },
      })
      if (error) return []
      return data
    },
    enabled: !!profile,
  })

  if (profileLoading || !profile) {
    return (
      <View style={styles.center} testID="artist-profile-screen">
        <ActivityIndicator size="large" color="#E8A838" />
      </View>
    )
  }

  return (
    <ScrollView
      testID="artist-profile-screen"
      style={styles.container}
      contentContainerStyle={styles.content}
    >
      <Text style={styles.name}>{profile.display_name}</Text>
      {profile.location_label ? (
        <Text style={styles.location}>{profile.location_label}</Text>
      ) : null}
      {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}

      {profile.medium_tags && profile.medium_tags.length > 0 && (
        <View style={styles.tags}>
          {profile.medium_tags.map((tag) => (
            <View key={tag} style={styles.tag}>
              <Text style={styles.tagText}>{tag}</Text>
            </View>
          ))}
        </View>
      )}

      {collections && collections.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Collections</Text>
          {collections.map((col) => (
            <View key={col.id} style={styles.collectionCard}>
              <Text style={styles.collectionName}>{col.name}</Text>
              {col.description ? (
                <Text style={styles.collectionDesc}>{col.description}</Text>
              ) : null}
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  )
}

const OFFWHITE = '#FAF7F2'
const INK = '#1A1A2E'
const AMBER = '#E8A838'
const MID = '#8A8896'
const LIGHT = '#E2DDD6'
const WARM = '#F0EAE0'

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: OFFWHITE },
  content: { padding: 20 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  name: { fontSize: 28, fontWeight: '700', color: INK, marginBottom: 4 },
  location: { color: MID, fontSize: 14, marginBottom: 8 },
  bio: { color: INK, fontSize: 15, lineHeight: 22, marginBottom: 12 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 16 },
  tag: { backgroundColor: WARM, borderRadius: 4, paddingHorizontal: 8, paddingVertical: 3 },
  tagText: { fontSize: 12, color: INK },
  section: { marginTop: 16 },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: INK, marginBottom: 10 },
  collectionCard: {
    backgroundColor: WARM,
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: LIGHT,
  },
  collectionName: { fontSize: 15, fontWeight: '600', color: INK },
  collectionDesc: { color: MID, fontSize: 13, marginTop: 3 },
})
```

- [ ] **Add deep link scheme to iOS.** Open `mobile/ios/RenderMobile/Info.plist`. Find the `<dict>` root element and add inside it (before the closing `</dict>`):

```xml
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLName</key>
    <string>com.renderltd.mobile</string>
    <key>CFBundleURLSchemes</key>
    <array>
      <string>render</string>
    </array>
  </dict>
</array>
```

- [ ] **Add deep link intent filter to Android.** Open `mobile/android/app/src/main/AndroidManifest.xml`. Inside the `<activity>` element that has `android:name=".MainActivity"`, add a new `<intent-filter>` block:

```xml
<intent-filter>
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="render" />
</intent-filter>
```

- [ ] **Run tests:**

```bash
cd mobile && npm test -- --testPathPattern ArtistProfile 2>&1 | tail -10
```

Expected: 2 tests pass.

- [ ] **Commit:**

```bash
git add mobile/src/screens/ArtistProfile/ mobile/src/components/ArtistCard.tsx \
        mobile/ios/ mobile/android/
git commit -m "feat(mobile): implement ArtistProfile screen + deep link config"
```

---

## Task 15: Discover screen + location helper

**Files:**
- Create: `mobile/src/lib/location.ts`
- Replace: `mobile/src/screens/Discover/DiscoverScreen.tsx`
- Test: `mobile/src/screens/Discover/__tests__/DiscoverScreen.test.tsx`

- [ ] **Create `mobile/src/lib/location.ts`:**

```ts
import { PermissionsAndroid, Platform } from 'react-native'
import Geolocation from '@react-native-community/geolocation'

export interface Coords {
  lat: number
  lng: number
}

export async function requestLocationPermission(): Promise<boolean> {
  if (Platform.OS === 'ios') {
    return new Promise((resolve) => {
      Geolocation.requestAuthorization()
      // iOS doesn't give a synchronous result; we resolve optimistically
      // and getCurrentPosition will fail if denied.
      resolve(true)
    })
  }

  const result = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    {
      title: 'Location Access',
      message: 'Render needs your location to show nearby artists.',
      buttonPositive: 'Allow',
      buttonNegative: 'Deny',
    },
  )
  return result === PermissionsAndroid.RESULTS.GRANTED
}

export function getCurrentPosition(): Promise<Coords> {
  return new Promise((resolve, reject) => {
    Geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(new Error(err.message)),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    )
  })
}

export function distanceKm(a: Coords, b: Coords): number {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const sinLat = Math.sin(dLat / 2)
  const sinLng = Math.sin(dLng / 2)
  const c =
    2 *
    Math.atan2(
      Math.sqrt(sinLat * sinLat + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * sinLng * sinLng),
      Math.sqrt(1 - sinLat * sinLat - Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * sinLng * sinLng),
    )
  return R * c
}
```

- [ ] **Write the failing test** at `mobile/src/screens/Discover/__tests__/DiscoverScreen.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react-native'
import React from 'react'
import { DiscoverScreen } from '../DiscoverScreen'

jest.mock('../../../lib/api', () => ({
  apiClient: {
    GET: jest.fn().mockResolvedValue({
      data: {
        profiles: [
          {
            id: 'p1',
            user_id: 'u1',
            display_name: 'Rosa Mendez',
            bio: '',
            medium_tags: ['spray'],
            social_links: {},
            avatar_s3_key: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
        total: 1,
        page: 1,
        per_page: 20,
      },
      error: undefined,
    }),
  },
}))

jest.mock('../../../lib/location', () => ({
  requestLocationPermission: jest.fn().mockResolvedValue(false),
  getCurrentPosition: jest.fn(),
  distanceKm: jest.fn().mockReturnValue(1.5),
}))

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn() }),
}))

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('DiscoverScreen', () => {
  it('renders without crashing', () => {
    render(<DiscoverScreen />, { wrapper: Wrapper })
    expect(screen.getByTestId('discover-screen')).toBeTruthy()
  })

  it('shows artist name in Random mode', async () => {
    render(<DiscoverScreen />, { wrapper: Wrapper })
    expect(await screen.findByText('Rosa Mendez')).toBeTruthy()
  })
})
```

- [ ] **Run to confirm failure:**

```bash
cd mobile && npm test -- --testPathPattern DiscoverScreen 2>&1 | tail -10
```

Expected: FAIL.

- [ ] **Replace `mobile/src/screens/Discover/DiscoverScreen.tsx`:**

```tsx
import { useNavigation } from '@react-navigation/native'
import { useQuery } from '@tanstack/react-query'
import React, { useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Linking,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { ArtistCard } from '../../components/ArtistCard'
import { LoadingSkeleton } from '../../components/LoadingSkeleton'
import { apiClient } from '../../lib/api'
import { distanceKm, getCurrentPosition, requestLocationPermission } from '../../lib/location'
import type { DiscoverScreenProps } from '../../navigation/types'
import type { components } from '../../lib/api'

type Profile = components['schemas']['ArtistProfile']
type Mode = 'random' | 'nearby'

interface NearbyResult {
  profile: Profile
  distanceKm: number
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function DiscoverScreen(_props: Partial<DiscoverScreenProps>) {
  const navigation = useNavigation<DiscoverScreenProps['navigation']>()
  const [mode, setMode] = useState<Mode>('random')
  const [locationDenied, setLocationDenied] = useState(false)
  const [nearbyResults, setNearbyResults] = useState<NearbyResult[] | null>(null)
  const [nearbyLoading, setNearbyLoading] = useState(false)

  const {
    data: randomProfiles,
    isLoading: randomLoading,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['public-profiles-random'],
    queryFn: async () => {
      const { data, error } = await apiClient.GET('/public/profiles', {
        params: { query: { page: 1, per_page: 50 } },
      })
      if (error) throw new Error('Failed to load profiles')
      return shuffle((data as any).profiles as Profile[])
    },
  })

  async function loadNearby() {
    setNearbyLoading(true)
    setLocationDenied(false)
    try {
      const granted = await requestLocationPermission()
      if (!granted) {
        setLocationDenied(true)
        return
      }
      const userCoords = await getCurrentPosition()

      const { data: festivalsData } = await apiClient.GET('/public/festivals', {
        params: { query: { status: 'live' } },
      })
      const festivals = (festivalsData as any) ?? []

      const pinMap = new Map<string, { profile_id: string; lat: number; lng: number }>()
      await Promise.all(
        festivals.map(async (fest: any) => {
          const { data: mapData } = await apiClient.GET('/festivals/slug/{slug}/map', {
            params: { path: { slug: fest.slug } },
          })
          const pins = (mapData as any)?.pins ?? []
          for (const pin of pins) {
            if (pin.artist_id && pin.lat && pin.lng) {
              pinMap.set(pin.artist_id, { profile_id: pin.artist_id, lat: pin.lat, lng: pin.lng })
            }
          }
        }),
      )

      const results: NearbyResult[] = []
      for (const [profileID, pin] of pinMap.entries()) {
        const { data: profile } = await apiClient.GET('/profiles/{profileID}', {
          params: { path: { profileID } },
        })
        if (profile) {
          results.push({
            profile: profile as Profile,
            distanceKm: distanceKm(userCoords, { lat: pin.lat, lng: pin.lng }),
          })
        }
      }

      results.sort((a, b) => a.distanceKm - b.distanceKm)
      setNearbyResults(results)
    } finally {
      setNearbyLoading(false)
    }
  }

  function onModeSwitch(newMode: Mode) {
    setMode(newMode)
    if (newMode === 'nearby' && nearbyResults === null) {
      loadNearby()
    }
  }

  const isLoading = mode === 'random' ? randomLoading : nearbyLoading

  return (
    <View style={styles.container} testID="discover-screen">
      <View style={styles.segmentRow}>
        {(['random', 'nearby'] as Mode[]).map((m) => (
          <TouchableOpacity
            key={m}
            style={[styles.segment, mode === m && styles.segmentActive]}
            onPress={() => onModeSwitch(m)}
          >
            <Text style={[styles.segmentText, mode === m && styles.segmentTextActive]}>
              {m === 'random' ? 'Random' : 'Nearby'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {isLoading && (
        <View style={styles.skeletons}>
          {[1, 2, 3].map((n) => (
            <LoadingSkeleton key={n} height={80} />
          ))}
        </View>
      )}

      {mode === 'nearby' && locationDenied && (
        <View style={styles.center}>
          <Text style={styles.bodyText}>Location access needed to find nearby artists.</Text>
          <TouchableOpacity onPress={() => Linking.openSettings()}>
            <Text style={styles.link}>Open Settings</Text>
          </TouchableOpacity>
        </View>
      )}

      {mode === 'random' && !randomLoading && (
        <FlatList
          data={randomProfiles ?? []}
          keyExtractor={(p) => p.id}
          renderItem={({ item }) => (
            <ArtistCard
              profile={item}
              onPress={() => navigation.navigate('ArtistProfile', { profileID: item.id })}
            />
          )}
          refreshControl={<RefreshControl refreshing={isFetching} onRefresh={refetch} />}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.bodyText}>No artists found.</Text>
            </View>
          }
        />
      )}

      {mode === 'nearby' && !nearbyLoading && !locationDenied && nearbyResults !== null && (
        <FlatList
          data={nearbyResults}
          keyExtractor={(r) => r.profile.id}
          renderItem={({ item }) => (
            <ArtistCard
              profile={item.profile}
              distanceLabel={`${item.distanceKm.toFixed(1)} km`}
              onPress={() =>
                navigation.navigate('ArtistProfile', { profileID: item.profile.id })
              }
            />
          )}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.bodyText}>No artists found nearby.</Text>
            </View>
          }
        />
      )}
    </View>
  )
}

const OFFWHITE = '#FAF7F2'
const INK = '#1A1A2E'
const AMBER = '#E8A838'
const MID = '#8A8896'
const LIGHT = '#E2DDD6'
const WARM = '#F0EAE0'

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: OFFWHITE },
  segmentRow: {
    flexDirection: 'row',
    margin: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: LIGHT,
    overflow: 'hidden',
  },
  segment: { flex: 1, paddingVertical: 10, alignItems: 'center', backgroundColor: WARM },
  segmentActive: { backgroundColor: INK },
  segmentText: { color: MID, fontWeight: '600' },
  segmentTextActive: { color: AMBER },
  skeletons: { padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  bodyText: { color: INK, fontSize: 15, textAlign: 'center', marginBottom: 12 },
  link: { color: AMBER, fontSize: 14, textDecorationLine: 'underline' },
})
```

- [ ] **Run tests:**

```bash
cd mobile && npm test -- --testPathPattern DiscoverScreen 2>&1 | tail -10
```

Expected: 2 tests pass.

- [ ] **Commit:**

```bash
git add mobile/src/screens/Discover/ mobile/src/lib/location.ts
git commit -m "feat(mobile): implement Discover screen (Random + Nearby modes)"
```

---

> **SYNC POINT:** Tasks 12–15 must all be merged before continuing to Task 16.

---

## Task 16: Smoke tests — verify all four screens

**Files:**
- All four test files already written in Tasks 12–15.

This task runs the full test suite to confirm all four smoke tests pass together with no regressions from parallel merges.

- [ ] **Run the full mobile test suite:**

```bash
cd mobile && npm test 2>&1
```

Expected output contains:
```
Test Suites: 4 passed, 4 total
Tests:       8 passed, 8 total
```

- [ ] **Run full lint:**

```bash
cd mobile && npm run lint -- --max-warnings 0 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Run typecheck:**

```bash
cd mobile && npx tsc --noEmit 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Run project-wide API tests to confirm no regressions:**

```bash
task api:test:unit 2>&1 | tail -10
```

Expected: all `ok`.

- [ ] **Commit if any fixes were needed from parallel-merge conflicts:**

```bash
git add -p  # stage only the specific fixes
git commit -m "fix(mobile): resolve merge conflicts from parallel screen tasks"
```

---

## Task 17: Taskfile verify + GitHub issue cleanup

- [ ] **Verify `task mobile:lint` works from repo root:**

```bash
task mobile:lint
```

Expected: passes.

- [ ] **Verify `task mobile:test` works from repo root:**

```bash
task mobile:test
```

Expected: 8 tests pass.

- [ ] **Verify `task lint` passes project-wide:**

```bash
task api:lint 2>&1 | tail -5
```

Expected: passes (web lint may fail if E7 not implemented — that's OK, only api + mobile are in scope here).

- [ ] **Close all sub-issues and remove blocked labels.** Run each command:

```bash
gh issue close 61 --repo sniffins-mcmuggins/murals --comment "Implemented in E8 React Native app."
gh issue close 62 --repo sniffins-mcmuggins/murals --comment "Implemented in E8 React Native app."
gh issue close 63 --repo sniffins-mcmuggins/murals --comment "Implemented in E8 React Native app."
gh issue close 64 --repo sniffins-mcmuggins/murals --comment "Implemented in E8 React Native app."
gh issue close 65 --repo sniffins-mcmuggins/murals --comment "Implemented in E8 React Native app."
gh issue close 66 --repo sniffins-mcmuggins/murals --comment "Implemented in E8 React Native app."
gh issue close 67 --repo sniffins-mcmuggins/murals --comment "Implemented in E8 React Native app."
gh issue close 68 --repo sniffins-mcmuggins/murals --comment "Implemented in E8 React Native app."
gh issue close 69 --repo sniffins-mcmuggins/murals --comment "Implemented in E8 React Native app."
```

- [ ] **Remove `blocked` label from epic #8 and close it:**

```bash
gh issue edit 8 --repo sniffins-mcmuggins/murals --remove-label "blocked"
gh issue close 8 --repo sniffins-mcmuggins/murals --comment "All sub-issues implemented. E8 complete."
```

- [ ] **Final commit:**

```bash
git add .
git commit -m "chore(mobile): E8 complete — all sub-issues implemented and closed"
```
