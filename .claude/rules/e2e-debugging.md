# E2E Test Debugging

When working on e2e failures, load: @e2e/fixtures/helpers.ts @e2e/api/golden-path.test.ts @e2e/browser/application-flow.spec.ts @e2e/browser/artist-onboarding.spec.ts @e2e/browser/organiser-setup.spec.ts @e2e/browser/public-visitor.spec.ts @playwright.config.ts @vitest.e2e.config.ts @infra/docker-compose.yml

## How the suite is wired

Two runners, one Compose stack. Stack must be running first — neither runner manages it.

| Layer | Runner | Files | Command |
|---|---|---|---|
| API gate | Vitest | `e2e/api/golden-path.test.ts` (one file, 18 sequential `it(...)`) | `task e2e:api` |
| Browser | Playwright (Chromium only) | `e2e/browser/*.spec.ts` (4 specs, parallel by file) | `npx playwright test` |
| Both, in order | — | API gate then browser | `task e2e` |

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

# Single Vitest block (golden-path uses sequential `it()` blocks)
npx vitest run e2e/api/golden-path.test.ts -t "presign"
npx vitest run e2e/api/golden-path.test.ts -t "8\\."    # by number prefix

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

### Next.js: all pages return 500

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

### Map test can't find the pin popup

`FestivalMap.tsx` doesn't use Leaflet's built-in `Popup` — it renders a custom side panel. The selector is `[data-testid="map-pin-panel"]`, never `.leaflet-popup`.

## Test data conventions

- **Unique suffixes.** Every spec generates `const suffix = Date.now()` and uses it in emails (`artist-${suffix}@e2e.test`), slugs, names. Don't ever hardcode — the DB persists across runs, so reruns must not collide.
- **`createArtist` / `createOrganiser`** in `helpers.ts` sign up + log in and return `{ token, userId, email, password }`. The browser specs use `loginAs(browser, email, password, baseURL)` to start a fresh authenticated browser context.
- **`uploadImage(token, collectionId)`** does the full 5-step S3 dance: presign → PUT MinIO → confirm → attach → set as collection cover. If image-related tests fail, check whether step 1 (presign 500), step 2 (PUT 403), or step 6 (cover not visible on public page) is the actual failure.
- **MinIO bucket is `anonymous set download`** (see `infra/docker-compose.yml` `minio-init`). The browser can `GET` images without auth.

## Editing this file

When you discover a new failure pattern or a non-obvious cause, add it under "Known failure patterns" with: the symptom (exact error message excerpt), the root cause in one sentence, and the fix (file:line where possible). Keep the triage flow lean — three steps, not ten. If a section grows stale (e.g., the dual-MinIO-client design is replaced), update or delete it; don't leave fossils.
