---
paths:
  - "web/**"
---

# Web frontend standards & gotchas

The Next.js 16 App Router platform (React 19, TypeScript, Tailwind v4). This is
the in-context working knowledge for `web/`. Route-group `*.spec.md` files are the
binding contract — read the relevant one before changing a route group.

## Server vs Client Components

- **Server Component by default.** No `'use client'` → runs on the server, can be
  `async`, reads cookies, ships zero JS. Cannot use `useState`/`useEffect`/
  `onClick`/browser APIs. Add `useState` to a server file and you get a cryptic
  error — you forgot `'use client'`.
- **Push `'use client'` to the smallest leaf** that needs interactivity. Preferred
  pattern: `async` Server Component fetches data → passes as props to a small
  client component for the interactive bits (copy `(artist)/profile/page.tsx` →
  `ProfileForm`). Whole-page client + React Query is fine for highly interactive
  pages (copy `(artist)/applications/page.tsx`).
- **`next/dynamic({ ssr: false })` must live in a `'use client'` file.** Used for
  Leaflet maps. Put it directly in a Server Component `page.tsx` and the *entire*
  dev server 500s. Pattern to copy: `(public)/festivals/[id]/map/FestivalMapClient.tsx`.

## Talking to the backend

- **Never hand-write `fetch`** to the API. Use the typed `apiClient` from
  `@/lib/api` (generated from the OpenAPI spec). Responses are `{ data, error,
  response }` — always check `res.error`/`res.data` before use. As of PR2 the
  spec covers billing, beta, MFA and email-verification too, so there is **no
  legitimate raw `fetch` to our API left** — the only justified raw fetch is the
  external presigned-PUT inside `hooks/useImageUpload.ts` (uploads to MinIO/S3,
  not our API).
- **This is enforced by ESLint, not convention.** `eslint.config.mjs` (flat
  config — Next 16 removed `next lint`, so linting runs via `eslint .`) bans
  `fetch(` via `no-restricted-syntax`; `task lint` / the `web-lint` pre-commit
  hook / CI all fail on a raw fetch. If you have a *genuinely external* fetch
  (not our API), don't reach for `eslint-disable` inline — add the file to the
  files-scoped exemption block in `eslint.config.mjs` with a comment, like
  `hooks/useImageUpload.ts`. If you're tempted to exempt a call to *our* API,
  the answer is almost always "add the endpoint to the spec" instead.
- **Missing endpoint? Fix the spec, don't hand-roll fetch.** If the typed client
  can't call an endpoint, the cause is almost always that it's absent from
  `openapi/openapi.yaml`. Add the path + schemas there, run `task openapi:gen`
  from the repo root (regenerates `openapi/generated/client.ts` *and*
  `api/internal/openapi/api.gen.go`), commit both, then migrate the call site.
  The Go `ServerInterface` in `api.gen.go` is generated but **unused** (nothing
  imports it), so adding paths never breaks the Go build — it only widens the
  typed surface. CI's "OpenAPI — no drift" job fails if you edit the spec
  without regenerating.
- **openapi-fetch call shapes** (all of these are typed):
  - Path params: `apiClient.GET('/collections/{collectionID}', { params: { path: { collectionID } } })`.
  - Query params: `apiClient.GET('/auth/verify-email', { params: { query: { token } } })`.
  - Per-request header override (e.g. an MFA-pending bearer that isn't the
    session cookie): `apiClient.POST('/auth/mfa/verify', { headers: { Authorization: \`Bearer ${mfaToken}\` }, body: { code } })`.
  - Fire-and-forget beacons keep `keepalive`: `apiClient.POST(path, { params, keepalive: true })` — openapi-fetch forwards arbitrary fetch init.
  - Branch on HTTP status with `response.status` / `response.ok` (don't re-parse
    `res.error` for control flow unless you need the problem body).
- **Entity types come from the schema:** `import type { components } from
  '@render/api-client'` → `components['schemas']['Application']`. Don't re-declare
  shapes. This includes response DTOs like `MeSummary`, `BetaInvite`,
  `CheckoutResponse` — a page that hand-declares `type Festival = {...}` is a
  smell that the endpoint is missing from the spec (see above).
- **Typed availability ≠ permission to render.** The generated client types
  *every* field the server returns, including ones the UI shouldn't show. Don't
  surface a field just because autocomplete offers it.
  - Treat emails, other users' identities, and internal IDs (`user_id`,
    `*_token`) as need-to-know. The spec is **descriptive, not an access
    boundary** — hiding a field in the component still ships it over the wire
    (visible in the network tab / RSC payload). If the API hands you PII the
    screen doesn't need, the fix is to **trim the server response DTO**, not to
    fetch-and-ignore it. (See the `/beta/me/invites` invitee-emails and public
    profile `user_id` audits — both were unused fields the server over-returned.)
  - **Server Components serialize their props to the browser.** A value you fetch
    server-side and pass into a `'use client'` child crosses to the client and
    sits in the page payload. Pass only the fields the child needs — e.g.
    `dashboard/page.tsx` reads the full `/me/summary` server-side but hands the
    card just `display_name`/`bio`, never the whole user object.
  - Notice the API returning a field nothing renders? Don't paper over it in the
    UI — flag it (or fix the handler) so the response DTO stops sending it.
- **Server-side env:** server code must use `process.env.API_URL` (`http://api:8080`
  in Docker), never `NEXT_PUBLIC_API_URL` (`localhost:8080` → `ECONNREFUSED` from
  inside the container → every page 500s). Just import from `@/lib/api` /
  `@/lib/auth-server`; don't read `process.env` yourself.
- **Authed server calls:** the singleton `apiClient` has no cookie. On the server
  use `getSessionUser()` / `requireAuth()` from `@/lib/auth-server`, or for other
  authed data make a per-request client injecting the cookie via `.use({ onRequest })`
  (copy `profile/page.tsx`). `requireAuth()` redirects to `/login` if not logged in.
- **Change the API shape → regenerate the client** (`task openapi:gen` from repo
  root) and commit it, or CI's "OpenAPI — no drift" job goes red.

## Routing & links — `typedRoutes` is ON

`next.config.ts` sets `typedRoutes: true`, so **every `<Link href>` and `router.push()`
is type-checked against the real route tree**. A link to a route that doesn't exist is
a compile error, not a silent runtime 404. (This was added after a dangling
`/festivals/{id}/apply` link shipped to the public festival page — see `docs/ui-health`.)

- **Static hrefs are checked airtight.** `href="/dashboard"` compiles; `href="/dashbord"`
  or `href={`/festivals/${id}/apply`}` (no such route) is a `tsc` error.
- **Dynamic interpolations need an explicit `as Route`.** A bare `string` can contain
  slashes, so `` `/festivals/${festivalId}` `` is *not* assignable to `Route` even though
  the route exists. Cast it: `` (`/festivals/${festivalId}` as Route) ``. Import the type
  with `import type { Route } from 'next'`. This is the one legitimate escape hatch — a
  reviewer can see every cast. Live examples: `(public)/artists/[id]/page.tsx`,
  `components/OwnerBar.tsx` (its `editHref` prop is typed `Route`).
- **Arrays of links: type the field**, e.g. `const NAV_LINKS: { href: Route; label: string }[]`
  (see the two `layout.tsx` nav menus). The literals are then checked as real routes.
- **Genuinely-external targets** (a `?next=` query value, an arbitrary redirect) can't be
  statically known — cast `as Route` with a comment, as `(auth)/login/page.tsx` does.
- **Enforcement depends on generated route types.** `typedRoutes` writes `.next/types/**`
  only via `next dev` / `next build` / `next typegen`. So `npm run typecheck` is
  `next typegen && tsc --noEmit` (not bare `tsc`) — CI calls that script. If you add a
  raw `tsc` invocation anywhere, prefix it with `next typegen` or the route checking is
  silently off.
- **A unit-test `href` assertion does NOT prove the route exists — it can ratify a broken
  one.** `expect(rendered).toContain('/festivals/abc/apply')` passes whether or not
  `/festivals/[id]/apply` is a real route; it only checks the string the component emits.
  The broken apply link shipped with exactly such a green assertion (`festival-page.test.tsx`).
  Route *correctness* is `typedRoutes`' job (compile time); route *navigation* is an e2e's
  job (follow the link, assert it doesn't 404 — see `public-visitor.spec.ts`). Treat an
  href string-match as a weak smoke check, never as proof the link works. (This is the
  routing-specific case of "A boundary mock proves rendering, not the server contract"
  below.)

## Security headers & `next.config.ts` policy

`next.config.ts` sets a baseline of security response headers via `headers()`, applied to
every route: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: strict-origin-when-cross-origin`, `X-DNS-Prefetch-Control: off`. Also
`poweredByHeader: false` (no `X-Powered-By` version leak).

- **Kill-switch:** all four headers are gated behind `SECURITY_HEADERS` — set
  `SECURITY_HEADERS=off` to disable them in any environment without a code change. Default
  is ON (unset = on), so local dev, the e2e stack, and CI all get them. The four baseline
  headers are safe for Playwright/HMR — the full browser suite passes with them on — so
  you shouldn't need the switch for these; it exists for the fragile additions below.
- **HSTS is deliberately NOT set here.** `Strict-Transport-Security` is HTTPS-only and
  belongs at the TLS terminator (ALB/CDN, E11 infra), not on `http://localhost`.
- **CSP is deliberately NOT set yet.** A `Content-Security-Policy` must allowlist Leaflet's
  inline styles, OSM tile hosts, and the presigned image host(s) — add it to
  `securityHeaders` gated by the same `SECURITY_HEADERS` flag, and soak it report-only
  before enforcing. Don't bolt on a naive CSP; it will silently break the maps.
- **`logging: { fetches: { fullUrl: true } }`** logs the full URL of every server-side
  fetch in dev — your first signal for the `API_URL` vs `NEXT_PUBLIC_API_URL` footgun (a
  Server Component hitting `localhost:8080` → `ECONNREFUSED`). Dev-only; no prod effect.

## Styling

- **Design tokens only** (defined in `src/app/globals.css`): `text-ink`,
  `bg-offwhite`, `bg-warm`, `bg-amber`, `text-clay`, `text-mid`, `border-light`.
  Fonts: `font-serif` (Cormorant — headings/bios), `font-sans` (DM Sans — body),
  `font-mono` (DM Mono — uppercase badges/stats). No raw hex, no new fonts without
  a design reason. Full palette in `.claude/rules/design-system.md`.

## Image layout: the grid-stretch / `h-auto` trap

**Symptom:** an image tile shows its container background (`bg-warm` grey, or the
page background) bleeding below the image — the picture doesn't fill its box.

**Cause:** CSS grid cells default to `align-items: stretch`, so each cell grows to
the **tallest item in its row**. An `<img>` with `w-full h-auto` only takes its
*natural* aspect-ratio height, so any image shorter than the row's tallest leaves
the cell background exposed below it. Same failure for a `row-span-2` cell whose
image has a fixed `h-64` — the image can't fill the doubled cell.

Pick the pattern by intent:

1. **Masonry — full uncropped images (art galleries).** CSS columns, not grid;
   each tile hugs its image:
   ```tsx
   <div className="columns-2 sm:columns-3 gap-3">
     {images.map((img) => (
       <div key={img.id} className="mb-3 break-inside-avoid overflow-hidden rounded-lg border border-light">
         <img src={img.cdn_url} alt="" className="block w-full h-auto" />
       </div>
     ))}
   </div>
   ```
   Live: `(public)/artists/[id]/collections/[collectionId]/page.tsx`.

2. **Uniform tiles — even grid, cropping OK.** Fix the aspect, `object-cover`:
   ```tsx
   <div className="aspect-square overflow-hidden rounded-lg border border-light bg-warm">
     <img className="w-full h-full object-cover" … />
   </div>
   ```
   Used by the artist collection **editor** (`(artist)/collections/[id]/page.tsx`),
   which must stay a grid for dnd-kit reordering.

3. **Fixed-height mosaic with spanning cells.** A `row-span-2` cell needs its image
   `h-full object-cover`, and pin row height with `auto-rows-[16rem]` so spanning
   cells double cleanly. Live: headline strip in `(public)/artists/[id]/page.tsx`.

**Rules of thumb:**
- Add `block` to any full-width `<img>` (kills the inline baseline gap).
- Never rely on default `object-fit: fill` — it distorts. Use `cover`, or `h-auto`
  in masonry.
- A `bg-*` placeholder behind an `h-auto` image in a grid WILL show as overflow.
- New/changed galleries: eyeball in the browser with **mixed-orientation images** —
  the bug only appears when a row mixes a tall portrait with a short landscape.

## Page/component structure — when a file gets big

Live conventions, established by the PR2–4 refactors. Reach for these before a
client page passes ~300 lines:

- **Lift the data layer into a co-located hook.** A page with many
  queries + mutations should own them in a `useXxx(id)` hook beside the page,
  returning queries, derived state, and mutations; the page stays layout + UI
  handlers. Pattern to copy: `organiser/festivals/[id]/applications/useApplicationReview.ts`
  (4 queries, 7 mutations, optimistic `localApps`). Keep genuinely-UI state
  (selected row, open modal) in the page; if a mutation needs to close a modal,
  react to `mutation.isSuccess` in the page rather than putting UI state in the
  hook.
- **Split a multi-component file by role.** The Leaflet map editor lives as
  `mapIcons.ts` (divIcon constants + the default-icon side effect),
  `mapHelpers.tsx` (headless react-leaflet children), `SpotPanel.tsx` (the
  editable side panel), and `MapEditorClient.tsx` (the editor). Extracting a
  panel makes it independently testable.
- **Extract a sub-flow into its own component.** The login page's TOTP step is
  `(auth)/login/MfaForm.tsx`, driven by `mfaToken !== null` in the parent. A
  self-contained UI state machine inside a larger form is the signal.
- **Leaflet marker hexes can't reach CSS** — they're inlined in `L.divIcon` HTML.
  Keep them as named constants in one module (`mapIcons.ts`) and keep them in
  sync with the tokens by comment; the status→colour mapping for circle markers
  is `lib/murals.ts` (`muralStatusColour`).
- **Leaflet default marker icon — import `@/lib/leaflet`, don't re-roll it.** A
  `.png` `import` resolves to `{ src }` under webpack but to a bare URL **string**
  under Turbopack (Next 16's bundler). The old `L.icon({ iconUrl: (icon as {src}).src })`
  pattern left `iconUrl` undefined → Leaflet threw `iconUrl not set in Icon
  options` on the first `<Marker>`, taking the whole map down via the error
  boundary (caught only by e2e). `lib/leaflet.ts` resolves either shape and
  installs the default icon as a side effect — import it; never reconstruct it.

## Shared components — edit, don't fork

`MediumPicker.tsx`, `SupportLinkField.tsx`, `ImageSlot.tsx` are used by **both**
the profile wizard and the profile editor. Changing one changes both — that's
intentional. The image-upload choreography (presign → PUT MinIO/S3 → confirm →
attach) lives in `hooks/useImageUpload.ts`; reuse it, don't reimplement.

## Testing client pages/hooks — the preferred pattern

Established in PR4. **Drive components with a real React Query provider and mock
at the API boundary**, not by stubbing `@tanstack/react-query`.

- Use the helper `src/__tests__/helpers/query.tsx`:
  - `renderWithClient(ui)` — wraps in a `QueryClientProvider` with retries off.
  - `ok(data, status?)` / `err(status, body?)` — build openapi-fetch style
    `{ data, error, response }` results.
  - `byPath({ '/path': ok(...) })` — a `mockImplementation` for `apiClient.GET`
    /`POST`/… that dispatches by the path string and throws on an unmocked path.
- Mock `@/lib/api` (`apiClient: { GET: vi.fn(), POST: vi.fn(), ... }`) and set
  `mockGet.mockImplementation(byPath({...}))`. Assert behaviour ("shows 3
  applications", "calls the reorder endpoint") — never hook call order. Examples
  to copy: `__tests__/app-artist/apply-page.test.tsx`,
  `__tests__/organiser/applications-page.test.tsx`,
  `__tests__/app-artist/collection-detail-page.test.tsx`.
- **Do NOT** `vi.mock('@tanstack/react-query')` with positional
  `mockReturnValueOnce` chains — adding/reordering a `useQuery` silently shifts
  every mock. The old fragile files were converted; don't reintroduce the style.
- **Don't assert Tailwind classes** (`toHaveClass('grid-cols-2')`) or reach into
  `querySelector` for layout — a pure visual refactor shouldn't break a test.
  Prefer role/label/text queries. (One narrow exception kept: asserting a
  state-driven class like `border-amber` on a drop zone.)
- Async data means async assertions: `await screen.findBy…` / `waitFor`. When
  firing an event that depends on loaded data (e.g. a captured dnd `onDragEnd`),
  first `await` a loaded-state signal so the captured closure sees real data.
- Mocking the upload hook: return the **full** shape
  `{ upload, state, isUploading, error }` (`state` is required by the type).
- **A boundary mock proves rendering, not the server contract.** Mocking
  `apiClient.GET` means *you* supply the response — so a test asserting behaviour
  driven by a field (a conditional render, a link's `href`, a redirect) only
  proves "given this field, the UI does X." It can never prove the server
  actually sends that field. When a component newly *depends* on a server field
  for behaviour, the Vitest test is necessary but **not sufficient**: add or
  extend a real-server test (API e2e in `e2e/api/`, or a Playwright spec) that
  hits the actual endpoint and asserts the field is populated on the real path —
  including the negative case (field absent → fallback). This is the front-end
  twin of the sqlc-scan canary in `e2e-debugging.md`: a new field can be wired
  through types and mocks yet never leave the database. (Lived example: the
  `endorser_profile_id` endorser link shipped with a green Vitest `href`
  assertion but no test that the API emitted the id — the mock had been feeding
  it by hand.)

## Test file conventions

- All tests live under `src/__tests__/` mirroring `src/`. Don't colocate
  `*.test.ts` next to source — the three former colocated `lib/*.test.ts` were
  moved under `__tests__/lib/`.
- Route-group test dirs are named after the group to avoid the old
  `artist/` vs `artists/` ambiguity: `__tests__/app-artist/` = the `(artist)`
  route group; `__tests__/app-public-artists/` = the public `/artists/[id]`
  pages.
- Coverage is reporting-only: `npm run test:coverage` (config in
  `vitest.config.ts`, `@vitest/coverage-v8`). No failing threshold gate yet —
  output goes to `web/coverage/` (gitignored). Don't add a hard threshold
  without a deliberate decision. Coverage measures *execution, not assertion
  quality* — a boundary-mocked branch reads as fully covered even when no test
  proves the server feeds it. A coverage threshold is **not** a substitute for
  the real-server contract test described under "Testing client pages/hooks".

## Before pushing

- `task lint` (eslint + `tsc --noEmit`) and `task test` (Vitest) from `web/` — CI
  runs these in order and fails the PR on any. Lint has 13 known pre-existing
  `@next/next/no-img-element` warnings (image hosts are presigned URLs — `<img>`
  is deliberate until a hosting target is chosen); a clean run shows only those.
- Component logic → Vitest (`src/__tests__/`, mirrors `src/`, query by role/label).
  Full cross-page journey → Playwright (`e2e/`, needs `task up`).
- If you changed a route group's behaviour, add a changelog line to its `*.spec.md`
  in the same PR.

## Docker bind-mount trap (worktrees)

The Compose stack bind-mounts the **main repo** (`/Users/adampowis/workspace/murals`),
not a worktree. Editing web code in a worktree won't hot-reload the running
container unless you also edit the main-repo path. Symptom: save, nothing reloads.
Working directly in the main repo? Ignore this.
