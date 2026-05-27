# E9 — E2E Test Suite Design

**Date:** 2026-05-27
**Status:** Approved
**Project:** Render — Paint Festival Platform
**Epic:** [#9](https://github.com/sniffins-mcmuggins/murals/issues/9)
**Depends on:** E7 complete (all web pages live), E1–E6 complete (full API)

---

## Purpose

Define the end-to-end test suite that verifies the Phase 1 golden path against the running docker-compose stack. Two layers: a fast HTTP-level API gate (Vitest, no browser) and a full browser suite (Playwright). Both wire into CI.

---

## Architecture

Two separate runners, one `e2e/` directory:

```
e2e/
  api/
    golden-path.test.ts        # Vitest — HTTP only, full happy path
  browser/
    artist-onboarding.spec.ts  # Playwright
    organiser-setup.spec.ts    # Playwright
    application-flow.spec.ts   # Playwright
    public-visitor.spec.ts     # Playwright
  fixtures/
    helpers.ts                 # shared API setup functions
    test.jpg                   # 1×1 JPEG for upload tests
playwright.config.ts           # root — browser tests only
vitest.e2e.config.ts           # root — API tests only
```

**Why two runners:** The API tests need no browser — running them through Playwright adds overhead and prevents using them as a fast CI gate before spinning up Chromium. Vitest is already in the project; adding a root-level config for `e2e/api/` costs nothing.

**Compose as precondition:** Neither runner manages the stack. Both assume `task up` + `task db:migrate` have run. `playwright.config.ts` has no `webServer` block.

---

## Config

### `playwright.config.ts`

```ts
export default defineConfig({
  testDir: './e2e/browser',
  baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})
```

### `vitest.e2e.config.ts`

```ts
export default defineConfig({
  test: {
    include: ['e2e/api/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    reporters: ['verbose'],
  },
})
```

### Taskfile additions (root `Taskfile.yml`)

```yaml
e2e:api:
  desc: "Run API e2e tests (requires stack to be up)"
  cmd: npx vitest run --config vitest.e2e.config.ts

e2e:
  desc: "Run all e2e tests — API gate first, then browser (requires stack to be up)"
  cmds:
    - task: e2e:api
    - npx playwright test
```

---

## Test data strategy

All tests that write data create their own state via API calls — no reliance on seed data. This keeps tests isolated and repeatable regardless of database state.

**`e2e/fixtures/helpers.ts`** provides:

```ts
const API = process.env.API_URL ?? 'http://localhost:8080'

createArtist(suffix?)            → { token, userId, email, password }
createProfile(token, opts)       → { profileId }
createOrganiser(suffix?)         → { token, userId, email, password }  // same signup endpoint as artist
createFestival(token, opts)      → { festivalId, slug }
setFestivalStatus(token, id, status) → void  // status: "open" | "live" | "archived"
upsertForm(token, id)            → void   // adds 1 text field
uploadImage(token, collectionId) → { imageId, cdnUrl }  // presign → PUT → confirm
acceptArtist(token, festivalId, appId) → void
setPin(token, festivalId, artistId, lat, lng) → void
```

Each helper is a thin async function making fetch calls to `API`. No test framework imports — usable from both Vitest and Playwright `beforeAll` hooks.

---

## Test scenarios

### `e2e/api/golden-path.test.ts`

Single Vitest `describe`, sequential steps sharing state via local variables. Target: <15s.

```
1.  POST /auth/signup            → artist
2.  POST /profiles               → artist profile
3.  POST /collections            → collection
4.  POST /images/presign         → presigned PUT URL
5.  PUT  <presignedUrl>          → upload 1×1 JPEG to MinIO
6.  POST /images/confirm         → cdnUrl
7.  POST /collections/{id}/images → attach image
8.  GET  /profiles/{id}/collections → assert collection + image present
9.  POST /auth/signup            → organiser
10. POST /festivals               → festival
11. PUT  /festivals/{id}/form     → upsert form (1 text field)
12. PATCH /festivals/{id}         → status: "open"
13. POST /festivals/{id}/apply    → artist submits (re-auth as artist)
14. GET  /festivals/{id}/applications → organiser sees 1 pending
15. POST .../applications/{id}/accept → accept
16. GET  /festivals/{id}/artists/accepted → artist in list
17. PATCH /festivals/{id}/artists/{id}/pin → lat: 51.9, lng: -2.07
18. GET  /festivals/slug/{slug}/map → pin present in response (unauthenticated)
19. GET  /public/festivals        → festival in public list
20. GET  /profiles/{id}           → public profile accessible (unauthenticated)
```

Assertions: HTTP status + key response fields at each step. Uses the generated TS client types for type safety.

---

### `e2e/browser/artist-onboarding.spec.ts`

**`beforeAll` (API):** none — signs up fresh via UI to test the signup flow itself.

**Steps:**
1. Navigate `/signup` → fill email + password → submit → land on `/dashboard`
2. Click "Profile" → fill display name + bio → save → success feedback visible
3. Click "Collections" → "New collection" button → fill name → create → collection in list
4. Click collection → upload `fixtures/test.jpg` via `page.setInputFiles('[type=file]', ...)` → image thumbnail appears
5. Navigate to `/artists/{profileId}` (unauthenticated context) → display name + collection image visible

**Blocked by:** #70 (Playwright config)

---

### `e2e/browser/organiser-setup.spec.ts`

**`beforeAll` (API):** none — signs up fresh via UI.

Note: there is no separate organiser signup — any user can access organiser routes. The test signs up with a standard email/password form and then navigates to `/organiser/dashboard`.

**Steps:**
1. Navigate `/signup` → fill email + password → submit → land on `/dashboard` → navigate to `/organiser/dashboard`
2. Click "Festivals" → "New festival" → fill name + slug + description → Create
3. Click into festival → set up application form (add 1 text field) → save
4. Update festival status to `open`
5. Navigate to `/festivals/{id}` (public) → assert festival name + open status visible

**Blocked by:** #70

---

### `e2e/browser/application-flow.spec.ts`

**`beforeAll` (API):** `createArtist` + `createProfile`, `createOrganiser` + `createFestival` + `upsertForm` + `openFestival`. Store tokens + IDs.

**Artist steps:**
1. Login as artist → `/applications` → festival visible in "Open festivals"
2. Click Apply → DynamicForm renders → fill answer → Submit → success message
3. Applications list shows the festival with `submitted` badge

**Organiser steps (new page context):**
1. Login as organiser → `/organiser/festivals/{id}/applications` → 1 pending application
2. Click Accept → badge flips to `accepted`

**Map editor steps (organiser):**
1. Navigate `/organiser/festivals/{id}/map` → map renders
2. Click on map location → PlacePinPanel appears → select artist → fill W3W (`three.word.address`) → Save
3. API assert: `GET /festivals/slug/{slug}/map` returns pin with correct artist (fetch in test, no extra page nav)

**Blocked by:** #70

---

### `e2e/browser/public-visitor.spec.ts`

**`beforeAll` (API):** full setup via helpers:
1. `createArtist` + `createProfile` + `createCollection` + `uploadImage`
2. `createOrganiser` + `createFestival` + `upsertForm` + `setFestivalStatus(open)`
3. Artist submits application (`POST /festivals/{id}/apply`)
4. `acceptArtist` + `setPin`
5. `setFestivalStatus(live)` — map endpoint only returns pins for live festivals

**Steps (unauthenticated throughout):**
1. Navigate `/festivals/{id}` → festival name + dates visible
2. Click "View map" → `/festivals/{id}/map` → Leaflet map renders (`.leaflet-container` visible)
3. Assert at least one marker present in DOM (`.leaflet-marker-icon`)
4. Click marker → popup appears with artist display name
5. Click artist link in popup → `/artists/{profileId}` loads → collection image visible

**Blocked by:** #70, #73

---

## CI integration

Replace the placeholder e2e job in `.github/workflows/ci.yml`:

```yaml
e2e:
  needs: [api, web]
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with: { node-version: '20' }
    - run: npm ci
    - run: task up
    - name: Wait for healthz
      run: timeout 90 bash -c 'until curl -sf http://localhost:8080/healthz; do sleep 3; done'
    - run: task db:migrate
    - run: task e2e:api
    - run: npx playwright install --with-deps chromium
    - run: task e2e
    - uses: actions/upload-artifact@v4
      if: failure()
      with:
        name: playwright-report
        path: playwright-report/
```

---

## Implementation order

1. **#70** — Playwright config + vitest.e2e.config.ts + helpers.ts scaffold + test.jpg + Taskfile additions
2. **#75** — `golden-path.test.ts` (API e2e, immediately runnable)
3. **#71** — `artist-onboarding.spec.ts`
4. **#72** — `organiser-setup.spec.ts`
5. **#73** — `application-flow.spec.ts` (depends on #71, #72 patterns being established)
6. **#74** — `public-visitor.spec.ts` (depends on #73 helpers being available)
7. **#76** — CI wiring

---

## Definition of done

- [ ] `task e2e:api` passes against running compose stack
- [ ] `task e2e` passes against running compose stack
- [ ] All 4 browser specs pass in CI (chromium)
- [ ] Playwright HTML report uploads on failure
- [ ] `task lint` passes
