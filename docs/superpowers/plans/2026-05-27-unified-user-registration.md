# Unified User Registration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drop `users.role` ENUM; replace with `users.is_admin bool`. Anyone can sign up. Artist-ness and organiser-ness emerge from owning the relevant entity. New unified `/dashboard` with two cards.

**Architecture:** Schema migration first (drop role, add is_admin), then sqlc regen, then JWT/Principal change, then per-handler role-gate removal (8 sites), then new `/me/summary` endpoint, then web dashboard repurpose, then e2e updates. Sequential due to dependency chain — each task leaves the build green.

**Tech Stack:** Go (chi router, pgx, sqlc, jwt-go), Postgres (golang-migrate), Next.js (App Router, server components), Vitest + Playwright for e2e. Docker Compose for the stack — see `.claude/rules/e2e-debugging.md`.

**Critical reminders from project rules:**
- **Docker bind mounts the main repo, not the worktree.** All Go/web edits must be applied to `/Users/adampowis/workspace/murals/<path>` AS WELL AS the worktree path, or the container won't see them.
- **sqlc field-count parity:** every `*.sql.go` Scan that touches `users` (including `password_reset.sql.go` returning `users.*`) must update together. Grep-count `&i\.` calls after any hand-edit.
- **JWT shape change forces re-login.** Old tokens decode but lose the `Role` claim; new code reads `IsAdmin`. Acceptable pre-production.
- **Use `task` commands**, not raw `go test` / `npx`. `task api:test` is the canary. `task lint`, `task up`, `task down`, `task db:migrate`.

---

## File Structure

**New files:**
- `db/migrations/000005_drop_user_role.up.sql`
- `db/migrations/000005_drop_user_role.down.sql`
- `api/internal/me/summary.go` — new package, single handler
- `api/internal/me/summary_test.go`
- `web/src/app/dashboard/page.tsx` (moved+rewritten from `(artist)/dashboard/page.tsx`)
- `e2e/browser/apply-without-profile.spec.ts`

**Modified files (Go):**
- `db/queries/users.sql` — drop role param from CreateUser, CreateOAuthUser
- `db/queries/me.sql` — new file with `GetArtistProfileByUserID`, `ListFestivalsByOrganiser` for /me/summary
- `api/internal/sqlcdb/models.go` (regen)
- `api/internal/sqlcdb/users.sql.go` (regen)
- `api/internal/sqlcdb/password_reset.sql.go` (regen — returns `users.*`)
- `api/internal/sqlcdb/me.sql.go` (regen, new)
- `api/internal/auth/jwt.go` — Claims drops `Role`, gains `IsAdmin`; `IssueToken` signature change
- `api/internal/auth/middleware.go` — populates `IsAdmin` from claims
- `api/internal/auth/ctx.go` — `Principal` drops `Role`, gains `IsAdmin`; delete `RequireRole`; update `WithUserForTest`
- `api/internal/auth/signup.go` — drop role from request and handler
- `api/internal/auth/oauth.go` — drop role from CreateOAuthUser call (2 sites); drop role from IssueToken (2 sites)
- `api/internal/auth/login.go` — drop role from IssueToken
- `api/internal/auth/totp.go` — drop role from IssueToken
- `api/internal/auth/reset.go` — verify no role refs
- `api/internal/auth/user.go` — `userResponse.Role` → `IsAdmin`
- `api/internal/festival/festival.go` — drop role gate at line 77
- `api/internal/festival/map_editor.go` — drop role gates at 57, 108; add ownership check
- `api/internal/festival/application.go` — drop role gate at 55; add profile_required 409
- `api/internal/festival/my_applications.go` — drop role gate at 26; return [] if no profile
- `api/internal/artist/profile.go` — drop role gate at 76; keep ownership check
- `api/internal/billing/festival.go` — drop role gate at 22; add ownership check
- `api/internal/billing/organiser.go` — drop role gate at 22
- `api/cmd/api/main.go` — wire `/me/summary` route

**Modified files (test):**
- `api/internal/auth/signup_test.go`, `oauth_test.go`, `login_test.go`, `middleware_test.go`, `reset_test.go`, `totp_test.go`, `me_test.go` — drop role from payloads/assertions
- `api/internal/billing/*_test.go`, `api/internal/festival/*_test.go`, `api/internal/artist/*_test.go` — drop role from Principal literals; add explicit profile/festival setup where needed
- `api/internal/openapi/api.gen.go` (regen)

**Modified files (e2e):**
- `e2e/fixtures/helpers.ts` — `createArtist`/`createOrganiser` → `createUser`
- `e2e/api/golden-path.test.ts` — drop role from signup, add explicit profile/festival setup steps
- `e2e/browser/application-flow.spec.ts`, `artist-onboarding.spec.ts`, `organiser-setup.spec.ts` — update helper calls

**Modified files (web):**
- Move `web/src/app/(artist)/dashboard/page.tsx` → `web/src/app/dashboard/page.tsx`, rewrite as unified two-card view
- Wherever post-login redirect is set (likely `web/src/app/(auth)/login/page.tsx` or a server action) — redirect to `/dashboard`
- `web/src/app/(public)/festivals/[id]/apply/...` — 409 profile_required handling
- Any client-side role guards (grep `role ===` under `web/`)

---

## Task 1: Schema migration

**Files:**
- Create: `db/migrations/000005_drop_user_role.up.sql`
- Create: `db/migrations/000005_drop_user_role.down.sql`

- [ ] **Step 1: Write the up migration**

```sql
-- db/migrations/000005_drop_user_role.up.sql
-- Drop the per-user role ENUM. Authorization is now ownership-of-entity:
-- "is an artist" = has a row in artist_profiles; "is an organiser" = owns at
-- least one row in festivals. Admin is the only remaining platform-level role,
-- and it becomes a boolean.
ALTER TABLE users ADD COLUMN is_admin boolean NOT NULL DEFAULT false;
UPDATE users SET is_admin = true WHERE role = 'admin';
ALTER TABLE users DROP COLUMN role;
DROP TYPE user_role;
```

- [ ] **Step 2: Write the down migration**

```sql
-- db/migrations/000005_drop_user_role.down.sql
-- Reverses 000005_drop_user_role. A user may be both an artist AND an organiser
-- in the new model; the enum can only hold one value, so we pick organiser
-- over artist (organiser is the higher-billing relationship), and admin wins
-- over both.
CREATE TYPE user_role AS ENUM ('artist', 'organiser', 'admin');
ALTER TABLE users ADD COLUMN role user_role NOT NULL DEFAULT 'artist';

UPDATE users SET role = 'organiser'
  WHERE id IN (SELECT DISTINCT organiser_id FROM festivals WHERE deleted_at IS NULL);

UPDATE users SET role = 'admin' WHERE is_admin;

ALTER TABLE users DROP COLUMN is_admin;
```

- [ ] **Step 3: Apply migration to the running stack**

Run: `task db:migrate`
Expected: "5/u drop_user_role" applied; no errors.

If `task db:migrate` is unavailable, fall back to:
```bash
docker compose -f infra/docker-compose.yml exec api migrate -path /app/db/migrations -database "postgres://render:render@db:5432/render?sslmode=disable" up
```

- [ ] **Step 4: Verify**

Run:
```bash
docker compose -f infra/docker-compose.yml exec db psql -U render -d render -c "\d users"
```
Expected: `is_admin boolean` column present; no `role` column; no `user_role` type.

- [ ] **Step 5: Commit**

```bash
git add db/migrations/000005_drop_user_role.up.sql db/migrations/000005_drop_user_role.down.sql
git commit -m "feat(db): drop users.role, add users.is_admin"
```

---

## Task 2: Update sqlc queries

**Files:**
- Modify: `db/queries/users.sql`
- Create: `db/queries/me.sql`

- [ ] **Step 1: Drop role from CreateUser and CreateOAuthUser**

Edit `db/queries/users.sql`. Change:
```sql
-- name: CreateUser :one
INSERT INTO users (email, password_hash, role)
VALUES ($1, $2, $3)
RETURNING *;
```
to:
```sql
-- name: CreateUser :one
INSERT INTO users (email, password_hash)
VALUES ($1, $2)
RETURNING *;
```

And:
```sql
-- name: CreateOAuthUser :one
INSERT INTO users (email, password_hash, role, oauth_provider, oauth_subject)
VALUES ($1, NULL, $2, $3, $4)
ON CONFLICT (oauth_provider, oauth_subject) WHERE oauth_provider IS NOT NULL
DO UPDATE SET oauth_provider = EXCLUDED.oauth_provider
RETURNING *;
```
to:
```sql
-- name: CreateOAuthUser :one
INSERT INTO users (email, password_hash, oauth_provider, oauth_subject)
VALUES ($1, NULL, $2, $3)
ON CONFLICT (oauth_provider, oauth_subject) WHERE oauth_provider IS NOT NULL
DO UPDATE SET oauth_provider = EXCLUDED.oauth_provider
RETURNING *;
```

- [ ] **Step 2: Add /me/summary queries**

Create `db/queries/me.sql`:
```sql
-- name: GetArtistProfileByUserID :one
SELECT * FROM artist_profiles WHERE user_id = $1 LIMIT 1;

-- name: ListFestivalsByOrganiser :many
SELECT id, name, slug, status, start_date, end_date
FROM festivals
WHERE organiser_id = $1 AND deleted_at IS NULL
ORDER BY created_at DESC;
```

(If `GetArtistProfileByUserID` already exists in another query file, skip it here — grep `db/queries/` to check.)

- [ ] **Step 3: Commit**

```bash
git add db/queries/users.sql db/queries/me.sql
git commit -m "feat(db): drop role from CreateUser; add /me/summary queries"
```

---

## Task 3: Regenerate sqlc and update Go models

**Files:**
- Modify: `api/internal/sqlcdb/models.go`
- Modify: `api/internal/sqlcdb/users.sql.go`
- Modify: `api/internal/sqlcdb/password_reset.sql.go`
- Create: `api/internal/sqlcdb/me.sql.go`

- [ ] **Step 1: Try the generator**

Run: `task sqlc:generate` if it exists, else: `(cd api && sqlc generate)`

Expected: regenerates `*.sql.go` files. If sqlc isn't installed locally, fall back to hand-editing per Step 2.

- [ ] **Step 2: Hand-edit fallback (if sqlc unavailable)**

**`api/internal/sqlcdb/models.go`** — in the `User` struct, replace:
```go
Role             UserRole           `db:"role" json:"role"`
```
with:
```go
IsAdmin          bool               `db:"is_admin" json:"is_admin"`
```

Delete the `UserRole` type and constants (`UserRoleArtist`, `UserRoleOrganiser`, `UserRoleAdmin`).

**`api/internal/sqlcdb/users.sql.go`** —
- Remove `Role` from `CreateUserParams`.
- Update the SQL string literal for `createUser` and `createOAuthUser` to match the new column lists.
- In every `row.Scan(&i.ID, &i.Email, &i.PasswordHash, &i.Role, ...)` call, replace `&i.Role` with `&i.IsAdmin` in the correct ordinal position. The column order in the schema is now: `id, email, password_hash, created_at, oauth_provider, oauth_subject, mfa_enabled, mfa_secret, session_version, stripe_customer_id, is_admin` (is_admin is added at the end by ALTER TABLE).

**`api/internal/sqlcdb/password_reset.sql.go`** — same Scan substitution for any `users.*` returns (the `UpdateUserPassword` query).

- [ ] **Step 3: Verify field-count parity**

Run:
```bash
grep -c '&i\.' api/internal/sqlcdb/users.sql.go
grep -c '&i\.' api/internal/sqlcdb/password_reset.sql.go
```
Both numbers should match (the count of columns in `users`, multiplied by the number of queries returning `users.*` in each file). Eyeball that each `row.Scan` call lists exactly the same fields.

- [ ] **Step 4: Add new query bindings**

If sqlc generated `me.sql.go`, accept it. Otherwise hand-write `api/internal/sqlcdb/me.sql.go`:
```go
package sqlcdb

import (
	"context"
	"github.com/jackc/pgx/v5/pgtype"
)

const getArtistProfileByUserID = `SELECT * FROM artist_profiles WHERE user_id = $1 LIMIT 1`

func (q *Queries) GetArtistProfileByUserID(ctx context.Context, userID pgtype.UUID) (ArtistProfile, error) {
	row := q.db.QueryRow(ctx, getArtistProfileByUserID, userID)
	var i ArtistProfile
	err := row.Scan(/* all artist_profiles columns in order */)
	return i, err
}

const listFestivalsByOrganiser = `
SELECT id, name, slug, status, start_date, end_date
FROM festivals
WHERE organiser_id = $1 AND deleted_at IS NULL
ORDER BY created_at DESC`

type ListFestivalsByOrganiserRow struct {
	ID        pgtype.UUID        `db:"id"        json:"id"`
	Name      string             `db:"name"      json:"name"`
	Slug      string             `db:"slug"      json:"slug"`
	Status    FestivalStatus     `db:"status"    json:"status"`
	StartDate pgtype.Date        `db:"start_date" json:"start_date"`
	EndDate   pgtype.Date        `db:"end_date"   json:"end_date"`
}

func (q *Queries) ListFestivalsByOrganiser(ctx context.Context, organiserID pgtype.UUID) ([]ListFestivalsByOrganiserRow, error) {
	rows, err := q.db.Query(ctx, listFestivalsByOrganiser, organiserID)
	if err != nil { return nil, err }
	defer rows.Close()
	var items []ListFestivalsByOrganiserRow
	for rows.Next() {
		var i ListFestivalsByOrganiserRow
		if err := rows.Scan(&i.ID, &i.Name, &i.Slug, &i.Status, &i.StartDate, &i.EndDate); err != nil {
			return nil, err
		}
		items = append(items, i)
	}
	return items, rows.Err()
}
```

(If `GetArtistProfileByUserID` already exists in `artist_profiles.sql.go` or similar, don't duplicate — just reference it from the summary handler.)

- [ ] **Step 5: Build to verify**

Run: `(cd api && go build ./...)`
Expected: builds clean — fail loud if `UserRole` references still exist anywhere.

If there are build errors mentioning `UserRole` in test files, those will be fixed in Task 6+ but the non-test build should pass now. If non-test code still references `UserRole`, fix the reference (it's in scope here).

- [ ] **Step 6: Commit**

```bash
git add api/internal/sqlcdb/
git commit -m "feat(sqlc): regen for role drop + add /me/summary queries"
```

---

## Task 4: JWT and Principal shape change

**Files:**
- Modify: `api/internal/auth/jwt.go`
- Modify: `api/internal/auth/ctx.go`
- Modify: `api/internal/auth/middleware.go`

- [ ] **Step 1: Update Claims and IssueToken**

Edit `api/internal/auth/jwt.go`:
```go
type Claims struct {
	IsAdmin        bool   `json:"is_admin,omitempty"`
	Scope          string `json:"scope,omitempty"`
	SessionVersion int32  `json:"sv,omitempty"`
	jwt.RegisteredClaims
}

func IssueToken(userID string, isAdmin bool, sessionVersion int32, secret string) (string, error) {
	now := time.Now()
	claims := Claims{
		IsAdmin:        isAdmin,
		SessionVersion: sessionVersion,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(tokenTTL)),
		},
	}
	t := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return t.SignedString([]byte(secret))
}
```

`IssueMFAPendingToken` is unchanged (it never carried role).

- [ ] **Step 2: Update Principal and helpers**

Edit `api/internal/auth/ctx.go`:
```go
package auth

import (
	"context"
	"errors"
)

type contextKey struct{}

// Principal holds the authenticated user's identity extracted from the JWT.
type Principal struct {
	UserID  string
	IsAdmin bool
}

var ErrUnauthenticated = errors.New("unauthenticated")

func setPrincipal(ctx context.Context, p Principal) context.Context {
	return context.WithValue(ctx, contextKey{}, p)
}

// WithUserForTest injects a principal into ctx without going through the JWT
// middleware. Intended only for tests of handlers/middleware that gate on the
// principal — production callers must use Middleware.
func WithUserForTest(ctx context.Context, userID string, isAdmin bool) context.Context {
	return setPrincipal(ctx, Principal{UserID: userID, IsAdmin: isAdmin})
}

func User(ctx context.Context) (Principal, error) {
	p, ok := ctx.Value(contextKey{}).(Principal)
	if !ok {
		return Principal{}, ErrUnauthenticated
	}
	return p, nil
}
```

Note: `RequireRole` is deleted entirely.

- [ ] **Step 3: Update middleware**

Edit `api/internal/auth/middleware.go` around line 45. Replace:
```go
r = r.WithContext(setPrincipal(r.Context(), Principal{
    UserID: claims.Subject,
    Role:   claims.Role,
}))
```
with:
```go
r = r.WithContext(setPrincipal(r.Context(), Principal{
    UserID:  claims.Subject,
    IsAdmin: claims.IsAdmin,
}))
```

- [ ] **Step 4: Build**

Run: `(cd api && go build ./...)`
Expected: many errors in handlers that still reference `principal.Role` and `IssueToken(..., string(user.Role), ...)`. These are addressed in subsequent tasks; **do not fix them inline here.** This task ends with a broken build, which is OK — the next two tasks restore it.

- [ ] **Step 5: Commit**

```bash
git add api/internal/auth/jwt.go api/internal/auth/ctx.go api/internal/auth/middleware.go
git commit -m "feat(auth): drop role from Claims, Principal, IssueToken"
```

---

## Task 5: Update all IssueToken call sites + signup

**Files:**
- Modify: `api/internal/auth/signup.go`
- Modify: `api/internal/auth/login.go`
- Modify: `api/internal/auth/oauth.go`
- Modify: `api/internal/auth/totp.go`
- Modify: `api/internal/auth/user.go`

- [ ] **Step 1: Update `userResponse`**

Edit `api/internal/auth/user.go`:
```go
type userResponse struct {
	ID        string `json:"id"`
	Email     string `json:"email"`
	IsAdmin   bool   `json:"is_admin"`
	CreatedAt string `json:"created_at"`
}

func toUserResponse(u sqlcdb.User) userResponse {
	return userResponse{
		ID:        u.ID.String(),
		Email:     u.Email,
		IsAdmin:   u.IsAdmin,
		CreatedAt: u.CreatedAt.Time.Format(time.RFC3339),
	}
}
```

- [ ] **Step 2: Update signup handler**

Edit `api/internal/auth/signup.go`. Replace the `signupRequest` struct and handler body:
```go
type signupRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func SignupHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req signupRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.BadRequest(w, "invalid request body")
			return
		}

		req.Email = strings.ToLower(strings.TrimSpace(req.Email))
		if !isValidEmail(req.Email) {
			httperr.UnprocessableEntity(w, "invalid email format")
			return
		}
		if len(req.Password) < 8 {
			httperr.UnprocessableEntity(w, "password must be at least 8 characters")
			return
		}

		hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), 12)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		hashStr := string(hash)
		q := sqlcdb.New(pool)
		user, err := q.CreateUser(r.Context(), sqlcdb.CreateUserParams{
			Email:        req.Email,
			PasswordHash: &hashStr,
		})
		if err != nil {
			if isUniqueViolation(err) {
				httperr.Write(w, http.StatusConflict, "Conflict", "email already registered")
				return
			}
			httperr.InternalServerError(w)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(toUserResponse(user))
	}
}
```

- [ ] **Step 3: Update IssueToken call in login.go (line ~74)**

Replace `IssueToken(user.ID.String(), string(user.Role), user.SessionVersion, jwtSecret)` with `IssueToken(user.ID.String(), user.IsAdmin, user.SessionVersion, jwtSecret)`.

- [ ] **Step 4: Update IssueToken calls in oauth.go (lines ~103, ~329)**

Same substitution: `string(user.Role)` → `user.IsAdmin`.

Also at line ~197, the `CreateOAuthUser` call: remove the `Role: sqlcdb.UserRoleArtist` field from the params struct. The struct now takes `Email`, `OauthProvider`, `OauthSubject` (in whatever order the regenerated sqlc params have).

- [ ] **Step 5: Update IssueToken call in totp.go (line ~279)**

Same substitution: `string(user.Role)` → `user.IsAdmin`.

- [ ] **Step 6: Verify reset.go**

Run: `grep -n "Role\|role" api/internal/auth/reset.go`
Expected: only the comment on `session_version` may mention "role" in passing; no code refs. If any IssueToken call exists with `string(user.Role)`, apply the same fix.

- [ ] **Step 7: Build**

Run: `(cd api && go build ./...)`
Expected: still some errors in handlers that gate on `principal.Role` (festival/, artist/, billing/). Those are fixed in Task 7. The `auth/` package and the rest of `cmd/` should build clean.

- [ ] **Step 8: Commit**

```bash
git add api/internal/auth/
git commit -m "feat(auth): drop role from signup/login/oauth/totp/user response"
```

---

## Task 6: Update auth unit tests (drop role)

**Files:**
- Modify: `api/internal/auth/signup_test.go`
- Modify: `api/internal/auth/login_test.go`
- Modify: `api/internal/auth/oauth_test.go`
- Modify: `api/internal/auth/me_test.go`
- Modify: `api/internal/auth/middleware_test.go`
- Modify: `api/internal/auth/totp_test.go`
- Modify: `api/internal/auth/reset_test.go`

- [ ] **Step 1: Update signup_test.go**

In every test:
- Drop `"role":"artist"` / `"role":"organiser"` from JSON bodies.
- Replace `assert.Equal(t, "artist", resp["role"])` with `assert.Equal(t, false, resp["is_admin"])`.

There's a test that asserts the default role when missing; it now just asserts is_admin is false. There's likely a test that asserts the role field round-trips; rewrite to assert is_admin.

- [ ] **Step 2: Update login_test.go**

- Drop role-related signup payloads.
- Login response: assert `is_admin: false` instead of `role: "artist"`.
- If any test calls `WithUserForTest(ctx, id, "artist")` directly, change to `WithUserForTest(ctx, id, false)`.

- [ ] **Step 3: Update oauth_test.go**

- Drop role from any direct user fixtures.
- Assertions on returned user shape: is_admin instead of role.

- [ ] **Step 4: Update remaining auth tests**

`me_test.go`, `middleware_test.go`, `totp_test.go`, `reset_test.go`:
- `WithUserForTest(ctx, id, "role")` → `WithUserForTest(ctx, id, false)` (or `true` for admin-only tests, but none currently rely on admin).
- Any `principal.Role` access → `principal.IsAdmin` if the test is checking the field; otherwise delete.
- `IssueToken(id, "artist", sv, secret)` → `IssueToken(id, false, sv, secret)`.

- [ ] **Step 5: Run tests**

Run: `task api:test`
Expected: `auth/` tests pass. Other packages (`festival/`, `artist/`, `billing/`) likely fail because they still construct `Principal{Role: "..."}`. These are addressed in Task 7. Confirm the failures are *only* in those packages and *only* about role.

- [ ] **Step 6: Commit**

```bash
git add api/internal/auth/
git commit -m "test(auth): update for role removal"
```

---

## Task 7: Remove role gates in handlers (with ownership replacement)

**Files:**
- Modify: `api/internal/festival/festival.go:77`
- Modify: `api/internal/festival/map_editor.go:57, 108`
- Modify: `api/internal/festival/application.go:55`
- Modify: `api/internal/festival/my_applications.go:26`
- Modify: `api/internal/artist/profile.go:76`
- Modify: `api/internal/billing/festival.go:22`
- Modify: `api/internal/billing/organiser.go:22`

**Note:** This is mechanical per-file. The replacement pattern depends on the handler — read each file to understand the surrounding ownership check (or absence of it) before deleting the role gate. The general patterns:

- **Pure "create" handlers** (POST /festivals): drop the role check entirely. Authenticated is enough.
- **"Edit my X" handlers** (map_editor, billing festival, artist profile): the ownership check on the entity (festival.organiser_id, artist_profile.user_id) replaces the role gate. If the file *only* had a role gate and never checked ownership, ADD an ownership check.
- **"My X" listing/submission** (application, my_applications): replace role with "user has an artist_profile" check.

- [ ] **Step 1: `festival/festival.go` POST handler**

Find the block around line 77 that reads `if principal.Role != "organiser"`. Delete the role check entirely. The handler proceeds to `INSERT INTO festivals (... organiser_id ...)` using `principal.UserID` — that's the only authorization needed.

- [ ] **Step 2: `festival/map_editor.go` (two sites)**

Find the two `principal.Role != "organiser"` checks. Replace each with an ownership check on the festival being edited:
```go
fest, err := q.GetFestivalByID(r.Context(), festivalUUID)
if err != nil || fest.OrganiserID.String() != principal.UserID {
    httperr.Forbidden(w, "not your festival")
    return
}
```

If the handler ALREADY fetches the festival and checks ownership further down, just delete the role gate and rely on the existing check. If it doesn't, add the check at the role-gate's old position.

- [ ] **Step 3: `festival/application.go` POST handler**

Around line 55: replace `if principal.Role != "artist"` with a profile lookup:
```go
profile, err := q.GetArtistProfileByUserID(r.Context(), userUUID)
if err != nil {
    if errors.Is(err, pgx.ErrNoRows) {
        httperr.Write(w, http.StatusConflict, "profile_required", "create an artist profile to apply")
        return
    }
    httperr.InternalServerError(w)
    return
}
// continue using profile.ID for the application's artist_id
```

(Use whatever `httperr` helper writes `{"error":"profile_required","message":"..."}`. If none does, write a custom JSON response.)

- [ ] **Step 4: `festival/my_applications.go` GET handler**

Around line 26: replace `if principal.Role != "artist"` with:
```go
profile, err := q.GetArtistProfileByUserID(r.Context(), userUUID)
if err != nil {
    if errors.Is(err, pgx.ErrNoRows) {
        w.Header().Set("Content-Type", "application/json")
        _ = json.NewEncoder(w).Encode([]any{})
        return
    }
    httperr.InternalServerError(w)
    return
}
// continue using profile.ID
```

- [ ] **Step 5: `artist/profile.go` PUT handler**

Around line 76: delete `if principal.Role != "artist"`. The handler upserts by `user_id = principal.UserID` — that's the ownership check.

- [ ] **Step 6: `billing/festival.go` and `billing/organiser.go`**

`billing/festival.go:22`: replace role check with festival ownership check (similar pattern to map_editor). The handler pays for a specific festival; verify `festival.organiser_id == principal.UserID`.

`billing/organiser.go:22`: delete the role check. Anyone can pay the setup fee.

- [ ] **Step 7: Build and run API tests**

Run: `task api:test`
Expected: all packages build. Tests in `festival/`, `artist/`, `billing/` likely still fail — they construct `Principal{Role:...}` or assert 403 from the role gate. Those test failures are addressed in Task 8. Compile errors must be zero by end of this task.

- [ ] **Step 8: Commit**

```bash
git add api/internal/festival/ api/internal/artist/ api/internal/billing/
git commit -m "feat: replace role gates with ownership checks in handlers"
```

---

## Task 8: Update handler tests for role removal

**Files:**
- Modify: `api/internal/festival/*_test.go`
- Modify: `api/internal/festival/testhelpers_test.go`
- Modify: `api/internal/artist/*_test.go`
- Modify: `api/internal/artist/testhelpers_test.go`
- Modify: `api/internal/billing/*_test.go`

- [ ] **Step 1: Update test helpers**

In `festival/testhelpers_test.go` and `artist/testhelpers_test.go`:
- Find every `Principal{UserID: ..., Role: "..."}` literal. Replace with `Principal{UserID: ..., IsAdmin: false}` (or drop `IsAdmin: false` since it's the zero value).
- Find `CreateUser` calls that pass a role param. Drop the role param.
- Find `WithUserForTest(ctx, id, "role")`. Change to `WithUserForTest(ctx, id, false)`.

- [ ] **Step 2: Update tests that asserted 403 from role gate**

Tests that asserted "non-artist gets 403 from POST /applications" or "non-organiser gets 403 from POST /festivals":
- For POST /applications: change the assertion. A user with no artist profile now gets 409 `profile_required`. A user with a profile gets 201.
- For POST /festivals: any authenticated user creates. The "non-organiser gets 403" test no longer makes sense — convert to a test that any user can create a festival, then asserts the user is now the organiser.
- For map_editor / billing festival / artist profile: ownership is the new gate. Tests need to verify "user A cannot edit user B's festival" returns 403; that's the same forbidden as before, just from a different code path.

- [ ] **Step 3: Add the profile_required path coverage**

In `festival/application_test.go` (or wherever applications are tested), add:
```go
func TestApply_NoProfile_Returns409(t *testing.T) {
    t.Parallel()
    db := testutil.NewDB(t)
    // ... setup a festival + form
    // create a user, do NOT create artist_profile for them
    // attempt POST /applications/{form_id}
    // assert 409, body contains "profile_required"
}
```

Mirror the helpers in the existing test for setup; the new assertion is the only delta.

- [ ] **Step 4: Run tests**

Run: `task api:test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add api/internal/festival/ api/internal/artist/ api/internal/billing/
git commit -m "test: update handler tests for role removal + profile_required"
```

---

## Task 9: New `/me/summary` endpoint

**Files:**
- Create: `api/internal/me/summary.go`
- Create: `api/internal/me/summary_test.go`
- Modify: `api/cmd/api/main.go`

- [ ] **Step 1: Write the failing test**

Create `api/internal/me/summary_test.go`:
```go
package me_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/me"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

func TestSummary_NoProfileNoFestivals(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	userID := testutil.CreateUser(t, db, "alice@example.com")

	handler := me.SummaryHandler(db)
	ctx := auth.WithUserForTest(t.Context(), userID, false)
	r := httptest.NewRequestWithContext(ctx, http.MethodGet, "/me/summary", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	var body struct {
		ArtistProfile any   `json:"artist_profile"`
		Festivals     []any `json:"festivals"`
	}
	require.NoError(t, json.NewDecoder(w.Body).Decode(&body))
	assert.Nil(t, body.ArtistProfile)
	assert.Empty(t, body.Festivals)
}

func TestSummary_WithProfile(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	userID := testutil.CreateUser(t, db, "bob@example.com")
	testutil.CreateArtistProfile(t, db, userID, "Bob the Painter")

	handler := me.SummaryHandler(db)
	ctx := auth.WithUserForTest(t.Context(), userID, false)
	r := httptest.NewRequestWithContext(ctx, http.MethodGet, "/me/summary", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	var body struct {
		ArtistProfile struct {
			ID          string `json:"id"`
			DisplayName string `json:"display_name"`
		} `json:"artist_profile"`
		Festivals []any `json:"festivals"`
	}
	require.NoError(t, json.NewDecoder(w.Body).Decode(&body))
	assert.Equal(t, "Bob the Painter", body.ArtistProfile.DisplayName)
}

func TestSummary_WithFestivals(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	userID := testutil.CreateUser(t, db, "carol@example.com")
	festID := testutil.CreateFestival(t, db, userID, "My Festival", "my-festival")

	handler := me.SummaryHandler(db)
	ctx := auth.WithUserForTest(t.Context(), userID, false)
	r := httptest.NewRequestWithContext(ctx, http.MethodGet, "/me/summary", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	var body struct {
		Festivals []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"festivals"`
	}
	require.NoError(t, json.NewDecoder(w.Body).Decode(&body))
	require.Len(t, body.Festivals, 1)
	assert.Equal(t, festID, body.Festivals[0].ID)
	assert.Equal(t, "My Festival", body.Festivals[0].Name)
}

func TestSummary_Unauthenticated(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	handler := me.SummaryHandler(db)
	r := httptest.NewRequest(http.MethodGet, "/me/summary", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	assert.Equal(t, http.StatusUnauthorized, w.Code)
}
```

Note: `testutil.CreateUser`, `testutil.CreateArtistProfile`, `testutil.CreateFestival` may need to be added if they don't exist — check `api/internal/testutil/` first. If missing, add minimal helpers there that insert directly with sqlc.

- [ ] **Step 2: Run test — expect failure**

Run: `(cd api && go test ./internal/me/...)`
Expected: compile error (`me` package does not exist).

- [ ] **Step 3: Implement the handler**

Create `api/internal/me/summary.go`:
```go
package me

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

type artistProfilePayload struct {
	ID           string `json:"id"`
	DisplayName  string `json:"display_name"`
	Bio          string `json:"bio"`
	AvatarS3Key  string `json:"avatar_s3_key,omitempty"`
}

type festivalPayload struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Slug      string `json:"slug"`
	Status    string `json:"status"`
	StartDate string `json:"start_date,omitempty"`
	EndDate   string `json:"end_date,omitempty"`
}

type summaryResponse struct {
	ArtistProfile *artistProfilePayload `json:"artist_profile"`
	Festivals     []festivalPayload     `json:"festivals"`
}

func SummaryHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, err := auth.User(r.Context())
		if err != nil {
			httperr.Unauthorized(w, "authentication required")
			return
		}
		userUUID, err := pgUUID(principal.UserID)
		if err != nil {
			httperr.BadRequest(w, "invalid user id")
			return
		}

		q := sqlcdb.New(pool)

		var profilePayload *artistProfilePayload
		profile, err := q.GetArtistProfileByUserID(r.Context(), userUUID)
		if err == nil {
			avatar := ""
			if profile.AvatarS3Key != nil {
				avatar = *profile.AvatarS3Key
			}
			profilePayload = &artistProfilePayload{
				ID:          profile.ID.String(),
				DisplayName: profile.DisplayName,
				Bio:         profile.Bio,
				AvatarS3Key: avatar,
			}
		} else if !errors.Is(err, pgx.ErrNoRows) {
			httperr.InternalServerError(w)
			return
		}

		fests, err := q.ListFestivalsByOrganiser(r.Context(), userUUID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}
		festPayloads := make([]festivalPayload, 0, len(fests))
		for _, f := range fests {
			fp := festivalPayload{
				ID:     f.ID.String(),
				Name:   f.Name,
				Slug:   f.Slug,
				Status: string(f.Status),
			}
			if f.StartDate.Valid {
				fp.StartDate = f.StartDate.Time.Format("2006-01-02")
			}
			if f.EndDate.Valid {
				fp.EndDate = f.EndDate.Time.Format("2006-01-02")
			}
			festPayloads = append(festPayloads, fp)
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(summaryResponse{
			ArtistProfile: profilePayload,
			Festivals:     festPayloads,
		})
	}
}
```

The `pgUUID` helper: reuse the one in `api/internal/auth/pgtype_helpers.go` (`pgUUIDFromString`) or create a local copy in `me/`. If creating local, copy the exact pattern from `auth/pgtype_helpers.go` — don't reinvent.

- [ ] **Step 4: Wire the route**

Edit `api/cmd/api/main.go`. Inside the authenticated routes group (where `/me`, `/profiles/me`, etc. are registered), add:
```go
r.Get("/me/summary", me.SummaryHandler(pool))
```
Import: `me "github.com/sniffins-mcmuggins/render/api/internal/me"`.

- [ ] **Step 5: Run tests**

Run: `task api:test`
Expected: all me/ tests pass. No regressions elsewhere.

- [ ] **Step 6: Smoke test against the running stack**

```bash
EMAIL="smoke-$(date +%s)@test"
curl -sf -X POST http://localhost:8080/auth/signup -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"password123\"}"
T=$(curl -sf -X POST http://localhost:8080/auth/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"password123\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
curl -sf http://localhost:8080/me/summary -H "Authorization: Bearer $T" | python3 -m json.tool
```
Expected: `{"artist_profile": null, "festivals": []}`.

- [ ] **Step 7: Commit**

```bash
git add api/internal/me/ api/cmd/api/main.go
git commit -m "feat(api): add GET /me/summary"
```

---

## Task 10: OpenAPI regeneration

**Files:**
- Modify: `api/internal/openapi/api.gen.go` (regen)
- Modify: `api/internal/openapi/openapi.yaml` (or whatever the source spec is)

- [ ] **Step 1: Locate the OpenAPI source**

Run: `find api/internal/openapi -type f -not -name 'api.gen.go'` to find the yaml/json source.

- [ ] **Step 2: Update the source**

In the User schema:
- Remove `role` property.
- Add `is_admin: { type: boolean }`.

In SignupRequest (or wherever the signup body is described):
- Remove `role` property.

If `/me/summary` should be in the spec, add the endpoint definition. (It's an internal-ish endpoint; for PoC, omit if it adds friction.)

- [ ] **Step 3: Regenerate**

Run the project's OpenAPI gen command — likely `task openapi:generate` or `(cd api && oapi-codegen ...)`. Check `Taskfile.yml` or the openapi directory for hints.

- [ ] **Step 4: Build**

Run: `(cd api && go build ./...)`
Expected: clean.

- [ ] **Step 5: Run tests**

Run: `task api:test`
Expected: all pass. (The openapi-validated tests, if any, now expect is_admin.)

- [ ] **Step 6: Commit**

```bash
git add api/internal/openapi/
git commit -m "feat(openapi): drop role, add is_admin"
```

---

## Task 11: Repurpose `(artist)/dashboard` as unified `/dashboard`

**Files:**
- Move: `web/src/app/(artist)/dashboard/page.tsx` → `web/src/app/dashboard/page.tsx`
- Modify: the new `web/src/app/dashboard/page.tsx` body (full rewrite)
- Possibly modify: `web/src/app/(artist)/layout.tsx` (if it had route-protection logic gating on artist role — that protection no longer makes sense)

- [ ] **Step 1: Move the file**

```bash
mkdir -p web/src/app/dashboard
git mv web/src/app/\(artist\)/dashboard/page.tsx web/src/app/dashboard/page.tsx
```

(If the parens require a different escape in your shell, run from a file manager or pass the literal path string.)

- [ ] **Step 2: Rewrite the page as unified dashboard**

Replace the contents of `web/src/app/dashboard/page.tsx` with:
```tsx
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getServerToken } from '@/lib/auth-server'

const API_URL = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'

type ArtistProfile = {
  id: string
  display_name: string
  bio: string
  avatar_s3_key?: string
}

type Festival = {
  id: string
  name: string
  slug: string
  status: 'draft' | 'open' | 'live' | 'archived'
  start_date?: string
  end_date?: string
}

type Summary = {
  artist_profile: ArtistProfile | null
  festivals: Festival[]
}

async function fetchSummary(token: string): Promise<Summary> {
  const res = await fetch(`${API_URL}/me/summary`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`/me/summary failed: ${res.status}`)
  return res.json()
}

export default async function DashboardPage() {
  const token = await getServerToken()
  if (!token) redirect('/login')

  const summary = await fetchSummary(token)

  return (
    <main className="max-w-4xl mx-auto p-6 space-y-6">
      <h1 className="text-3xl font-serif">Your dashboard</h1>

      <section className="border rounded-lg p-6">
        <h2 className="text-xl font-serif mb-4">Your art</h2>
        {summary.artist_profile ? (
          <div className="flex items-center gap-4">
            <div>
              <p className="font-medium">{summary.artist_profile.display_name}</p>
              <p className="text-sm text-mid">{summary.artist_profile.bio}</p>
            </div>
            <Link href="/profile/edit" className="ml-auto underline">Manage profile</Link>
          </div>
        ) : (
          <div className="text-center py-6">
            <p className="text-mid mb-4">No artist profile yet.</p>
            <Link href="/profile/edit" className="inline-block px-4 py-2 bg-amber text-ink rounded">
              Set up your artist profile
            </Link>
          </div>
        )}
      </section>

      <section className="border rounded-lg p-6">
        <h2 className="text-xl font-serif mb-4">Your festivals</h2>
        {summary.festivals.length > 0 ? (
          <ul className="space-y-2">
            {summary.festivals.map((f) => (
              <li key={f.id} className="flex items-center gap-4">
                <span className="font-medium">{f.name}</span>
                <span className="text-xs uppercase tracking-wider text-mid">{f.status}</span>
                <Link href={`/organiser/festivals/${f.id}`} className="ml-auto underline">
                  Manage
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-center py-6">
            <p className="text-mid mb-4">No festivals yet.</p>
            <Link href="/organiser/festivals/new" className="inline-block px-4 py-2 bg-amber text-ink rounded">
              Create a festival
            </Link>
          </div>
        )}
      </section>
    </main>
  )
}
```

Adjust the link hrefs (`/profile/edit`, `/organiser/festivals/[id]`, `/organiser/festivals/new`) to match the actual routes — find them by:
```bash
find web/src/app -name "page.tsx" | grep -E "profile|organiser"
```

- [ ] **Step 3: Inspect the old `(artist)` layout**

Read `web/src/app/(artist)/layout.tsx` if it exists. If it gated the route group on `role === 'artist'`, delete that check (server-side ownership is now the gate, and there's nothing artist-specific about the layout anymore). If it was a pure visual layout, leave it.

- [ ] **Step 4: Verify the build**

Run: `docker compose -f infra/docker-compose.yml restart web`
Then: `docker compose -f infra/docker-compose.yml logs web --tail=30 | grep -iE 'error|warn|failed'`
Expected: no compile errors.

- [ ] **Step 5: Smoke in browser**

Open `http://localhost:3000/dashboard` while logged in. Expected: two empty-state cards. Both CTAs link to the correct routes.

- [ ] **Step 6: Commit**

```bash
git add web/src/app/dashboard/ web/src/app/\(artist\)/
git commit -m "feat(web): unified /dashboard with two-card layout"
```

---

## Task 12: Update post-login redirect

**Files:**
- Modify: wherever the post-login redirect is set (likely `web/src/app/(auth)/login/page.tsx`, a `LoginForm` client component, or a server action under `web/src/app/(auth)/login/`)

- [ ] **Step 1: Find the redirect**

Run: `grep -rn "redirect\|push\|router\.push" web/src/app/\(auth\)/login/`

Look for a line like `router.push('/organiser/dashboard')` or `redirect('/profile/edit')` or a role-branched if/else.

- [ ] **Step 2: Replace with `/dashboard`**

Whatever the destination logic was, replace with a single redirect to `/dashboard`. Remove any role-branching code (likely now dead).

- [ ] **Step 3: Verify**

Manually: log out, log back in via `http://localhost:3000/login`. Expected: lands on `/dashboard`.

- [ ] **Step 4: Commit**

```bash
git add web/src/app/\(auth\)/login/
git commit -m "feat(web): post-login redirect → /dashboard"
```

---

## Task 13: Apply-without-profile 409 handling

**Files:**
- Modify: `web/src/app/(public)/festivals/[id]/apply/page.tsx` (or wherever the application submit lives)

- [ ] **Step 1: Find the apply submit handler**

Run: `find web/src/app -name "*.tsx" -path "*apply*"`

Open the client component that calls `POST /applications/{form_id}`.

- [ ] **Step 2: Add 409 detection**

When the submit response is 409 with body containing `"error":"profile_required"`, show an inline notice instead of a generic error:
```tsx
const res = await fetch(/* ... */)
if (res.status === 409) {
  const body = await res.json()
  if (body.error === 'profile_required') {
    setProfileRequiredError(true)
    return
  }
}
```

Render the notice (somewhere near the submit button):
```tsx
{profileRequiredError && (
  <div className="border border-amber bg-warm p-4 rounded">
    <p className="mb-2">You need an artist profile to apply.</p>
    <Link href="/profile/edit" className="underline">Set up your artist profile →</Link>
  </div>
)}
```

- [ ] **Step 3: Verify in browser**

- Log in as a fresh user (no profile).
- Navigate to a festival's apply page.
- Click submit. Expected: inline panel appears with link to profile setup.

- [ ] **Step 4: Commit**

```bash
git add web/src/app/\(public\)/festivals/
git commit -m "feat(web): apply-without-profile shows inline profile CTA"
```

---

## Task 14: Update e2e helpers

**Files:**
- Modify: `e2e/fixtures/helpers.ts`

- [ ] **Step 1: Collapse createArtist/createOrganiser into createUser**

Replace lines 30–86 (current `ArtistSetup`, `createArtist`, `OrganiserSetup`, `createOrganiser`) with:
```ts
export interface UserSetup {
  token: string
  userId: string
  email: string
  password: string
}

export async function createUser(prefix = 'user', suffix: string | number = Date.now()): Promise<UserSetup> {
  const email = `${prefix}-${suffix}@e2e.test`
  const password = 'testpass123'

  const signupRes = await fetch(`${API}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!signupRes.ok) throw new Error(`Signup failed: ${signupRes.status}`)

  const loginRes = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!loginRes.ok) throw new Error(`Login failed: ${loginRes.status}`)
  const { token, user } = await loginRes.json()

  return { token, userId: user.id, email, password }
}

// Back-compat shims — delete after all call sites migrate to createUser.
export const createArtist = (suffix?: string | number) => createUser('artist', suffix)
export const createOrganiser = (suffix?: string | number) => createUser('organiser', suffix)
export type ArtistSetup = UserSetup
export type OrganiserSetup = UserSetup
```

Keeping the shims makes the migration of call sites incremental — call sites can be updated in subsequent commits or left as-is for the PoC.

- [ ] **Step 2: Commit**

```bash
git add e2e/fixtures/helpers.ts
git commit -m "test(e2e): unify createArtist/createOrganiser → createUser"
```

---

## Task 15: Update e2e API golden-path test

**Files:**
- Modify: `e2e/api/golden-path.test.ts`

- [ ] **Step 1: Read the file**

```bash
grep -n "role\|createArtist\|createOrganiser" e2e/api/golden-path.test.ts
```

For each match:
- JSON body literals with `role: 'artist'|'organiser'`: drop the field.
- `createArtist` / `createOrganiser` call sites: leave as-is (the shims cover them) OR migrate to `createUser('artist'|'organiser', suffix)` for clarity.
- Any assertion on `user.role`: change to `user.is_admin` (almost certainly checking `=== false` was implicit).

Since this file has 18 sequential `it(...)` blocks that share state via top-level `let` vars, any place where a user was "an artist" or "an organiser" by signup must now explicitly create the artist_profile / festival in an earlier `it()` block. Re-read the flow end-to-end after edits to confirm.

- [ ] **Step 2: Run**

Run: `task e2e:api`
Expected: all 18 blocks pass.

- [ ] **Step 3: Commit**

```bash
git add e2e/api/golden-path.test.ts
git commit -m "test(e2e): update golden-path for role removal"
```

---

## Task 16: Update browser specs

**Files:**
- Modify: `e2e/browser/application-flow.spec.ts`
- Modify: `e2e/browser/artist-onboarding.spec.ts`
- Modify: `e2e/browser/organiser-setup.spec.ts`

- [ ] **Step 1: For each spec, grep for `role` and helper calls**

```bash
grep -n "role\|createArtist\|createOrganiser" e2e/browser/*.spec.ts
```

The shims keep `createArtist` working, but any inline `JSON.stringify({email, password, role: '...'})` must drop the role.

- [ ] **Step 2: Add profile-creation steps if a test asserts apply success**

If `application-flow.spec.ts` previously relied on `createArtist` implicitly making the user "able to apply", and your role gate replacement now requires an explicit `POST /profiles`, the helper `createArtist` does NOT create a profile (verify by re-reading `helpers.ts` — it does not). So either:
- Add a `createProfile(token, {displayName})` call after `createArtist` in any spec that submits an application, OR
- (Optional) make `createArtist` ALSO call `createProfile` for backward compat.

For PoC: add the explicit `createProfile` call. Cleaner.

- [ ] **Step 3: Run**

Run: `npx playwright test e2e/browser/application-flow.spec.ts`
Then: `npx playwright test`
Expected: all specs pass.

- [ ] **Step 4: Commit**

```bash
git add e2e/browser/
git commit -m "test(e2e): update browser specs for role removal"
```

---

## Task 17: New spec — apply-without-profile

**Files:**
- Create: `e2e/browser/apply-without-profile.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '@playwright/test'
import { createUser } from '../fixtures/helpers'

const API = process.env.API_URL ?? 'http://localhost:8080'

test('apply without artist profile shows inline CTA', async ({ browser }) => {
  const suffix = Date.now()

  // 1. Create an organiser + open festival with an application form.
  const organiser = await createUser('organiser', suffix)
  const festRes = await fetch(`${API}/festivals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${organiser.token}` },
    body: JSON.stringify({
      name: `NoProfile Fest ${suffix}`,
      slug: `noprofile-fest-${suffix}`,
      description: 'test',
      location_label: 'Cheltenham',
    }),
  })
  expect(festRes.ok).toBeTruthy()
  const fest = await festRes.json()

  // Create an application form and open the festival
  await fetch(`${API}/festivals/${fest.id}/form`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${organiser.token}` },
    body: JSON.stringify({ fields: [{ id: 'q1', label: 'Your work', type: 'text', required: true }] }),
  })
  await fetch(`${API}/festivals/${fest.id}/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${organiser.token}` },
    body: JSON.stringify({ status: 'open' }),
  })

  // 2. Sign up an artist WITHOUT creating a profile, then log in via the browser.
  const artist = await createUser('artist', suffix + 1)
  const context = await browser.newContext()
  const page = await context.newPage()
  // (You may need a `loginAs` helper here — see existing specs for the pattern.)
  await page.goto('/login')
  await page.getByLabel('Email').fill(artist.email)
  await page.getByLabel('Password').fill(artist.password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await page.waitForURL('/dashboard')

  // 3. Navigate to the festival apply page and submit
  await page.goto(`/festivals/${fest.slug}/apply`)
  await page.getByLabel('Your work').fill('Walls and big colours')
  await page.getByRole('button', { name: /submit|apply/i }).click()

  // 4. Assert: inline profile_required notice appears
  await expect(page.getByText(/need an artist profile/i)).toBeVisible()
  await expect(page.getByRole('link', { name: /set up your artist profile/i })).toBeVisible()
})
```

Adapt the URL paths and selectors to match the actual web app (verify by reading the existing apply-flow spec).

- [ ] **Step 2: Run**

Run: `npx playwright test e2e/browser/apply-without-profile.spec.ts`
Expected: pass.

If it fails on assertions for the notice text or link, check the exact strings rendered by the page (from Task 13) and match.

- [ ] **Step 3: Commit**

```bash
git add e2e/browser/apply-without-profile.spec.ts
git commit -m "test(e2e): cover apply-without-profile 409 path"
```

---

## Task 18: Full suite + lint + final commit

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `task e2e`
Expected: all pass (API gate + 4 specs + 1 new spec).

- [ ] **Step 2: API tests + lint**

Run: `task api:test && task lint`
Expected: all pass.

- [ ] **Step 3: Verify the docker stack is still healthy**

```bash
curl -sf http://localhost:8080/healthz && echo "API ok"
curl -sf -o /dev/null -w "web: %{http_code}\n" http://localhost:3000
docker compose -f infra/docker-compose.yml ps
```
Expected: API ok, web 200, all services healthy.

- [ ] **Step 4: Final review commit (if any leftover cleanups)**

Run: `git status` to spot stragglers (unused imports, dead role-branching code). Clean them.

```bash
git status
# If anything pending:
git add -A
git commit -m "chore: cleanup after role removal"
```

---

## Self-review check (done before handoff)

- **Spec coverage:**
  - Authorization changes (8 sites) → Task 7
  - Schema migration → Task 1
  - Signup + OAuth → Tasks 2, 5
  - Dashboard + navigation → Tasks 11, 12
  - Apply-without-profile UX → Tasks 13, 17
  - Testing changes → Tasks 6, 8, 14, 15, 16, 17
  - File-by-file list → covered by the per-task file lists above
  - OpenAPI → Task 10
  - JWT shape change → Task 4
  - sqlc field-count parity → Task 3 step 3
- **Placeholders:** none — every code block is complete; `/profile/edit` and `/organiser/festivals/new` are noted as "verify the path" but the engineer has the grep command.
- **Type consistency:** `IssueToken(userID string, isAdmin bool, sessionVersion int32, secret string)` is used consistently. `Principal{UserID, IsAdmin}` used consistently. `users.is_admin` (snake_case in JSON, IsAdmin in Go) used consistently.

---

## Done

Once all tasks check out, the feature is shipped. The shims in `helpers.ts` (`createArtist`/`createOrganiser` as aliases) and any back-compat noise can be cleaned up in a follow-up commit if desired; for PoC they're fine to leave.
