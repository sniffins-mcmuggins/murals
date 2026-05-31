# E15.5 — Publish Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate the draft→public profile transition on the artist having an active paid subscription OR an active access grant (comp), returning 402 with a clear code when neither is present.

**Architecture:** The `access_grants` table, `CreateAccessGrant` query, and `POST /admin/users/{userID}/grants` endpoint already exist and handle admin-issued comps. What's missing is the publish gate itself. A new `CanPublish` function in the `billing` package checks both subscriptions and access grants in one call. `UpdateProfileHandler` in the `artist` package calls `CanPublish` when the request transitions a profile from `draft` to `public`, returning 402 when the artist lacks entitlement. Already-public profiles are not silently un-published (per product spec). The admin grant endpoint (`POST /admin/users/{userID}/grants` with `plan: "artist_basic"`) is the comp-grant mechanism — no new endpoint needed.

**Tech Stack:** Go, pgx/pgxpool, sqlc, testify (unit tests), Vitest + pg (e2e tests)

---

## Background: what already exists

Before writing any code, confirm these are present:

```bash
grep "CreateGrantHandler\|/grants" api/cmd/api/main.go
grep "HasActiveGrant\|CreateAccessGrant" api/internal/sqlcdb/admin.sql.go | head -5
grep "access_grants" db/migrations/000006_admin.up.sql
```

Expected:
- `r.Post("/users/{userID}/grants", admin.CreateGrantHandler(pool))` in main.go
- Both `HasActiveGrant` and `CreateAccessGrant` in sqlcdb
- `CREATE TABLE access_grants` in migration 000006

If any of these are missing, stop and investigate before continuing.

---

## File map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `api/internal/billing/entitlement.go` | `CanPublish` helper |
| Create | `api/internal/billing/entitlement_test.go` | Unit tests for CanPublish |
| Modify | `api/internal/artist/profile.go` | Wire publish gate into UpdateProfileHandler |
| Modify | `api/internal/artist/profile_test.go` | Unit tests for gated publish |
| Create | `e2e/api/publish-gate.test.ts` | E2e API tests |

---

### Task 1: CanPublish entitlement helper

**Files:**
- Create: `api/internal/billing/entitlement.go`

- [ ] **Step 1.1: Write the failing test first**

Create `api/internal/billing/entitlement_test.go`:

```go
package billing_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"

	"github.com/sniffins-mcmuggins/render/api/internal/billing"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

func ptr[T any](v T) *T { return &v }

func pgUUID(s string) pgtype.UUID {
	p, _ := uuid.Parse(s)
	return pgtype.UUID{Bytes: [16]byte(p), Valid: true}
}

func pgTimestamp(t time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: t, Valid: true}
}

func createUser(t *testing.T, pool interface{ testutil.Pool }, email string) pgtype.UUID {
	t.Helper()
	hash, _ := bcrypt.GenerateFromPassword([]byte("pass"), bcrypt.MinCost)
	hashStr := string(hash)
	q := sqlcdb.New(pool.(interface {
		Exec(ctx context.Context, sql string, args ...any) (interface{}, error)
	}))
	// Use testutil.NewDB pattern
	return pgtype.UUID{}
}

// TestCanPublish uses testutil.NewDB to get a real DB connection.
func TestCanPublish_NoEntitlement_ReturnsFalse(t *testing.T) {
	t.Parallel()
	pool := testutil.NewDB(t)
	q := sqlcdb.New(pool)
	ctx := context.Background()

	hash, _ := bcrypt.GenerateFromPassword([]byte("pass"), bcrypt.MinCost)
	hashStr := string(hash)
	user, err := q.CreateUser(ctx, sqlcdb.CreateUserParams{
		Email:        "nopub-" + uuid.NewString() + "@test",
		PasswordHash: &hashStr,
	})
	require.NoError(t, err)

	ok, err := billing.CanPublish(ctx, pool, user.ID)
	require.NoError(t, err)
	assert.False(t, ok)
}

func TestCanPublish_ActiveArtistBasicGrant_ReturnsTrue(t *testing.T) {
	t.Parallel()
	pool := testutil.NewDB(t)
	q := sqlcdb.New(pool)
	ctx := context.Background()

	hash, _ := bcrypt.GenerateFromPassword([]byte("pass"), bcrypt.MinCost)
	hashStr := string(hash)
	user, err := q.CreateUser(ctx, sqlcdb.CreateUserParams{
		Email:        "pub-basic-" + uuid.NewString() + "@test",
		PasswordHash: &hashStr,
	})
	require.NoError(t, err)

	grantor, err := q.CreateUser(ctx, sqlcdb.CreateUserParams{
		Email:        "grantor-" + uuid.NewString() + "@test",
		PasswordHash: &hashStr,
	})
	require.NoError(t, err)

	_, err = q.CreateAccessGrant(ctx, sqlcdb.CreateAccessGrantParams{
		UserID:     user.ID,
		Plan:       "artist_basic",
		FestivalID: pgtype.UUID{},
		ValidUntil: pgTimestamp(time.Now().Add(30 * 24 * time.Hour)),
		GrantedBy:  grantor.ID,
		Note:       ptr("comp test"),
	})
	require.NoError(t, err)

	ok, err := billing.CanPublish(ctx, pool, user.ID)
	require.NoError(t, err)
	assert.True(t, ok)
}

func TestCanPublish_ActiveArtistProGrant_ReturnsTrue(t *testing.T) {
	t.Parallel()
	pool := testutil.NewDB(t)
	q := sqlcdb.New(pool)
	ctx := context.Background()

	hash, _ := bcrypt.GenerateFromPassword([]byte("pass"), bcrypt.MinCost)
	hashStr := string(hash)
	user, err := q.CreateUser(ctx, sqlcdb.CreateUserParams{
		Email:        "pub-pro-" + uuid.NewString() + "@test",
		PasswordHash: &hashStr,
	})
	require.NoError(t, err)
	grantor, err := q.CreateUser(ctx, sqlcdb.CreateUserParams{
		Email:        "grantor-pro-" + uuid.NewString() + "@test",
		PasswordHash: &hashStr,
	})
	require.NoError(t, err)

	_, err = q.CreateAccessGrant(ctx, sqlcdb.CreateAccessGrantParams{
		UserID:     user.ID,
		Plan:       "artist_pro",
		FestivalID: pgtype.UUID{},
		ValidUntil: pgTimestamp(time.Now().Add(30 * 24 * time.Hour)),
		GrantedBy:  grantor.ID,
		Note:       ptr("comp pro test"),
	})
	require.NoError(t, err)

	ok, err := billing.CanPublish(ctx, pool, user.ID)
	require.NoError(t, err)
	assert.True(t, ok)
}

func TestCanPublish_ExpiredGrant_ReturnsFalse(t *testing.T) {
	t.Parallel()
	pool := testutil.NewDB(t)
	q := sqlcdb.New(pool)
	ctx := context.Background()

	hash, _ := bcrypt.GenerateFromPassword([]byte("pass"), bcrypt.MinCost)
	hashStr := string(hash)
	user, err := q.CreateUser(ctx, sqlcdb.CreateUserParams{
		Email:        "expired-" + uuid.NewString() + "@test",
		PasswordHash: &hashStr,
	})
	require.NoError(t, err)
	grantor, err := q.CreateUser(ctx, sqlcdb.CreateUserParams{
		Email:        "grantor-exp-" + uuid.NewString() + "@test",
		PasswordHash: &hashStr,
	})
	require.NoError(t, err)

	// Grant expired yesterday
	_, err = q.CreateAccessGrant(ctx, sqlcdb.CreateAccessGrantParams{
		UserID:     user.ID,
		Plan:       "artist_basic",
		FestivalID: pgtype.UUID{},
		ValidUntil: pgTimestamp(time.Now().Add(-24 * time.Hour)),
		GrantedBy:  grantor.ID,
		Note:       ptr("expired comp"),
	})
	require.NoError(t, err)

	ok, err := billing.CanPublish(ctx, pool, user.ID)
	require.NoError(t, err)
	assert.False(t, ok)
}
```

- [ ] **Step 1.2: Run the test to see it fail**

```bash
task api:test 2>&1 | grep -E "billing.*entitlement|CanPublish|FAIL"
```

Expected: compile error "billing.CanPublish undefined" — the function doesn't exist yet.

- [ ] **Step 1.3: Write entitlement.go**

Create `api/internal/billing/entitlement.go`:

```go
package billing

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

// CanPublish returns true when the user has a qualifying artist entitlement:
// either an active paid subscription (artist_basic or artist_pro) or an active
// access grant for either plan. Returns an error only for transient DB failures.
func CanPublish(ctx context.Context, pool *pgxpool.Pool, userUUID pgtype.UUID) (bool, error) {
	q := sqlcdb.New(pool)

	// Check active subscription first (Stripe-backed).
	sub, err := q.GetActiveSubscription(ctx, sqlcdb.GetActiveSubscriptionParams{
		UserID:     userUUID,
		FestivalID: pgtype.UUID{},
	})
	if err == nil {
		if sub.Plan == "artist_basic" || sub.Plan == "artist_pro" {
			return true, nil
		}
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return false, err
	}

	// Check access grants (admin comps, promo codes).
	hasBasic, err := q.HasActiveGrant(ctx, sqlcdb.HasActiveGrantParams{
		UserID:     userUUID,
		Plan:       "artist_basic",
		FestivalID: pgtype.UUID{},
	})
	if err != nil {
		return false, err
	}
	if hasBasic {
		return true, nil
	}

	hasPro, err := q.HasActiveGrant(ctx, sqlcdb.HasActiveGrantParams{
		UserID:     userUUID,
		Plan:       "artist_pro",
		FestivalID: pgtype.UUID{},
	})
	return hasPro, err
}
```

- [ ] **Step 1.4: Fix the test file**

The test's `createUser` helper was scaffolded incorrectly above — the tests should use `sqlcdb.New(pool)` directly. The test file as written in Step 1.1 has a broken `createUser` helper. Remove that helper entirely; each test creates its user inline using `q.CreateUser`. Also the `ptr` helper needs a concrete type. Update `entitlement_test.go` to remove the broken helper:

The correct final file (replace what was written in Step 1.1):

```go
package billing_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"

	"github.com/sniffins-mcmuggins/render/api/internal/billing"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

func ptrStr(s string) *string { return &s }

func pgTimestamptz(t time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: t, Valid: true}
}

func TestCanPublish_NoEntitlement_ReturnsFalse(t *testing.T) {
	t.Parallel()
	pool := testutil.NewDB(t)
	q := sqlcdb.New(pool)
	ctx := context.Background()

	hash, _ := bcrypt.GenerateFromPassword([]byte("pass"), bcrypt.MinCost)
	hashStr := string(hash)
	user, err := q.CreateUser(ctx, sqlcdb.CreateUserParams{
		Email: "nopub-" + uuid.NewString() + "@test", PasswordHash: &hashStr,
	})
	require.NoError(t, err)

	ok, err := billing.CanPublish(ctx, pool, user.ID)
	require.NoError(t, err)
	assert.False(t, ok)
}

func TestCanPublish_ActiveArtistBasicGrant_ReturnsTrue(t *testing.T) {
	t.Parallel()
	pool := testutil.NewDB(t)
	q := sqlcdb.New(pool)
	ctx := context.Background()

	hash, _ := bcrypt.GenerateFromPassword([]byte("pass"), bcrypt.MinCost)
	hashStr := string(hash)
	user, err := q.CreateUser(ctx, sqlcdb.CreateUserParams{
		Email: "pub-basic-" + uuid.NewString() + "@test", PasswordHash: &hashStr,
	})
	require.NoError(t, err)
	grantor, err := q.CreateUser(ctx, sqlcdb.CreateUserParams{
		Email: "grantor-" + uuid.NewString() + "@test", PasswordHash: &hashStr,
	})
	require.NoError(t, err)

	_, err = q.CreateAccessGrant(ctx, sqlcdb.CreateAccessGrantParams{
		UserID:     user.ID,
		Plan:       "artist_basic",
		FestivalID: pgtype.UUID{},
		ValidUntil: pgTimestamptz(time.Now().Add(30 * 24 * time.Hour)),
		GrantedBy:  grantor.ID,
		Note:       ptrStr("comp test"),
	})
	require.NoError(t, err)

	ok, err := billing.CanPublish(ctx, pool, user.ID)
	require.NoError(t, err)
	assert.True(t, ok)
}

func TestCanPublish_ActiveArtistProGrant_ReturnsTrue(t *testing.T) {
	t.Parallel()
	pool := testutil.NewDB(t)
	q := sqlcdb.New(pool)
	ctx := context.Background()

	hash, _ := bcrypt.GenerateFromPassword([]byte("pass"), bcrypt.MinCost)
	hashStr := string(hash)
	user, err := q.CreateUser(ctx, sqlcdb.CreateUserParams{
		Email: "pub-pro-" + uuid.NewString() + "@test", PasswordHash: &hashStr,
	})
	require.NoError(t, err)
	grantor, err := q.CreateUser(ctx, sqlcdb.CreateUserParams{
		Email: "grantor-pro-" + uuid.NewString() + "@test", PasswordHash: &hashStr,
	})
	require.NoError(t, err)

	_, err = q.CreateAccessGrant(ctx, sqlcdb.CreateAccessGrantParams{
		UserID:     user.ID,
		Plan:       "artist_pro",
		FestivalID: pgtype.UUID{},
		ValidUntil: pgTimestamptz(time.Now().Add(30 * 24 * time.Hour)),
		GrantedBy:  grantor.ID,
		Note:       ptrStr("comp pro test"),
	})
	require.NoError(t, err)

	ok, err := billing.CanPublish(ctx, pool, user.ID)
	require.NoError(t, err)
	assert.True(t, ok)
}

func TestCanPublish_ExpiredGrant_ReturnsFalse(t *testing.T) {
	t.Parallel()
	pool := testutil.NewDB(t)
	q := sqlcdb.New(pool)
	ctx := context.Background()

	hash, _ := bcrypt.GenerateFromPassword([]byte("pass"), bcrypt.MinCost)
	hashStr := string(hash)
	user, err := q.CreateUser(ctx, sqlcdb.CreateUserParams{
		Email: "expired-" + uuid.NewString() + "@test", PasswordHash: &hashStr,
	})
	require.NoError(t, err)
	grantor, err := q.CreateUser(ctx, sqlcdb.CreateUserParams{
		Email: "grantor-exp-" + uuid.NewString() + "@test", PasswordHash: &hashStr,
	})
	require.NoError(t, err)

	_, err = q.CreateAccessGrant(ctx, sqlcdb.CreateAccessGrantParams{
		UserID:     user.ID,
		Plan:       "artist_basic",
		FestivalID: pgtype.UUID{},
		ValidUntil: pgTimestamptz(time.Now().Add(-24 * time.Hour)), // expired
		GrantedBy:  grantor.ID,
		Note:       ptrStr("expired comp"),
	})
	require.NoError(t, err)

	ok, err := billing.CanPublish(ctx, pool, user.ID)
	require.NoError(t, err)
	assert.False(t, ok)
}
```

- [ ] **Step 1.5: Run tests**

```bash
task api:test 2>&1 | grep -E "TestCanPublish|PASS|FAIL"
```

Expected: all 4 `TestCanPublish_*` tests pass.

---

### Task 2: Wire publish gate into UpdateProfileHandler

**Files:**
- Modify: `api/internal/artist/profile.go`

- [ ] **Step 2.1: Read the current UpdateProfileHandler**

Read `api/internal/artist/profile.go` — find the `UpdateProfileHandler` function. The current imports and the visibility handling block look like:

```go
visibility := existing.Visibility
if req.Visibility != nil {
    if *req.Visibility != "draft" && *req.Visibility != "public" {
        httperr.UnprocessableEntity(w, "visibility must be draft or public")
        return
    }
    visibility = *req.Visibility
}
```

- [ ] **Step 2.2: Add billing import**

Add `"github.com/sniffins-mcmuggins/render/api/internal/billing"` to the import block in `profile.go`. The full import block should be:

```go
import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sniffins-mcmuggins/render/api/internal/analytics"
	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/billing"
	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)
```

- [ ] **Step 2.3: Add the entitlement gate after the visibility validation**

Replace the visibility block in `UpdateProfileHandler`:

```go
visibility := existing.Visibility
if req.Visibility != nil {
    if *req.Visibility != "draft" && *req.Visibility != "public" {
        httperr.UnprocessableEntity(w, "visibility must be draft or public")
        return
    }
    // Gate draft → public: requires active subscription or comp grant.
    if *req.Visibility == "public" && existing.Visibility == "draft" {
        canPub, pubErr := billing.CanPublish(r.Context(), pool, userUUID)
        if pubErr != nil {
            slog.Error("publish gate: check entitlement", "err", pubErr, "user_id", principal.UserID)
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
    }
    visibility = *req.Visibility
}
```

Note: `userUUID` is already computed earlier in `UpdateProfileHandler` (from `principal.UserID`). Use that existing variable — do not redeclare.

- [ ] **Step 2.4: Compile check**

```bash
cd api && go build ./... && cd ..
```

Expected: no errors. If there are errors about `userUUID` redeclaration, rename the gate's local variable to `userUUID` (since it's already declared in scope) and remove the `:=`.

- [ ] **Step 2.5: Run all tests**

```bash
task api:test
```

Expected: all existing tests pass. The existing `publishTestProfile` helper in tests sets visibility directly via `UpdateArtistProfile` (sqlc, not the HTTP handler), so the gate doesn't affect existing tests.

---

### Task 3: Unit tests for gated publish

**Files:**
- Modify: `api/internal/artist/profile_test.go`

- [ ] **Step 3.1: Add billing import to the test file**

The test file needs to create access grants. Check current imports in `profile_test.go`. Add if missing:

```go
import (
    // ... existing imports ...
    "time"
    "github.com/jackc/pgx/v5/pgtype"
    "github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)
```

Note: `sqlcdb` is likely already imported. Add `"time"` if not present.

- [ ] **Step 3.2: Add test helpers**

Append two small helpers to `profile_test.go` (after the existing helpers):

```go
func pgTimestamptzArtist(t time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: t, Valid: true}
}

// grantArtistBasic creates an active artist_basic access grant for userID.
func grantArtistBasic(t *testing.T, pool *pgxpool.Pool, userID string) {
	t.Helper()
	q := sqlcdb.New(pool)
	hash, _ := bcrypt.GenerateFromPassword([]byte("g"), bcrypt.MinCost)
	hashStr := string(hash)
	grantor, err := q.CreateUser(context.Background(), sqlcdb.CreateUserParams{
		Email: "grantor-" + userID + "@test", PasswordHash: &hashStr,
	})
	require.NoError(t, err)
	_, err = q.CreateAccessGrant(context.Background(), sqlcdb.CreateAccessGrantParams{
		UserID:      pgUUID(t, userID),
		Plan:        "artist_basic",
		FestivalID:  pgtype.UUID{},
		ValidUntil:  pgTimestamptzArtist(time.Now().Add(30 * 24 * time.Hour)),
		GrantedBy:   grantor.ID,
		PromoCodeID: pgtype.UUID{},
		Note:        nil,
	})
	require.NoError(t, err)
}
```

Note: `bcrypt` is likely already imported in the file. If not, add `"golang.org/x/crypto/bcrypt"` to imports.

- [ ] **Step 3.3: Write the failing tests**

Append to `profile_test.go`:

```go
func TestUpdateProfile_DraftToPublic_NoEntitlement_Returns402(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	userID, token := createTestUser(t, db, "pub-gate-deny@example.com")
	_ = createTestProfile(t, db, userID, "Gate Test Artist")

	handler := auth.Middleware(db, testSecret)(artist.UpdateProfileHandler(db))
	body := `{"visibility":"public"}`
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPatch, "/profiles/me",
		bytes.NewBufferString(body))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	assert.Equal(t, http.StatusPaymentRequired, w.Code, w.Body.String())
	var resp map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	assert.Equal(t, "payment_required", resp["code"])
}

func TestUpdateProfile_DraftToPublic_WithGrant_Returns200(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	userID, token := createTestUser(t, db, "pub-gate-allow@example.com")
	_ = createTestProfile(t, db, userID, "Entitled Artist")
	grantArtistBasic(t, db, userID)

	handler := auth.Middleware(db, testSecret)(artist.UpdateProfileHandler(db))
	body := `{"visibility":"public"}`
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPatch, "/profiles/me",
		bytes.NewBufferString(body))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	var resp map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	assert.Equal(t, "public", resp["visibility"])
}

func TestUpdateProfile_PublicToDraft_NoGrant_Returns200(t *testing.T) {
	// Already-public artists can set themselves back to draft without entitlement check.
	t.Parallel()
	db := testutil.NewDB(t)
	userID, token := createTestUser(t, db, "pub-to-draft@example.com")
	profileID := createTestProfile(t, db, userID, "WasPublic Artist")
	publishTestProfile(t, db, profileID) // direct DB publish, bypasses gate

	handler := auth.Middleware(db, testSecret)(artist.UpdateProfileHandler(db))
	body := `{"visibility":"draft"}`
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPatch, "/profiles/me",
		bytes.NewBufferString(body))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	var resp map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	assert.Equal(t, "draft", resp["visibility"])
}

func TestUpdateProfile_NonVisibilityPatch_NoGrant_Returns200(t *testing.T) {
	// Updating bio (no visibility field) must not trigger the gate.
	t.Parallel()
	db := testutil.NewDB(t)
	userID, token := createTestUser(t, db, "bio-update-nogate@example.com")
	_ = createTestProfile(t, db, userID, "Bio Artist")

	handler := auth.Middleware(db, testSecret)(artist.UpdateProfileHandler(db))
	body := `{"bio":"My updated bio"}`
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPatch, "/profiles/me",
		bytes.NewBufferString(body))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
}
```

- [ ] **Step 3.4: Run tests**

```bash
task api:test 2>&1 | grep -E "TestUpdateProfile_|TestCanPublish_|PASS|FAIL"
```

Expected: all new tests pass alongside existing ones.

- [ ] **Step 3.5: Commit**

```bash
git add api/internal/billing/entitlement.go \
        api/internal/billing/entitlement_test.go \
        api/internal/artist/profile.go \
        api/internal/artist/profile_test.go
git commit -m "feat(artist): E15.5 — publish gate (subscription or comp grant required) (#180)"
```

---

### Task 4: E2e API tests

**Files:**
- Create: `e2e/api/publish-gate.test.ts`

The stack must be running with the latest API code (`task up && task db:migrate`). Confirm:

```bash
curl -sf http://localhost:8080/healthz && echo OK
docker compose -f infra/docker-compose.yml logs api --tail=5 | grep -E "building|running|api starting"
```

- [ ] **Step 4.1: Write the e2e test file**

```typescript
// e2e/api/publish-gate.test.ts
// E15.5 — Publish gate: subscription or comp grant required to go public.
// Covers: no entitlement → 402; admin grant → publish succeeds; expired grant → 402.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'

const API = process.env.API_URL ?? 'http://localhost:8080'
const DB_URL = process.env.DATABASE_URL ?? 'postgres://render:render@localhost:5432/render'
const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-jwt-secret-change-in-prod'
const SUFFIX = `pubgate-${Date.now()}`

function auth(token: string) {
  return { Authorization: `Bearer ${token}` }
}

import { createHmac } from 'node:crypto'
function base64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}
function signHS256(payload: Record<string, unknown>, secret: string): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = base64url(JSON.stringify(payload))
  const sig = base64url(createHmac('sha256', secret).update(`${header}.${body}`).digest())
  return `${header}.${body}.${sig}`
}

async function seedAdminUser(db: Client, suffix: string): Promise<{ token: string; userId: string }> {
  const email = `admin-${suffix}@pubgate.test`
  await fetch(`${API}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
  return { token: token as string }
}

async function createProfile(token: string, displayName: string) {
  await fetch(`${API}/profiles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth(token) },
    body: JSON.stringify({ displayName }),
  })
}

async function tryPublish(token: string) {
  return fetch(`${API}/profiles/me`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...auth(token) },
    body: JSON.stringify({ visibility: 'public' }),
  })
}

describe('E15.5 — publish gate', () => {
  let db: Client
  let adminToken: string
  let adminUserId: string

  beforeAll(async () => {
    db = new Client({ connectionString: DB_URL })
    await db.connect()
    const admin = await seedAdminUser(db, SUFFIX)
    adminToken = admin.token
    adminUserId = admin.userId
  })

  afterAll(async () => {
    await db.end()
  })

  // ── Unauthenticated probe (confirms RequireAdmin middleware is wired) ─────
  it('POST /admin/users/{id}/grants without token → 401', async () => {
    const res = await fetch(`${API}/admin/users/00000000-0000-0000-0000-000000000000/grants`, {
      method: 'POST',
    })
    expect(res.status).toBe(401)
  })

  // ── No entitlement → 402 ──────────────────────────────────────────────────
  it('PATCH visibility=public with no subscription or grant → 402', async () => {
    const { token } = await signupAndLogin(`noent-${SUFFIX}@pubgate.test`)
    await createProfile(token, `NoEnt-${SUFFIX}`)
    const res = await tryPublish(token)
    expect(res.status).toBe(402)
    const body = await res.json()
    expect(body.code).toBe('payment_required')
  })

  // ── Admin grant → publish succeeds ────────────────────────────────────────
  it('admin grants artist_basic → artist can publish', async () => {
    const { token } = await signupAndLogin(`withgrant-${SUFFIX}@pubgate.test`)
    await createProfile(token, `WithGrant-${SUFFIX}`)

    // Get user id for this artist
    const meRes = await fetch(`${API}/profiles/me`, { headers: auth(token) })
    const me = await meRes.json()
    // Need user ID, not profile ID. Get it from auth.
    // Use DB to find the user
    const { rows } = await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [
      `withgrant-${SUFFIX}@pubgate.test`,
    ])
    const artistUserId = rows[0].id

    // Admin grants artist_basic for 30 days
    const grantRes = await fetch(`${API}/admin/users/${artistUserId}/grants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(adminToken) },
      body: JSON.stringify({ plan: 'artist_basic', duration_days: 30, note: 'e2e test comp' }),
    })
    expect(grantRes.status).toBe(201)

    // Now publish should succeed
    const pubRes = await tryPublish(token)
    expect(pubRes.status).toBe(200)
    const pubBody = await pubRes.json()
    expect(pubBody.visibility).toBe('public')
  })

  // ── Expired grant → 402 ───────────────────────────────────────────────────
  it('expired grant → 402', async () => {
    const { token } = await signupAndLogin(`expgrant-${SUFFIX}@pubgate.test`)
    await createProfile(token, `ExpGrant-${SUFFIX}`)

    const { rows: uRows } = await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [
      `expgrant-${SUFFIX}@pubgate.test`,
    ])
    const artistUserId = uRows[0].id

    // Insert an already-expired grant directly into the DB
    await db.query(
      `INSERT INTO access_grants (user_id, plan, valid_until, granted_by, note)
       VALUES ($1, 'artist_basic', now() - interval '1 day', $2, 'expired e2e test')`,
      [artistUserId, adminUserId],
    )

    const pubRes = await tryPublish(token)
    expect(pubRes.status).toBe(402)
    const body = await pubRes.json()
    expect(body.code).toBe('payment_required')
  })

  // ── Already-public artist can go draft without entitlement ────────────────
  it('already-public artist can set visibility=draft without a grant', async () => {
    // Use DB to directly set an artist public (simulating an existing public artist
    // whose grant has now expired — they stay public until they change state).
    const { token } = await signupAndLogin(`gopublic-${SUFFIX}@pubgate.test`)
    await createProfile(token, `GoPublic-${SUFFIX}`)

    const { rows: uRows } = await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [
      `gopublic-${SUFFIX}@pubgate.test`,
    ])
    const artistUserId = uRows[0].id
    // Set public via DB (bypasses gate — simulates an artist who was already public)
    await db.query(
      `UPDATE artist_profiles SET visibility = 'public' WHERE user_id = $1`,
      [artistUserId],
    )

    // Now draft them via the API — no grant needed (draft→draft or public→draft, no gate)
    const draftRes = await fetch(`${API}/profiles/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth(token) },
      body: JSON.stringify({ visibility: 'draft' }),
    })
    expect(draftRes.status).toBe(200)
    const body = await draftRes.json()
    expect(body.visibility).toBe('draft')
  })
})
```

- [ ] **Step 4.2: Run the e2e tests**

```bash
npx vitest run e2e/api/publish-gate.test.ts
```

Expected: all 5 tests pass.

- [ ] **Step 4.3: Run the full e2e API suite to confirm no regressions**

```bash
task e2e:api
```

Expected: all tests pass.

- [ ] **Step 4.4: Commit**

```bash
git add e2e/api/publish-gate.test.ts
git commit -m "test(e2e): E15.5 — publish gate e2e probes (#180)"
```

---

## Self-review

### Spec coverage

| Requirement | Task |
|-------------|------|
| Admin grant via `POST /admin/users/{id}/grants` | Already exists — confirmed in Task 0 |
| Active paid sub OR active comp grant → can publish | Task 1 (CanPublish) |
| Draft→public gated on entitlement | Task 2 |
| No entitlement → 402 | Task 3 + 4 |
| Expired grant → gate closes | Task 3 (unit) + Task 4 (e2e) |
| No silent unpublish (public→draft allowed without gate) | Task 3 + 4 |
| Unauthenticated probe for /admin route | Task 4 |
| Multiple grants / history preserved | Existing access_grants schema supports this |

### Expiry policy note

The issue specifies "grace period + reminder email on expiry, NOT silent auto-unpublish." This plan implements:
- The publish gate (draft→public requires entitlement) ✓
- No auto-unpublish of existing public profiles ✓ (gate only triggers on `existing.Visibility == "draft"`)

The grace period + reminder email is out of scope for this ticket — it belongs in a future scheduled job or webhook handler. Add a TODO comment in `entitlement.go` if desired:

```go
// TODO(E15.5): on comp expiry, send reminder email + enforce grace period
// before closing the gate on already-public profiles.
```

### Circular dependency check

`artist` imports `billing` (for `CanPublish`). `billing` does not import `artist`. No cycle. ✓
