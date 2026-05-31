---
paths:
  - "**/*_test.go"
---

# Go Testing Conventions

## Mandatory: `t.Parallel()` on every test

Every `Test*` function MUST call `t.Parallel()` as its first line. This applies to all tests, even trivial ones — the shared-container model in `testutil` is safe for parallel use.

```go
func TestMyThing(t *testing.T) {
    t.Parallel()
    // ...
}
```

Do NOT add `t.Parallel()` to helper functions (those that take `t *testing.T` but aren't named `Test*`). Do NOT add it to `t.Run` subtests — subtests run sequentially within a parent test by default, which is correct; adding `t.Parallel()` inside a subtest changes its scheduling relative to sibling subtests and is usually wrong.

## Database: `testutil.NewDB(t)`

For any test that needs a database, use `testutil.NewDB(t)`. It returns a `*pgxpool.Pool` backed by a fresh, fully-migrated, isolated Postgres database. The pool is closed automatically via `t.Cleanup`.

```go
db := testutil.NewDB(t)
```

One shared container starts per package the first time `NewDB` is called; every subsequent call gets its own `CREATE DATABASE` inside that container — cheap isolation, no repeated container starts.

Do NOT spin up your own container. Do NOT share a pool across subtests. Do NOT call `pool.Close()` yourself — `t.Cleanup` handles it.

## Users and JWTs: `testutil.CreateUser(t, pool)`

To create an authenticated user with a valid JWT:

```go
userID, token, email := testutil.CreateUser(t, pool)
```

Returns `(userID string, token string, email string)`. The token is signed with `testutil.TestSecret`.

If you only need `userID` and `token` (most handler tests), ignore `email`:

```go
userID, token, _ := testutil.CreateUser(t, pool)
```

Alias the secret in each test package for brevity:

```go
const testSecret = testutil.TestSecret
```

Do NOT roll your own user creation. Do NOT hardcode JWT secrets. Do NOT call `auth.IssueToken` directly in tests — that is `testutil.CreateUser`'s job.

## Assertions: `require` vs `assert`

Import both from testify:

```go
import (
    "github.com/stretchr/testify/assert"
    "github.com/stretchr/testify/require"
)
```

Use `require.*` when the test cannot meaningfully continue on failure (setup errors, status codes, parsing responses):

```go
require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
```

Use `assert.*` for non-fatal field-level assertions where you want all failures reported:

```go
assert.Equal(t, "Alice Muralist", resp["display_name"])
assert.NotEmpty(t, resp["id"])
```

Never use `t.Fatal` or `t.Error` directly — use `require`/`assert` instead.

## Handler testing: two patterns

### Single handler (no router needed)

Wire auth middleware directly onto the handler and use `httptest.NewRecorder`:

```go
handler := auth.Middleware(db, testSecret)(mypackage.MyHandler(db))

r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/path", bytes.NewBufferString(body))
r.Header.Set("Content-Type", "application/json")
r.Header.Set("Authorization", "Bearer "+token)
w := httptest.NewRecorder()
handler.ServeHTTP(w, r)

require.Equal(t, http.StatusOK, w.Code, w.Body.String())
```

### Multiple routes / chi router

Use `httptest.NewServer` when you need a full router (e.g. testing route-level middleware, path params, or multiple endpoints in one test):

```go
r := chi.NewRouter()
r.Use(auth.Middleware(db, testSecret))
r.Post("/festivals", festival.CreateHandler(db))
r.Get("/festivals/{festivalID}", festival.GetHandler(db))

srv := httptest.NewServer(r)
t.Cleanup(srv.Close)

resp := testutil.DoRequest(t, srv, "POST", "/festivals", `{"name":"Test"}`, token)
require.Equal(t, http.StatusCreated, resp.StatusCode)
_ = resp.Body.Close()
```

Always `t.Cleanup(srv.Close)` and always close response bodies.

## `testutil.DoRequest` (for router-based tests)

Use `testutil.DoRequest` — do NOT copy a local version into each test file:

```go
resp := testutil.DoRequest(t, srv, "POST", "/festivals", `{"name":"Test"}`, token)
require.Equal(t, http.StatusCreated, resp.StatusCode)
_ = resp.Body.Close()
```

Signature: `DoRequest(t, srv, method, path, body, token string) *http.Response`. Pass `""` for body or token when not needed. Sets `Content-Type: application/json` and `Authorization: Bearer` automatically when the respective args are non-empty.

## Package-level test helpers

Test helpers that set up domain state (create a festival, create a profile, grant a plan) live in `testhelpers_test.go` in each package. Always check that file before writing new setup code.

Conventions:
- Always call `t.Helper()` as the first line
- Use `require.NoError(t, err)` rather than `t.Fatalf` for sqlcdb errors
- Use `testutil.CreateUser` internally rather than duplicating user creation

```go
func createTestFestival(t *testing.T, pool *pgxpool.Pool, organiserID, status string) (festID, slug string) {
    t.Helper()
    // ... sqlcdb call ...
    require.NoError(t, err)
    return fest.ID.String(), slug
}
```

## Test package naming

Use the external test package: `package foo_test`, not `package foo`. This enforces that tests only use the exported API, matching how callers use the package.

## What NOT to do

- No `t.Fatal` / `t.Error` — use `require` / `assert`
- No `context.Background()` in request creation — use `t.Context()`
- No custom Postgres container setup — use `testutil.NewDB(t)`
- No custom user/JWT creation — use `testutil.CreateUser(t, pool)`
- No hardcoded secrets — use `testutil.TestSecret`
- No `t.Parallel()` inside `t.Run` subtests — sequential within the parent is correct
