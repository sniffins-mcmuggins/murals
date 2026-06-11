# Web Codebase Audit — maintainability & robustness

**Date:** 2026-06-10
**Scope:** `web/src/**` audited against `.claude/rules/web-frontend.md`, the route-group specs, and general React/Next.js best practice.
**Baseline:** 182 unit tests passing (30 files), `tsc --noEmit` clean, 13 ESLint warnings (all `@next/next/no-img-element`), zero `any` types, zero raw hex outside Leaflet markers. The stack runs and key pages were spot-checked live with Playwright.

## PR Status

| PR | Branch | Status | Covers |
|---|---|---|---|
| **PR 1** | `refactor/web-lib-foundations` | ✅ **Merged — #297** | lib consolidation, DRY, error robustness (see below for detail) |
| **PR 2–4** | `refactor/web-pr2-4-spec-structure-tests` | ✅ **Done (one PR)** | OpenAPI spec gaps + raw-fetch migration; structure refactors; testing — see "PR 2–4 — completed" below |

### PR 2–4 — completed (2026-06-11)

Bundled into one PR on `refactor/web-pr2-4-spec-structure-tests`. Resolved findings:

- **2.1 / 2.2** — Added 11 missing endpoints (billing ×3, `/me/summary`, beta ×3, MFA verify, email verify/resend) to `openapi/openapi.yaml` + schemas; regenerated client & Go interface (`task openapi:gen`). Migrated all 9 raw-fetch call sites to the typed client; deleted `dashboard/page.tsx`'s hand-rolled entity types (now `components['schemas']`). Only justified raw fetch left: external presigned-PUT in `useImageUpload`.
- **4.1** — `MapEditorClient.tsx` (804→509 lines) split into `mapIcons.ts`, `mapHelpers.tsx`, `SpotPanel.tsx`.
- **4.2** — `useApplicationReview(festivalId)` extracts the applications board's 4 queries + 7 mutations + optimistic state; the page is now layout + handlers.
- **4.3** — `MfaForm.tsx` extracted from the login page.
- **4.5** — Leaflet marker hexes now named constants in `mapIcons.ts`.
- **5.1** — `@vitest/coverage-v8` added (reporting only, no gate; `npm run test:coverage`). New tests: `middleware.ts` (9), apply page (5). Dead `useApplicationReorder` hook deleted (the audit's "3 hooks" list was stale post-PR1: two merged into `useImageUpload` which is already tested).
- **5.2 / 5.3** — Both fragile files (`organiser/applications-page`, `app-artist/collection-detail-page`) rewritten onto a real `QueryClientProvider` + `@/lib/api` boundary mock (`__tests__/helpers/query.tsx`); Tailwind-class assertions dropped.
- **5.4 / 5.5** — `__tests__/artist`→`app-artist`, `__tests__/artists`→`app-public-artists`; 3 colocated `lib/*.test.ts` moved under `__tests__/lib/`.

**Post state:** 200 unit tests passing (38 files), typecheck clean, lint unchanged (13 pre-existing `no-img-element` warnings). `.claude/rules/web-frontend.md` updated with all of the above as durable guidance.

### PR 1 — completed (2026-06-11)

All work is on `refactor/web-lib-foundations`, merged into a single PR (#297). The following audit findings are **resolved**:

- **1.1** (silent error swallowing) — all 6 `queryFn`s now throw; `isError` UI added to all affected pages. Apply page preserves `null` on 404 (no-profile) but throws on real errors.
- **1.2** (no error boundaries) — `app/error.tsx` + `app/global-error.tsx` created.
- **1.3** (inconsistent mural colours) — `lib/murals.ts` with `muralStatusColour()`; both maps unified on `#E2DDD6` (`--color-light`).
- **1.4** (favicon 404) — `app/icon.svg` added (paint-drop brand icon).
- **2.3** (cookie-injection copy-paste ×6) — `createAuthedServerClient()` exported from `lib/auth-server.ts`; 4 pages migrated. Also fixed `profile/preview/page.tsx` returning `null` on missing profile instead of `redirect('/profile/setup')`.
- **2.4** (env fallback duplicated ×15) — `apiBaseUrl`/`publicApiBaseUrl` exported from `lib/api.ts`.
- **2.5** (module-level clients in endorse pages) — both pages migrated to singleton `apiClient`.
- **3.1** (upload hook duplication) — `hooks/useImageUpload.ts` merges both hooks; old hooks deleted; 4 tests.
- **3.2** (collection status maps duplicated) — `lib/collections.ts` with `COLLECTION_STATUS_LABELS`/`COLLECTION_STATUS_BADGES`.
- **3.3** (festival status maps duplicated) — `lib/festivals.ts` with labels + badge/text variants.
- **3.4** (date formatting duplicated ×5) — `lib/dates.ts` with `formatDate`/`formatDateRange`; UTC-shift bug fixed.
- **4.4** (useEffect fetching in endorse pages) — both pages migrated to React Query.

**Post-PR 1 state:** 196 unit tests passing (34 files), typecheck clean, lint unchanged (13 pre-existing `no-img-element` warnings).

---

The codebase is in good shape overall — typed client discipline is mostly followed, Server/Client component split is correct everywhere I checked, design tokens are used consistently. The findings below are ranked by how much they threaten maintainability/robustness, not by effort.

---

## 1. Critical / correctness

### ✅ 1.1 Silent error swallowing — API failures render as empty states *(done — PR 1)*
Six query functions return `[]` when the API errors, making "backend down" indistinguishable from "no data":

| Location | Effect on user |
|---|---|
| `app/organiser/reviewing/page.tsx:15` | reviewer sees "no festivals" |
| `app/organiser/dashboard/page.tsx:15` | organiser sees empty dashboard |
| `app/organiser/festivals/[id]/ReviewersSection.tsx:59` | reviewers list silently empty |
| `app/(artist)/applications/apply/[id]/page.tsx:72` | collections picker empty |
| `app/(artist)/applications/page.tsx:30,41` | "no applications" on API failure |

Only 2 files in the whole app (`MapEditorClient`, organiser applications page) handle `isError`. **Fix:** throw from `queryFn` on `res.error` and render `query.isError` distinctly from the empty state. This is the single biggest robustness win available.

### ✅ 1.2 No `error.tsx` anywhere — unhandled errors show the raw Next.js error screen *(done — PR 1)*
There are zero `error.tsx` / `global-error.tsx` files in `app/`. Any throw in a Server Component (e.g. the API being briefly unreachable during `apiClient.GET` in a public page) gives the default unstyled "Application error" screen. Only the three public `[id]` routes have `not-found.tsx`. **Fix:** add a branded `app/error.tsx` (and ideally one per route group) plus `app/global-error.tsx`. Cheap, high-polish-value before any demo.

### ✅ 1.3 Duplicated *and inconsistent* mural-status colour logic *(done — PR 1)*
The same status→colour mapping exists in two places with **different values for `unknown`**:

- `app/organiser/festivals/[id]/map/MapEditorClient.tsx:733` → `'#E2DDD6'`
- `app/(public)/artists/[id]/MuralMap.tsx:36` → `'#C0BDB8'` (not a design token at all)

An organiser and a visitor see different colours for the same data. **Fix:** one exported map in `lib/murals.ts` (values referencing the design-token hexes), imported by both.

### ✅ 1.4 No site favicon — every page load 404s *(done — PR 1)*
`public/` contains only `favicons/` (social-link icons); there is no `app/icon.png`, no `favicon.ico`, no `icons` metadata in `layout.tsx`. Confirmed live: every page logs `Failed to load resource: 404 /favicon.ico`. Trivial fix, and embarrassing in a demo otherwise.

---

## 2. Standards violations (`web-frontend.md`)

### ⬜ 2.1 Raw `fetch` to our API in 9 files — root cause is an incomplete OpenAPI spec *(PR 2)*
The rule says "never hand-write fetch", but most violations exist because **the endpoints are missing from `openapi/`** — the typed client literally can't call them. Endpoints absent from the generated client:

```
/billing/artist/checkout        /billing/organiser/setup-checkout
/billing/portal                 /me/summary
/beta/me/invites                /beta/feedback
/beta/invites                   /auth/mfa/verify
/auth/verify-email              /auth/resend-verification
```

Raw-fetch call sites:

| File | Endpoints | Verdict |
|---|---|---|
| `app/(artist)/billing/page.tsx:42,72` | billing checkout/portal | spec gap |
| `app/organiser/billing/page.tsx:15,46` | billing setup/portal | spec gap |
| `app/dashboard/page.tsx:46,57` | `/me/summary`, `/beta/me/invites` | spec gap |
| `app/(auth)/login/page.tsx:95` | `/auth/mfa/verify` | spec gap |
| `app/(auth)/signup/page.tsx:80` | `/auth/resend-verification` | spec gap |
| `app/(auth)/verify-email/page.tsx:22` | `/auth/verify-email` | spec gap |
| `components/BetaFeedbackWidget.tsx:25`, `BetaInviteCard.tsx:27` | beta endpoints | spec gap |
| `components/SocialLinks.tsx:12` | `/profiles/{id}/link-click` | **in spec** — migrate now (openapi-fetch accepts `keepalive` via fetch init) |
| `hooks/useUploadImage.ts:22`, `useProfileImageUpload.ts:22` | presigned MinIO/S3 PUT | **justified** — external URL, not our API |

**Fix (two steps):** (1) add the missing endpoints to the OpenAPI spec and regenerate (`task openapi:gen`) — this also benefits the Go API's spec completeness; (2) migrate the call sites. Until then, every billing/beta/MFA request body and response is untyped and invisible to the drift check.

### ⬜ 2.2 `dashboard/page.tsx` hand-declares entity types *(PR 2 — unlocked by fixing 2.1)*
`app/dashboard/page.tsx:11-44` declares its own `ArtistProfile`, `Festival`, `Summary`, `BetaInvite`, `MyInvitesResponse` instead of `components['schemas'][…]`. Partly forced by the spec gaps above — fixing 2.1 unlocks deleting these. Until then they will silently drift from the API.

### ✅ 2.3 The cookie-injected server client is copy-pasted 6× *(done — PR 1)*
The identical ~8-line block (createApiClient + `process.env.API_URL ?? …` + `.use({ onRequest })` cookie middleware) appears in:

- `lib/auth-server.ts:32-42` and again at `lib/auth-server.ts:84-92`
- `app/(artist)/profile/page.tsx:15-23`
- `app/(artist)/profile/preview/page.tsx`
- `app/(artist)/profile/setup/page.tsx`
- `app/(artist)/analytics/page.tsx`

**Fix:** export `createAuthedServerClient(): Promise<Client | null>` from `lib/auth-server.ts` and use it everywhere, including internally. One place to get the cookie name, header, and base URL right.

### ✅ 2.4 The env fallback expression is duplicated ~15× *(done — PR 1)*
`process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'` (or the client-side variant) is hand-written in 15 files. `lib/api.ts` already computes the correct one — but doesn't export it. **Fix:** `export const apiBaseUrl` from `lib/api.ts`; replace every hand-rolled fallback. This also removes the risk someone copies the client-side variant into server code (the ECONNREFUSED trap the rule warns about — no live instance found, but the duplication invites it).

### ✅ 2.5 Two client pages build their own API clients instead of the singleton *(done — PR 1)*
`app/(artist)/endorse/[profileID]/page.tsx:10` and `app/(artist)/endorsements/page.tsx:9` each `createApiClient({ baseUrl: NEXT_PUBLIC… })` at module scope. They're `'use client'` so it works, but it bypasses the one place client config lives. **Fix:** `import { apiClient } from '@/lib/api'`.

---

## 3. DRY improvements

### ✅ 3.1 `useUploadImage` vs `useProfileImageUpload` — same choreography, fork-maintained *(done — PR 1)*
Both hooks implement presign → PUT → confirm with identical state machine, error handling, and content-type cast; they differ only in the post-confirm step (attach-to-collection vs callback). A diff shows ~80% line-identical. **Fix:** one `useImageUpload(onUploaded: (cdnUrl, s3Key) => Promise<void> | void)`; implement the collection-attach as a caller-supplied `onUploaded`. Any future change (e.g. content-type validation, retry) currently has to be made twice — this is exactly how the two mural colour maps diverged.

### ✅ 3.2 Collection status label/colour maps duplicated *(done — PR 1)*
- `app/(public)/artists/[id]/collections/[collectionId]/page.tsx:13-23` (module scope)
- `app/(public)/artists/[id]/page.tsx:91-95` (re-created **inside the component body** each render — also an inconsistency of style)

**Fix:** `lib/collections.ts` exporting `COLLECTION_STATUS_LABELS` / `COLLECTION_STATUS_COLOURS`.

### ✅ 3.3 Festival status maps duplicated *(done — PR 1)*
`app/organiser/festivals/page.tsx:12` and `app/(public)/festivals/[id]/page.tsx:60,67` both define festival `STATUS_COLORS`/`STATUS_LABELS`. Same fix: `lib/festivals.ts`.

### ✅ 3.4 Date formatting hand-rolled in 5 places *(done — PR 1)*
`toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })` appears in:
`(artist)/applications/page.tsx:17`, `(public)/festivals/[id]/page.tsx:27,37` (two variants), `components/ApplicationNotes.tsx:16`, `organiser/.../applications/page.tsx:509` (inline). **Fix:** `lib/dates.ts` with `formatDate` / `formatDateRange`. The festival page's range logic (`formatDates`) is genuinely useful and should be the shared one.

---

## 4. Structure improvements

### ⬜ 4.1 `MapEditorClient.tsx` — 802 lines, five components in one file *(PR 3)*
Contains 4 icon definitions, `MapRefCapture`, `MapViewUpdater`, `MapClickCapture`, a 224-line `SpotPanel` (9 useState hooks), and the 477-line main editor (11 useState, 3 queries, 4 mutations). **Fix:** split into `icons.ts`, `mapHelpers.tsx`, `SpotPanel.tsx`, `MapEditorClient.tsx`. `SpotPanel` is independently testable once extracted — today it's untested and unreachable in isolation.

### ⬜ 4.2 Organiser applications page — 640 lines, 10 mutations in one component *(PR 3)*
`KanbanView` holds 4 queries + 10 mutations (stage, release, patch, score, reorder, open/close round…). **Fix:** extract a `useApplicationReview(festivalId)` hook owning the queries/mutations; the page becomes layout + handlers. This would also drastically simplify its tests (see 5.2).

### ⬜ 4.3 Login page — MFA flow embedded (310 lines) *(PR 3)*
The TOTP step (`mfaRequired`, `mfaToken`, `totpCode`, `handleMfaSubmit`, `backToLogin`) is a separate UI state machine living inside `LoginForm`. **Fix:** extract `MfaForm.tsx`. Also unlocks testing the MFA branch, currently uncovered.

### ✅ 4.4 `useEffect`-based fetching diverges from the React Query convention *(done — PR 1)*
`endorse/[profileID]/page.tsx:27` and `endorsements/page.tsx:17` fetch in `useEffect` with hand-rolled `loading` flags and **no error handling at all** (a failed GET leaves the page stuck or silently empty). Every other client page uses React Query. **Fix:** migrate both to `useQuery`; consistency plus retry/cache/error states for free.

### ⬜ 4.5 Leaflet inline hex colours *(deferred — partially mitigated by lib/murals.ts in PR 1; FestivalMap still uses raw hexes)*
`MapEditorClient.tsx:41,48,57,733`, `MuralMap.tsx:36`, `FestivalMap.tsx:114` hard-code brand hexes in divIcon HTML (CSS classes can't reach into `L.divIcon` strings easily, so this is semi-justified). **Fix:** export named constants (`MARKER_AMBER = '#E8A838'` etc.) from one module so the values can't drift from `globals.css` unnoticed — drift has already happened once (see 1.3).

---

## 5. Testing improvements

### ⬜ 5.1 Coverage gaps — the highest-value untested code *(PR 4)*
No coverage tooling is configured (no `@vitest/coverage-*`, no `coverage` block in `vitest.config.ts`) — worth adding to make this visible in CI. The notable gaps, ordered by risk:

| Untested | Lines | Why it matters |
|---|---|---|
| `(artist)/applications/apply/[id]/page.tsx` | 268 | **the core artist journey** (apply flow, DynamicForm wiring, prefill) |
| `(artist)/profile/setup/ProfileWizard.tsx` | 383 | first-run experience; multi-step state machine |
| `middleware.ts` | 65 | **beta-gating + auth redirects** — pure function, trivially testable, security-adjacent |
| `organiser/festivals/[id]/page.tsx` | 401 | festival settings, review criteria CRUD |
| `app/dashboard/page.tsx` | 209 | landing page for every logged-in user |
| `MapEditorClient.tsx` `SpotPanel` | 224 | spot editing logic (blocked on 4.1 extraction) |
| both billing pages | 279 | Stripe checkout entry points |
| all 3 hooks (`useUploadImage`, `useProfileImageUpload`, `useApplicationReorder`) | ~150 | multi-step API choreography with error paths |
| `endorse` / `endorsements` pages, `PublishBar`, `OwnerBar`, `KanbanColumn`, `MediumPicker`, `SupportLinkField`, `ImageSlot`, `PricingCard`, `BetaFeedbackWidget`, `BetaInviteCard`, `SocialLinks` | — | shared components; `MediumPicker`/`SupportLinkField`/`ImageSlot` are used by both wizard and editor, so one regression breaks two flows |

(Some of these are covered indirectly by Playwright e2e — but e2e runs only on the full stack and won't pinpoint a component regression.)

### ⬜ 5.2 Fragile mocking style — positional `mockReturnValueOnce` chains *(PR 4)*
`__tests__/organiser/applications-page.test.tsx` has **48** `mockReturnValueOnce` calls; `artist/collection-detail-page.test.tsx` has 34. The whole of React Query is mocked out (`vi.mock('@tanstack/react-query')`) and each `useQuery` in the component is satisfied positionally. Consequences:
- Adding/reordering a single `useQuery` in the page silently shifts every mock and produces confusing failures (or worse, false passes).
- The mutation mock executes `mutationFn` synchronously, so optimistic-update and invalidation behaviour is never exercised.

**Fix (pattern change, apply to new tests first):** render with a real `QueryClientProvider` (retry off) and mock at the true boundary — `vi.mock('@/lib/api')` with per-endpoint `vi.fn()` implementations keyed by path. Tests then assert behaviour ("shows 3 applications") instead of hook call order. The existing `vi.mock('@/lib/api')` line is already there; the React Query mock can be deleted incrementally per file.

### ⬜ 5.3 Implementation-coupled assertions *(PR 4 — fix new tests as they're written; don't rewrite existing ones in isolation)*
18 `toHaveClass`/`querySelector` assertions couple tests to Tailwind classes — e.g. `collection-detail-page.test.tsx:338-352` asserts `grid-cols-2 sm:grid-cols-3`. The public collection page just legitimately changed from grid to masonry; had that test pointed at the public page it would have failed on a pure visual refactor. Prefer role/label/text queries (the suite already does this well elsewhere).

### ⬜ 5.4 Confusing test directory names: `__tests__/artist/` vs `__tests__/artists/` *(PR 4)*
Two near-identical directory names cover different things — `artist/` = `(artist)` route group, `artists/` = public `/artists/[id]` pages — and **both contain a `collection-detail-page.test.tsx`**. Rename to mirror route groups: `artist/` → `app-artist/`, `artists/` → `app-public-artists/` (or add a README line). Cheap, prevents edits landing in the wrong file.

### ⬜ 5.5 Inconsistent test locations *(PR 4)*
Three lib tests are colocated (`lib/embeds.test.ts`, `lib/questionLibrary.test.ts`, `lib/triage.test.ts`) while the rest live under `__tests__/` (including `__tests__/lib/favicon.test.ts`, `__tests__/lib/prefill.test.ts`). Pick one convention — the documented one is `__tests__/` mirroring `src/`.

---

## 6. Suggested action plan

Ordered for value-per-effort; each row is an independent PR-sized unit.

| # | Action | Findings | Effort | Status |
|---|---|---|---|---|
| 1 | Add `app/error.tsx` + `global-error.tsx` + site favicon | 1.2, 1.4 | XS | ✅ PR 1 #297 |
| 2 | `lib` consolidation: export `apiBaseUrl`, `createAuthedServerClient()`, add `lib/dates.ts`, `lib/festivals.ts`, `lib/collections.ts`, `lib/murals.ts`; migrate call sites | 1.3, 2.3, 2.4, 2.5, 3.2–3.4 | S | ✅ PR 1 #297 |
| 3 | Stop swallowing API errors: throw in `queryFn`s, render `isError` states | 1.1 | S | ✅ PR 1 #297 |
| 4 | Merge the two upload hooks into `useImageUpload` | 3.1 | S | ✅ PR 1 #297 |
| 5 | Migrate endorse/endorsements pages to React Query + singleton client | 2.5, 4.4 | S | ✅ PR 1 #297 |
| **6** | **Add missing endpoints to the OpenAPI spec, regenerate, migrate the 9 raw-fetch files + delete dashboard's hand-rolled types** | **2.1, 2.2** | **M** | **⬜ PR 2 — next** |
| **7** | **Split `MapEditorClient` (SpotPanel out first), extract `useApplicationReview`, extract `MfaForm` from login** | **4.1, 4.2, 4.3** | **M** | **⬜ PR 3** |
| **8** | **Test `middleware.ts`, apply page, hooks; rename `__tests__/artist\|artists`; settle test location convention; add `@vitest/coverage-v8` to CI** | **5.1, 5.4, 5.5** | **M** | **⬜ PR 4** |
| **9** | **Incrementally replace `vi.mock('@tanstack/react-query')` with real provider + api-boundary mocks when touching each test file** | **5.2, 5.3** | **ongoing** | **⬜ PR 4 onwards** |

**Not recommended:** chasing the 13 `no-img-element` lint warnings with `next/image` right now — image hosts are MinIO/S3 presigned URLs and the optimizer needs config (`remotePatterns`, or a custom loader for the CDN). Worth a deliberate decision when the hosting target (still TBD per CLAUDE.md) is chosen; until then `<img>` is the pragmatic choice.

---

## Appendix — things that are in good shape

- **Zero `any`** across `app/`, `components/`, `hooks/`, `lib/`; entity types pulled from `components['schemas']` everywhere except the dashboard (2.2).
- **Server/Client split:** every `NEXT_PUBLIC_API_URL`-only file I checked is genuinely `'use client'`; no live instance of the ECONNREFUSED trap.
- **`lib/auth-server.ts`** is well-documented and correct (`server-only` import guard, per-request clients, no singleton reuse for authed calls).
- **Image layout:** after the masonry fix, no remaining `h-auto`-in-grid instances; the artist editor's `aspect-square object-cover` grid is correct for dnd-kit.
- **Accessibility:** 31 files use aria/roles; tests largely query by role/label; `key={i}` only on static lists.
- **No debug leftovers:** no `console.log`, no `alert()` in production code.
- **DynamicForm** keys answers by `field.id` (the documented e2e landmine) — verified still correct.
