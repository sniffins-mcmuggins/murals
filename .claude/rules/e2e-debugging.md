# E2E Test Debugging

When working on e2e failures, load: @e2e/fixtures/helpers.ts @e2e/api/golden-path.test.ts @e2e/browser/application-flow.spec.ts @e2e/browser/artist-onboarding.spec.ts @e2e/browser/organiser-setup.spec.ts @e2e/browser/public-visitor.spec.ts @playwright.config.ts @vitest.e2e.config.ts @infra/docker-compose.yml

## How the suite is wired

Two runners, one Compose stack. Stack must be running first — neither runner manages it.

| Layer | Runner | Files | Command |
|---|---|---|---|
| API gate | Vitest | `e2e/api/*.test.ts` (multiple files, run in parallel by Vitest) | `task e2e:api` |
| Browser | Playwright (Chromium only) | `e2e/browser/*.spec.ts` (4 specs, parallel by file) | `npx playwright test` |
| Both, in order | — | API gate then browser | `task e2e` |

The API gate is not just `golden-path.test.ts`. It runs all `e2e/api/*.test.ts` files, which includes (at time of writing): `golden-path.test.ts`, `authorization-isolation.test.ts`, `billing-guards.test.ts`, `admin-auth.test.ts`, `admin-promo.test.ts`, `application-review.test.ts`. When a file is named in a failure, run only that file.

Stack control: `task up` / `task down`. Reset DB: `task db:migrate`.

**Never run `npx playwright test --config=e2e/browser/playwright.config.ts`** — the config is at the worktree root, not under `e2e/browser/`.

## Architecture you must keep in mind

**Docker mount source-of-truth.** The API and web containers bind-mount `../api` and `..` from `infra/docker-compose.yml` — that resolves to the **main repo**, not the current worktree. When you fix production code while in a worktree, edit BOTH:
- `/Users/adampowis/workspace/murals/<path>` (this is what Docker runs)
- `<worktree>/<path>` (this is what git commits)

After editing the API: watch `task up` logs for "building..." → "running..." → "api starting". If you see `[hh:mm:ss] failed to build`, the old binary is still serving. Fix the compile error before re-testing.

Quick health check: `docker compose -f infra/docker-compose.yml logs api --tail=10`.

**Two service hostnames for MinIO.** `minio:9000` is reachable inside the Docker network; `localhost:9000` is reachable from the host (browsers and the Node test process). The API has two MinIO clients in `cmd/api/main.go`:
- `mc` (internal, `MINIO_ENDPOINT=minio:9000`) → used by `ConfirmHandler` for bucket ops
- `mcPublic` (public, `MINIO_PUBLIC_ENDPOINT=localhost:9000` + `Region: "us-east-1"`) → used by `PresignHandler` so the signature matches the Host the browser will send

**Why `Region: "us-east-1"` is non-negotiable on the public client.** `PresignedPutObject` calls `GetBucketLocation` first unless `Region` is set. That network call goes to `localhost:9000` from *inside* the api container, which is the api container's own loopback (nothing there) → `dial tcp [::1]:9000: connect: connection refused` → 500. Set the region, skip the call.

## Fast feedback loops

The full suite takes ~30s. When iterating on a single failure, don't run everything.

```bash
# Single browser spec, single test by name
npx playwright test e2e/browser/application-flow.spec.ts
npx playwright test -g "apply → accept → pin"
npx playwright test --headed                            # show the browser (watch what's happening)
npx playwright test --debug                             # step through with the Playwright Inspector
npx playwright test --ui                                # interactive UI mode (best for selector debugging)

# Single Vitest file or block
npx vitest run e2e/api/golden-path.test.ts              # run one test file
npx vitest run e2e/api/admin-auth.test.ts               # same for any other file
npx vitest run e2e/api/golden-path.test.ts -t "presign" # filter by test name
npx vitest run e2e/api/golden-path.test.ts -t "8\\."    # by number prefix (golden-path is sequential)

# After a failure — the report and trace already exist on disk
npx playwright show-report                              # opens HTML report (last run)
npx playwright show-trace test-results/<spec-dir>/trace.zip
# Trace is only captured on retry by default (playwright.config.ts: `trace: 'on-first-retry'`).
# To force a trace on a single run: PWTEST_TRACE=1 or temporarily set trace: 'on' in the config.

# Read the ARIA snapshot at point of failure (no rerun needed)
cat test-results/*/error-context.md
```

## Quick API smoke test (no test runner)

When you suspect the API itself, skip the test runner. Get a JWT and hit endpoints directly:

```bash
# Sign up + log in + presign in one go (token captured into $T)
EMAIL="smoke-$(date +%s)@test" && \
  curl -sf -X POST http://localhost:8080/auth/signup -H 'Content-Type: application/json' \
    -d "{\"email\":\"$EMAIL\",\"password\":\"password123\"}" > /dev/null && \
  T=$(curl -sf -X POST http://localhost:8080/auth/login -H 'Content-Type: application/json' \
    -d "{\"email\":\"$EMAIL\",\"password\":\"password123\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])') && \
  curl -sf -X POST http://localhost:8080/images/presign \
    -H "Authorization: Bearer $T" -H 'Content-Type: application/json' \
    -d '{"contentType":"image/jpeg"}'

# Reuse $T for any authenticated endpoint
curl -sf http://localhost:8080/me -H "Authorization: Bearer $T"
curl -sf http://localhost:8080/profiles/me -H "Authorization: Bearer $T"

# Public endpoints (no auth)
curl -sf http://localhost:8080/public/festivals | python3 -m json.tool | head -40
curl -sf "http://localhost:8080/festivals/slug/<slug>/map"
```

If a curl call fails, check the API log line immediately after — handlers log structured errors (`slog.Error("presign failed", ...)`).

## Container debugging cheatsheet

All commands assume CWD is the repo root (where `infra/` lives). Services: `api`, `web`, `db`, `minio`, `minio-init`, `prometheus`.

```bash
# State and health
docker compose -f infra/docker-compose.yml ps                          # which containers are up/healthy/exited
docker compose -f infra/docker-compose.yml logs api --tail=20          # one-shot tail
docker compose -f infra/docker-compose.yml logs api -f                 # follow live (Ctrl-C to stop)
docker compose -f infra/docker-compose.yml logs api 2>&1 | grep -i error | tail -20

# Force a restart when a service is wedged (e.g. air missed a change, or a build error left it on an old binary)
docker compose -f infra/docker-compose.yml restart api
docker compose -f infra/docker-compose.yml restart web

# Inspect what the container actually sees (env, network, filesystem)
docker compose -f infra/docker-compose.yml exec api env | grep -E 'MINIO|API_URL|JWT'
docker compose -f infra/docker-compose.yml exec api sh                 # shell into api container
docker compose -f infra/docker-compose.yml exec api wget -qO- http://minio:9000/minio/health/ready   # test internal network

# Postgres state (handy when an API test fails because of leftover data)
docker compose -f infra/docker-compose.yml exec db psql -U render -d render -c '\dt'
docker compose -f infra/docker-compose.yml exec db psql -U render -d render -c "SELECT id, email, role FROM users ORDER BY created_at DESC LIMIT 10;"
docker compose -f infra/docker-compose.yml exec db psql -U render -d render -c "SELECT id, slug, status FROM festivals ORDER BY created_at DESC LIMIT 10;"

# MinIO state (verify bucket policy + objects after a failed upload test)
docker compose -f infra/docker-compose.yml exec minio mc alias set local http://localhost:9000 renderdev renderdev123
docker compose -f infra/docker-compose.yml exec minio mc ls local/render-images | tail
docker compose -f infra/docker-compose.yml exec minio mc anonymous get local/render-images   # expect: "Access permission for 'local/render-images' is 'download'"

# Full reset (nuclear — destroys DB + MinIO volumes; reruns minio-init for bucket policy)
docker compose -f infra/docker-compose.yml down -v && docker compose -f infra/docker-compose.yml up -d

# Tail two services at once
docker compose -f infra/docker-compose.yml logs -f api web
```

## Hot-reload tactics

The api container runs `air`. The web container runs `next dev`. Both watch the bind-mounted source from the **main repo**.

```bash
# Confirm a Go edit actually rebuilt (look for the three-line cycle)
docker compose -f infra/docker-compose.yml logs api --tail=15 | grep -E 'changed|building|running|api starting'

# Web's compile errors don't always crash the container — check explicitly
docker compose -f infra/docker-compose.yml logs web --tail=40 | grep -iE 'error|warn|failed'

# If air is stuck on a stale binary after a half-edit, kick it
docker compose -f infra/docker-compose.yml restart api

# Clear web's .next cache when types or routing look wrong
docker compose -f infra/docker-compose.yml exec web rm -rf .next && docker compose -f infra/docker-compose.yml restart web
```

**Trap:** editing in the worktree does *not* reach the running container — the bind mount is `../api`, which resolves to the main repo. Symptom: log shows no `changed` event after your edit. Fix: apply the same edit to `/Users/adampowis/workspace/murals/<path>` and watch for the rebuild line.

## Triage flow

Run this in order — most failures fall out at step 1–3.

### Step 1 — Is the stack alive and current?

```bash
curl -sf http://localhost:8080/healthz && curl -sf http://localhost:3000 -o /dev/null -w "web: %{http_code}\n"
docker compose -f infra/docker-compose.yml logs api --tail=15
```

Look for: `failed to build`, `panic`, `database connection failed`. If you just edited Go code, look for `building... → running... → api starting` — if those didn't appear, your edit didn't reach the container (most likely: you edited the worktree, not the main repo).

### Step 2 — Read the test error before doing anything

Playwright error context lives at `test-results/<spec-name>/error-context.md` and includes the rendered ARIA snapshot at failure. Reading this is faster than re-running with `--headed`. For multi-element strict-mode violations, the error literally lists all matched elements.

API test failures: the Vitest output names the failing `it(...)` block and shows the assertion. The 18 blocks in `golden-path.test.ts` are sequential and share state (top-level `let` vars) — failure N often means step N-1 didn't produce what step N expected.

### Step 3 — Match against the known failure patterns below

## Known failure patterns

### MinIO PUT returns 403

The presigned URL signs the `Host` header (`X-Amz-SignedHeaders=host`). If the request goes out with a different host than was signed, MinIO rejects it.

- **In test helpers** (`e2e/fixtures/helpers.ts` `s3Put`, `e2e/api/golden-path.test.ts` `s3Put`): `host` header must be derived from the URL — `port ? \`${hostname}:${port}\` : hostname`. Never hardcode `minio:9000` or `localhost:9000`.
- **Don't rewrite the URL.** Old code did `uploadUrl.replace('http://minio:9000', 'http://localhost:9000')` — that's dead. `mcPublic` already signs with `localhost:9000`.

### `/images/presign` returns 500 (`duration_ms:0`)

Almost always `GetBucketLocation` failing. Confirm by tailing `api` logs and looking for `presign failed err=...connection refused`. Fix: `Region: "us-east-1"` on `mcPublic` in `api/cmd/api/main.go`. The presign endpoint has a `slog.Error("presign failed", ...)` line — if you don't see it, the request didn't reach that code path (probably 401 from auth, not 500).

### Playwright strict-mode violations ("resolved to N elements")

The error names every matched element — read them. Common cases here:
- `getByText('submitted')` matches a badge `<span>submitted</span>` and the date string `"Submitted 27 May 2026"` → `{ exact: true }`.
- `getByRole('heading', { name: 'Applications' })` matches h1 *and* an h2 panel title → `{ exact: true }`.
- `getByRole('link', { name: 'Apply' })` matches every Apply link in a list → scope first: `getByRole('listitem').filter({ hasText: 'My Festival' }).getByRole('link', { name: 'Apply' })`.

### Next.js: all pages return 500 — native module binary mismatch

Symptom: `curl http://localhost:3000` returns 500 with `Cannot find module '../lightningcss.linux-arm64-{musl|gnu}.node'`. Root cause: the `web_root_node_modules` Docker volume was wiped (`down -v`) and the empty volume is now shadowed by the host bind-mount's macOS-only binaries. The `lightningcss` package (required by `@tailwindcss/postcss`) ships platform-specific `.node` files; the macOS binary can't load in the Linux container.

Fix: rebuild the web image so Docker re-initialises the `web_root_node_modules` volume from the image's Linux binaries:
```bash
docker compose -f infra/docker-compose.yml up -d --build web
```
The volume is populated from the image on first start because the `web/Dockerfile` dev stage runs `npm ci --workspaces`.

### Web container runs the OLD dependency version after a bump (`package.json` says X, container logs say Y)

Symptom: you bump a dependency (e.g. `next` 15→16 in `web/package.json`), `docker compose up -d --build web` succeeds, but the container logs still show the old version (`▲ Next.js 15.5.18`). The bind-mounted source has the new `package.json`, yet `node_modules` resolves the old package.

Root cause: `node_modules` lives in **named volumes** (`web_root_node_modules` for hoisted workspace deps at `/workspace/node_modules`, `web_node_modules` for `/workspace/web/node_modules`). `--build` rebuilds the *image* (which runs `npm ci` with the new versions), but a **persisted named volume is only initialised from the image when it's empty** — an existing volume shadows the rebuilt image with the old `node_modules`. `--build` is therefore insufficient for a version change (it's enough for a fresh/wiped volume, the lightningcss case above).

Fix: remove the node_modules volumes (and the `.next` cache) so they repopulate from the rebuilt image, then recreate web:
```bash
docker compose -f infra/docker-compose.yml rm -sf web
docker volume rm infra_web_root_node_modules infra_web_node_modules infra_web_next
docker compose -f infra/docker-compose.yml up -d --build web
```
Verify: `docker compose logs web | grep -oE 'Next\.js [0-9.]+'` should show the new version. This does NOT touch the DB/MinIO volumes (unlike `down -v`), so no data reset.

### Next.js: all pages return 500 — dynamic import in Server Component

If `/`, `/login`, etc. all 500, look for `next/dynamic({ ssr: false })` used directly in a Server Component (a `page.tsx` without `'use client'`). The Next.js error is verbose in the web container logs: `docker compose logs web --tail=30`. Fix: extract the dynamic import into a `'use client'` wrapper component (see `web/src/app/(public)/festivals/[id]/map/FestivalMapClient.tsx` for the pattern).

When all web pages are 500, downstream symptoms include: login redirect never lands ("login still on /login"), `getByRole('heading')` timeouts on the root page, every browser spec failing with the same root URL error.

### "Festival not found" on public pages

`api/internal/festival/festival.go GetHandler` gates anonymous access. The publicly-visible statuses are `open` AND `live` (artists need to see `open` festivals to apply; the map only renders for `live`). If a test publishes to `open` and the public GET 404s, that gate has regressed.

### Server-side fetch from Next.js fails with `ECONNREFUSED`

A server component using `process.env.NEXT_PUBLIC_API_URL` will try `http://localhost:8080` from inside the web container — nothing there. Server-side code must prefer `API_URL` (set to `http://api:8080` in compose):

```ts
const apiUrl = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'
```

Audit: `lib/auth-server.ts`, any `page.tsx` doing `fetch()`. Client components keep using `NEXT_PUBLIC_API_URL`.

### Application submits but API rejects answers

`web/src/components/DynamicForm.tsx` must key answers by `field.id` (with `field.label` as fallback). The API validates `answers[field.id]`. If you ever see a form submission "succeed" client-side but `submit application` 422s with missing required fields, the form is keying by `label`.

### `Login failed: 429` across many tests when running the full suite

Symptom: Many tests in different files fail simultaneously with `Login failed: 429` — the error comes from the `createUser` helper throwing when `/auth/login` returns 429.

Root cause: The test stack's rate limit burst (`LOGIN_RATE_LIMIT_BURST`) is exhausted by too many concurrent `/auth/login` calls across parallel Vitest workers. With 16 files running in parallel, the combined login load can exceed the burst even within a few seconds.

**Step 1 — confirm the running config:**
```bash
docker compose -f infra/docker-compose.yml exec api env | grep RATE
# Should show: LOGIN_RATE_LIMIT_BURST=200, LOGIN_RATE_LIMIT_PER_MIN=300
# If lower, update docker-compose.yml and recreate the container:
docker compose -f infra/docker-compose.yml up -d --no-deps api
```

**Step 2 — check new test files for unnecessary login calls:**

Only call `/auth/login` (via `createArtist` / `createOrganiser`) when you're testing the login flow itself or need a real session token with a known `session_version`. For any other test — IDOR checks, auth rejection, input validation — use `signupAndMint` instead:

```typescript
// signupAndMint: signup (not rate-limited) + DB query + signHS256
// Requires a pg Client (copy the pattern from admin-auth.test.ts or billing-guards.test.ts)
const email = `test-${suffix}@e2e.test`
await fetch(`${API}/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password: 'testpass123' }) })
const { rows } = await db.query<{ id: string; session_version: number }>(
  'SELECT id, session_version FROM users WHERE email = $1', [email])
const { id: userId, session_version: sv } = rows[0]
const now = Math.floor(Date.now() / 1000)
const token = signHS256({ sub: userId, sv, iat: now, exp: now + 3600 }, JWT_SECRET)
```

`signHS256` is defined identically in `auth-edge-cases.test.ts`, `admin-auth.test.ts`, and `admin-promo.test.ts`. Copy it into any new file that needs it — do not add it to `helpers.ts` since it requires a DB client and `JWT_SECRET` which are file-local concerns.

The `signupAndMint` token is valid for auth middleware (sv matches the DB) and becomes invalid after `resetPassword` (sv is bumped). The only case where you need a real login is when the test is asserting the login flow itself.

### Map test can't find the spot panel

`MapEditorClient.tsx` (organiser map editor) renders a custom side panel with `[data-testid="spot-panel"]`, never `.leaflet-popup`. Markers do use Leaflet `<Popup>` for a brief hover tooltip, but the full edit panel is `spot-panel`.

### Chi route order: literal segment parsed as UUID parameter → 400

Symptom: `POST /festivals/{id}/applications/reorder` returns 400 with an "invalid UUID" error message.

Root cause: chi matches routes top-to-bottom within a group. If `/applications/{applicationID}` is registered before `/applications/reorder`, chi parses the literal string `"reorder"` as the `{applicationID}` parameter and the handler's UUID parse fails.

Fix: in `api/cmd/api/main.go`, register every literal sub-path **before** the parameterized one:

```go
r.Post("/applications/reorder", ...)    // must come FIRST
r.Post("/applications/{applicationID}/waitlist", ...)
r.Patch("/applications/{applicationID}", ...)
```

Any time you add a new literal path alongside an existing `{id}` route, check the registration order.

### sqlc scan mismatch: new DB columns silently return zero values

Symptom: a migration added columns (e.g. `rank`, `shortlisted`, `review_flag`) and `task api:test` passes, but the API JSON response shows those fields as `0` / `false` regardless of what's in the DB.

Root cause: the sqlc-generated `*.sql.go` SELECT queries and `row.Scan()` calls were not updated after the migration. The struct has the new fields, but the SELECT doesn't list them and Scan() doesn't fill them — they silently stay at zero values.

Fix: `task db:generate` to regenerate all queries, then grep-verify (per `sqlc-and-schema.md`):

```bash
# Both counts must equal the number of columns in the table
grep -c '&i\.' api/internal/sqlcdb/applications.sql.go
```

If `task db:generate` isn't available (worktree, no sqlc binary), hand-edit every SELECT column list and every `row.Scan()` in every `*.sql.go` that touches the affected table, then run the grep check.

**Canary:** write an e2e test that asserts the new field appears in the API response with a non-zero value after inserting a non-zero value. Unit tests with pre-seeded state won't catch this — they never scan the column.

### Endpoint returns 500 with `duration_ms:0` — missing DB migration on dev stack

Symptom: a specific endpoint (e.g. `POST /collections`) returns 500 with `duration_ms:0` in the API logs immediately after a migration was merged. Other endpoints on the same table may work fine; only calls that touch the new columns fail.

Root cause: the sqlc-generated queries reference columns that don't exist in the running DB because the migration hasn't been applied since the last `task up`. The query fails at the Postgres layer before any handler logic runs, hence 0ms.

Diagnose:

```bash
docker compose -f infra/docker-compose.yml exec db psql -U render -d render \
  -c "SELECT version, dirty FROM schema_migrations ORDER BY version DESC LIMIT 5;"
```

If the latest version is lower than the highest-numbered migration file in `db/migrations/`, the migration is missing. Run `task db:migrate`.

If `task db:migrate` reports "no change" but the 500 persists, the column may literally be absent — verify:

```bash
docker compose -f infra/docker-compose.yml exec db psql -U render -d render \
  -c "\d <table_name>" | grep <column_name>
```

### `task db:migrate` fails with "column already exists" — dirty migration state

Symptom: `task db:migrate` errors with `column "X" of relation "Y" already exists` but `SELECT * FROM schema_migrations` shows an earlier version (or dirty=true).

Root cause: a previous migration run applied the `ALTER TABLE` but crashed before updating the tracking row, leaving the row as `dirty=true`. The column now exists in the DB but the tracker thinks the migration needs to re-run — and re-running the same `ALTER TABLE` fails.

Fix — three steps:

1. Verify the column actually exists: `\d <table>` in psql.
2. If it does, mark the migration clean: `UPDATE schema_migrations SET dirty = false WHERE version = N;`
3. Re-run: `task db:migrate` — it will skip the now-clean migration and apply anything higher.

If the column is missing (genuinely partial failure), drop the partial state manually and re-run the migration from scratch.

### Order-dependent tests fail intermittently in the parallel suite — same-millisecond `created_at`

Symptom: a test that asserts a specific sort order (e.g. "collection A comes before collection B") passes consistently in isolation but fails occasionally when the full suite runs 20 files in parallel.

Root cause: rows with the same default `display_order = 0` are ordered by `(display_order, created_at)`. Under parallel load the two rows can land in the same millisecond, making the tiebreaker non-deterministic.

Fix: never assert the *default* creation order in a test that depends on it. Instead, explicitly set the desired order via the reorder endpoint first, confirm it, then assert:

```typescript
// BAD — assumes creation order; flaky under parallel load
const { collectionId: idA } = await createCollection(token, { name: 'A' })
const { collectionId: idB } = await createCollection(token, { name: 'B' })
const before = await getCollections(profileId)
expect(before[0].id).toBe(idA) // may fail if A and B share the same created_at ms

// GOOD — set known state first, then flip it
await reorderCollections(token, [idA, idB])  // known state
const before = await getCollections(profileId)
expect(before[0].id).toBe(idA)
await reorderCollections(token, [idB, idA])  // flip
const after = await getCollections(profileId)
expect(after[0].id).toBe(idB)
```

This applies to any endpoint that orders by a default-zero column combined with `created_at`.

### `toBeVisible` fails on a `truncate` cell that resolves but is "hidden" under load

Symptom: `expect(getByText('X').first()).toBeVisible()` fails with `Received: hidden`, yet the error log shows `N × locator resolved to <div class="… truncate">X</div>` — the element is present in the DOM with the right text, but reports hidden for the full timeout. Flaky: passes locally / in isolation, fails under the full parallel suite (and failed on `main`, not just a feature branch).

Root cause: `truncate` is `overflow:hidden; white-space:nowrap`. When that element sits in a flex cell with `min-w-0` inside a multi-column grid (e.g. the 5-column applications board card, `ApplicationCard.tsx`), the cell can momentarily compute to zero usable width under CI's slower headless layout → zero bounding box → Playwright treats it as hidden, even though the text is rendered. `.first()` makes it worse by always selecting that fragile card over a more robust match.

Fix: assert a non-truncated, top-layer instance of the same text instead of the card cell. For the applications board the slide-over panel renders the name as `<h2>` (`ApplicationSlideOver.tsx`) — `getByRole('heading', { name })` is deterministic (font-serif, `max-w-lg z-50`, never zero-size). Seen in `anonymous-review.spec.ts:98` ("identity revealed" after scoring). Don't reach for `.first()` on body text when a heading/role-scoped locator expresses the same intent.

### `mfa-login` flakes locally (never on CI) — 401 on `/auth/mfa/confirm`

Symptom: `mfa-login.spec.ts` fails on `expect(confirm.status).toBe(200)` with a 401, **only when run locally under the full parallel suite** — `✓` on every Linux CI run.

Root cause: NOT the server. `pquerna/otp`'s `totp.Validate` already defaults to `Skew: 1` (tolerates the previous/current/next 30s window, ±30s). The client generates a code from the **host** clock; the API validates against the **container** clock. On a CPU-saturated macOS Docker Desktop VM the container clock transiently lags the host far enough to push the code outside the ±30s window. Linux CI shares one kernel clock between host and container, so it cannot reproduce.

Diagnose: `H=$(date -u +%s); C=$(docker compose -f infra/docker-compose.yml exec -T api date -u +%s); echo $((H-C))` — a non-trivial delta confirms drift (it self-corrects when load eases, so measure during/after a heavy run).

Fix: this is environmental, not a product or server bug — do NOT change the server skew. Make the test absorb transient drift with a bounded retry that regenerates a fresh code and spaces attempts out (so the clocks re-converge), rather than a single-shot retry. See the `confirmMFA` loop in `mfa-login.spec.ts`. If a 401 persists across several spaced retries, that's a real >30s clock offset worth fixing in the environment.

### Public collection/profile 404s right after publishing — snapshot froze without the content

Symptom: a test (or fixture) creates a collection, publishes the profile, then a public GET of that collection's page 404s even though the owner can see it. Often surfaces as an intermittent fixture/setup failure rather than a product test.

Root cause: publishing **freezes a snapshot** of the profile + collections at that instant (`api/internal/artist/snapshot.go`, seeded on the draft→public transition; public reads go through the snapshot, owner reads go live). Content added *after* publish is a draft addition — invisible to the public until the artist re-snapshots via `POST /profiles/me/publish-changes`. So "create collection → publish → public 404" is the model working as designed, not a bug.

Fix in test setup: create everything the public path needs **before** the publish (see `scripts/ui-health/sweep.ts buildFixtures` — the collection is created before `publishProfile`), or call `publish-changes` after adding content. Never assert a public view of content added post-publish without re-publishing.

## Test data conventions

- **Unique suffixes.** Every spec generates `const suffix = Date.now()` and uses it in emails (`artist-${suffix}@e2e.test`), slugs, names. Don't ever hardcode — the DB persists across runs, so reruns must not collide.
- **`createArtist` / `createOrganiser`** in `helpers.ts` sign up + log in and return `{ token, userId, email, password }`. The browser specs use `loginAs(browser, email, password, baseURL)` to start a fresh authenticated browser context.
- **`uploadImage(token, collectionId)`** does the full 5-step S3 dance: presign → PUT MinIO → confirm → attach → set as collection cover. If image-related tests fail, check whether step 1 (presign 500), step 2 (PUT 403), or step 6 (cover not visible on public page) is the actual failure.
- **MinIO bucket is `anonymous set download`** (see `infra/docker-compose.yml` `minio-init`). The browser can `GET` images without auth.
- **Publishing a profile is gated — `publishProfile(token)` self-grants.** Draft→public is gated behind an active subscription or comp grant (`api/internal/artist/profile.go` → `billing.CanPublish`); a bare visibility PATCH 402s. The `publishProfile()` helper now first calls the test-only `POST /_test/grant` backdoor (mints a 24h `artist_basic` grant for the calling Bearer principal, `billing.GrantTestHandler`) then flips visibility — so any caller gets a working publish via one fetch. Browser specs that don't use the helper bypass the gate another way: `forcePublish(db, userId)` in `fixtures/db-helpers.ts` writes the grant straight to the DB. Don't hand-roll the admin `/admin/users/{id}/grants` dance in a new test just to publish.

## Editing this file

When you discover a new failure pattern or a non-obvious cause, add it under "Known failure patterns" with: the symptom (exact error message excerpt), the root cause in one sentence, and the fix (file:line where possible). Keep the triage flow lean — three steps, not ten. If a section grows stale (e.g., the dual-MinIO-client design is replaced), update or delete it; don't leave fossils.
