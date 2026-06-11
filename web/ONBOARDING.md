# `web/` Onboarding — the Painttrace browser platform

A friendly walk-through of how the Next.js app is built, assuming you know
React at a junior level (components, props, state, hooks) but haven't worked
much with Next.js App Router, React Query, or our typed API client.

Read this top-to-bottom once. After that, the **"Add a feature"** and
**"Cheat sheet"** sections are what you'll come back to.

---

## 1. The 60-second mental model

This folder is the **browser platform** — the site artists and organisers log
into. (The public mobile app lives in `mobile/`; the Go backend lives in
`api/`.) It is a **Next.js 16 App Router** app written in **TypeScript** and
**React 19**, styled with **Tailwind CSS v4**.

Three things make our setup different from a vanilla "create-react-app" you may
have seen:

1. **There is no hand-written `fetch('/api/...')`.** Every call to the backend
   goes through a *typed client* generated from the API's OpenAPI spec. If the
   backend changes a field, our TypeScript fails to compile. This is a feature,
   not a chore.
2. **Pages can run on the server.** Next.js App Router lets a page component be
   `async` and fetch data *on the server* before any HTML reaches the browser.
   Some of our pages do that; others are old-school client components. Knowing
   which is which is the single most important concept here (Section 3).
3. **We don't write raw CSS.** Colours and fonts are design tokens
   (`bg-offwhite`, `text-ink`, `font-serif`) defined once in `globals.css`.

---

## 2. Folder tour

```
web/
├── src/
│   ├── app/              ← every URL in the site is a folder here (App Router)
│   │   ├── (auth)/       ← login, signup, forgot/reset password, verify-email
│   │   ├── (artist)/     ← logged-in ARTIST pages (profile, collections, billing…)
│   │   ├── (public)/     ← NO login needed — public festival & artist pages
│   │   ├── organiser/    ← logged-in ORGANISER pages (festival mgmt, reviewing)
│   │   ├── dashboard/    ← organiser dashboard entry
│   │   ├── layout.tsx    ← root layout: fonts, <body>, global Providers
│   │   ├── providers.tsx ← React Query provider (client-side)
│   │   ├── page.tsx      ← "/" — redirects to /dashboard (logged in) or /login
│   │   ├── globals.css   ← Tailwind import + design tokens (colours, fonts)
│   │   ├── sitemap.ts / robots.ts  ← SEO
│   │   │
│   │   └── *.spec.md     ← living spec for that route group (READ THESE FIRST)
│   │
│   ├── components/       ← reusable UI shared across pages (DynamicForm, cards…)
│   │   └── wizard/       ← profile-setup wizard step components
│   ├── hooks/            ← cross-page stateful logic (currently useImageUpload)
│   ├── lib/              ← non-UI helpers: API client, server-side auth, utils
│   ├── proxy.ts          ← runs before each request (auth/beta redirects)
│   └── __tests__/        ← Vitest unit/component tests (mirrors src/ layout)
│
├── package.json         ← scripts + dependencies
├── Taskfile.yml         ← `task dev`, `task test`, `task lint` shortcuts
├── next.config.ts       ← Next config (standalone output, transpile api-client)
├── eslint.config.mjs    ← ESLint flat config (Next 16 removed `next lint`)
├── vitest.config.ts     ← test runner config (jsdom, @ alias)
├── tsconfig.json        ← TypeScript config (note the `@/*` → `src/*` alias)
└── Dockerfile           ← how the container image is built
```

> **`proxy.ts`** is what older Next.js called `middleware.ts` (renamed in 16). It
> runs before a request reaches a route — we use it for auth/beta redirects.

### Route groups — what the parentheses mean

`(auth)`, `(artist)`, `(public)` are **route groups**. The parentheses mean
*"group these folders for organisation, but don't put the word in the URL."* So
`src/app/(artist)/profile/page.tsx` serves the URL `/profile`, **not**
`/(artist)/profile`. We use groups to bundle pages that share a concern (and
often a `layout.tsx` "shell") without polluting the URL.

| Group | URL prefix | Auth? | Who |
|-------|-----------|-------|-----|
| `(auth)` | `/login`, `/signup`, … | no | anyone signing in |
| `(public)` | `/festivals`, `/artists/[id]` | no | the public, search engines |
| `(artist)` | `/profile`, `/collections`, … | yes (artist) | logged-in artists |
| `organiser/` + `dashboard/` | `/organiser/...`, `/dashboard` | yes (organiser) | logged-in organisers |

### The `.spec.md` files — your most important resource

Each major route group has a colocated **living spec**: `artist.spec.md`,
`public.spec.md`, `dashboard.spec.md`, `lib.spec.md`. These describe the
*contract*, *boundaries*, *locked decisions*, and *invariants* (rules you must
never break) for that area, plus a changelog. **Read the relevant spec before
touching code in that folder** — they capture the "why" and the landmines.
Claude Code loads them automatically when working in that directory.

If your change alters how a route group behaves, update its spec in the *same*
PR (this is a project rule, see the root `CLAUDE.md`).

---

## 3. Server Components vs Client Components — the core concept

In the App Router, **every component is a Server Component by default**. It runs
once on the server, can be `async`, can read cookies, can talk to the database
or API directly — and ships *zero* JavaScript to the browser for itself. It
**cannot** use `useState`, `useEffect`, event handlers (`onClick`), or browser
APIs.

To get interactivity you opt a file into being a **Client Component** by putting
`'use client'` as the very first line. Then it behaves like the React you
already know (hooks, state, event handlers) and runs in the browser.

### How we actually use them

**Pattern A — Server page fetches data, hands it to a client component.**
This is the preferred pattern for authenticated pages. Look at the artist
profile page:

```tsx
// src/app/(artist)/profile/page.tsx  — NO 'use client' → Server Component
import { requireAuth } from '@/lib/auth-server'
import ProfileForm from './ProfileForm'      // ← 'use client' lives in here

export default async function ProfilePage() {
  const user = await requireAuth()           // server-side: reads cookie, calls /me
  const profileRes = await authedClient.GET('/profiles/me', {})
  const profile = profileRes.data ?? null

  // ... server-side redirect logic ...

  return <ProfileForm profile={profile} userId={user.id} />  // hand data down
}
```

The page is `async`, runs on the server, reads the session cookie, fetches the
profile, and passes it as a prop to `ProfileForm` — which *is* a client
component (it has form state, inputs, save buttons).

**Pattern B — Whole page is a client component using React Query.**
Simpler pages that fetch on the client look like this:

```tsx
// src/app/(artist)/applications/page.tsx
'use client'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'

export default function ApplicationsPage() {
  const applicationsQuery = useQuery({
    queryKey: ['my-applications'],
    queryFn: async () => {
      const res = await apiClient.GET('/me/applications', {})
      return res.error ? [] : (res.data ?? [])
    },
  })
  // ... render applicationsQuery.data ...
}
```

### Which do I write?

- **Needs auth + initial data on first paint, SEO matters, or it's mostly
  display?** → Server Component page that fetches, then passes data to small
  client components for the interactive bits. (Pattern A.)
- **Highly interactive, lots of client state, re-fetches as the user clicks?**
  → `'use client'` page with React Query. (Pattern B.)
- When unsure, start with a Server Component and push `'use client'` down to the
  smallest leaf that actually needs it. Less JS shipped = faster.

### ⚠️ Four traps that will cost you an afternoon

These are real, documented landmines (in the specs and the e2e-debugging rule):

1. **`API_URL` vs `NEXT_PUBLIC_API_URL`.** Server-side code must use
   `process.env.API_URL` (which is `http://api:8080` inside Docker). The
   `NEXT_PUBLIC_` one is `localhost:8080`, which from *inside* the web container
   points at nothing → `ECONNREFUSED` and every page 500s. `lib/api.ts` and
   `lib/auth-server.ts` already pick the right one — **import from there, never
   read `process.env` yourself.**

2. **`next/dynamic({ ssr: false })` must live in a `'use client'` file.** We use
   it for Leaflet maps (browser-only). Putting it directly in a Server Component
   `page.tsx` is a compile error that 500s the *entire* dev server. The pattern
   to copy: `(public)/festivals/[id]/map/FestivalMapClient.tsx`.

3. **Server Components can't use hooks or `onClick`.** If you add `useState` to a
   page and get a confusing error, you forgot `'use client'`.

4. **Request-time APIs are async — `await` them.** As of Next 16, `cookies()`,
   `headers()`, and a route's `params` / `searchParams` are Promises; reading
   them synchronously is a *build error*, not a warning. Server pages do
   `const { id } = await params` (or `await cookies()`); client pages read the
   URL via the `useSearchParams()` / `useParams()` hooks instead. (A client page
   using `useSearchParams()` must also sit inside a `<Suspense>` boundary, or the
   production build fails to prerender — copy `(auth)/login/page.tsx`.)

---

## 4. Talking to the backend — the typed API client

We **never** hand-write `fetch` to the backend. Instead:

```ts
// src/lib/api.ts  — the singleton client (safe for browser + unauthenticated SSR)
import { apiClient } from '@/lib/api'

const res = await apiClient.GET('/me/applications', {})
const res = await apiClient.POST('/images/presign', { body: { contentType: 'image/jpeg' } })
const res = await apiClient.GET('/public/festivals', { params: { query: { status: 'open' } } })
```

`apiClient` comes from `@render/api-client`, a package **generated from the
OpenAPI spec** in `openapi/`. The benefits:

- Endpoint paths (`'/me/applications'`) are autocompleted and type-checked — a
  typo won't compile.
- Request bodies and query params are typed.
- Responses come back as `{ data, error, response }`. Always check `res.error`
  (or `res.data`) before using the result — see the examples above. Branch on
  HTTP status with `res.response.status` / `res.response.ok`.

Every endpoint the platform uses is now in the spec (billing, beta, MFA, email
verification included), so **there is no legitimate raw `fetch` to our API
left**. The only justified raw fetch is the external presigned-PUT upload to
MinIO/S3 inside `hooks/useImageUpload.ts` — that's not our API.

A few call shapes you'll need beyond the basic GET/POST:

```ts
// query params
apiClient.GET('/auth/verify-email', { params: { query: { token } } })
// path params
apiClient.GET('/collections/{collectionID}', { params: { path: { collectionID } } })
// override the per-request Authorization header (e.g. an MFA-pending token
// that ISN'T the session cookie)
apiClient.POST('/auth/mfa/verify', { headers: { Authorization: `Bearer ${mfaToken}` }, body: { code } })
// fire-and-forget beacon — openapi-fetch forwards arbitrary fetch init
apiClient.POST('/profiles/{profileID}/link-click', { params, keepalive: true })
```

**If the typed client can't call an endpoint, the cause is almost always that
it's missing from the spec** — add the path + schemas to `openapi/openapi.yaml`,
run `task openapi:gen` (regenerates the TS client *and* the Go interface), commit
both, then call it. Don't reach for raw `fetch` as a shortcut.

### Getting types for entities

Need the shape of an Application or Festival? Pull it from the generated schema:

```ts
import type { components } from '@render/api-client'
type Application = components['schemas']['Application']
type Festival = components['schemas']['Festival']
```

### Authenticated requests on the server

The browser automatically sends the `session` cookie, so `apiClient` "just
works" in client components. **On the server**, you must forward the cookie
yourself. That's exactly what `lib/auth-server.ts` does:

- `getSessionUser()` → reads the `session` cookie, calls `/me`, returns the user
  or `null`.
- `requireAuth()` → same, but `redirect('/login')` if not logged in. Use this at
  the top of every protected Server Component page.

If you need *other* authed data in a server page (not just the user), call
`createAuthedServerClient()` from `lib/auth-server.ts` — it returns a per-request
client with the `session` cookie injected (or `null` when there's no session, so
you decide whether that means redirect, 403, or anonymous fallback). This is THE
way to make authed API calls from a Server Component:

```tsx
const client = await createAuthedServerClient()
if (!client) redirect('/login')
const { data, error } = await client.GET('/me/summary', {})
```

**Don't reuse the singleton `apiClient` for authed server calls** — it has no
cookie.

### The OpenAPI drift check (don't get caught by this)

CI regenerates the client from the spec and fails if the committed code differs
(`git diff --exit-code openapi/generated/`). If you change the backend's API
shape, you must regenerate the client (`task openapi:gen` from the repo root) and
commit the result, or CI's **"OpenAPI — no drift"** job goes red.

---

## 5. Styling — Tailwind v4 + design tokens

We use **Tailwind utility classes** in `className`, plus a small set of **custom
design tokens** defined in `src/app/globals.css`:

```css
@theme {
  --color-ink:      #1A1A2E;   /* near-black text       → text-ink, bg-ink */
  --color-amber:    #E8A838;   /* brand accent          → bg-amber, text-amber */
  --color-clay:     #C45C3A;   /* warm red / errors     → text-clay */
  --color-offwhite: #FAF7F2;   /* page background       → bg-offwhite */
  --color-mid:      #8A8896;   /* muted secondary text  → text-mid */
  /* …warm, light… */
  --font-serif: var(--font-cormorant), Georgia, serif;   /* → font-serif (headings) */
  --font-sans:  var(--font-dm-sans),  …;                 /* → font-sans  (body) */
  --font-mono:  var(--font-dm-mono),  …;                 /* → font-mono */
}
```

So `<h1 className="font-serif text-4xl text-ink">` gives a Cormorant Garamond
heading in our ink colour. Reach for these tokens — **don't introduce raw hex
colours or new fonts** without a design reason. Fonts are wired up in
`layout.tsx` via `next/font/google` and exposed as CSS variables.

---

## 6. Reusable building blocks

**Components** (`src/components/`) are shared UI used by multiple pages. A few
worth knowing:

- `DynamicForm.tsx` — renders a festival application form from a JSON field
  definition (text, textarea, select, embed, collection-picker). Used wherever
  organiser-defined forms appear.
- `ApplicationCard.tsx`, `ApplicationSlideOver.tsx`, `KanbanColumn.tsx` — the
  organiser review board.
- `MediumPicker.tsx`, `SupportLinkField.tsx`, `ImageSlot.tsx` — **shared field
  components used by BOTH the profile wizard and the profile editor.** If you
  change one, you change both — that's intentional. Edit the shared component,
  don't fork a copy.
- `wizard/StepShell.tsx` — layout frame for the profile-setup wizard steps.

**Hooks** (`src/hooks/`) wrap *cross-page* stateful logic so pages stay clean:

- `useImageUpload.ts` — the full image-upload dance (presign → PUT to
  MinIO/S3 → confirm → caller callback). A great example to read: it shows the
  multi-step API choreography and error handling in one place, and it's the one
  place that does the post-confirm step via a caller-supplied `onUploaded`
  callback (the profile wizard and collection editor both reuse it).

A page-*specific* data layer doesn't belong in `src/hooks/` — co-locate it next
to the page instead. When a client page accumulates many queries + mutations,
lift them into a `useXxx(id)` hook beside it so the page stays layout + handlers.
The reference is `organiser/festivals/[id]/applications/useApplicationReview.ts`
(4 queries, 7 mutations, optimistic state).

**lib helpers** (`src/lib/`) are non-UI utilities: `api.ts` (client +
`apiBaseUrl`/`publicApiBaseUrl` — never hand-roll the env fallback),
`auth-server.ts` (server auth + `createAuthedServerClient()`), `prefill.ts`
(which profile fields can pre-fill an application form — mirrored server-side),
`dates.ts` (`formatDate`/`formatDateRange`), `collections.ts` / `festivals.ts`
(status label + colour maps), `murals.ts` (`muralStatusColour`), `embeds.ts`
(YouTube/Vimeo/Sketchfab URL parsing), `mediums.ts`, `triage.ts`, `site.ts`
(SEO/site metadata).

---

## 7. Local development

You need the **whole stack** running (API, DB, MinIO, web) via Docker Compose,
because the web app talks to the real API. From the **repo root**:

```bash
task up            # start the Docker Compose stack (api, web, db, minio, …)
task down          # stop it
task db:migrate    # apply DB migrations / reset schema
```

The web app is then at **http://localhost:3000**, the API at
**http://localhost:8080**. The web container runs `next dev`, so edits hot-reload.

### ⚠️ The Docker bind-mount trap (worktrees)

The Compose stack bind-mounts the **main repo** (`/Users/adampowis/workspace/murals`),
*not* a git worktree. If you're working in a worktree and edit web code, the
running container won't see it unless you also edit the file in the main repo
path. Symptom: you save, nothing hot-reloads. (Full detail in
`.claude/rules/e2e-debugging.md`.) If you're working directly in the main repo,
ignore this.

### Running just the web tooling

You usually *don't* need Docker for unit tests or lint — those run against the
source directly. From `web/`:

```bash
task dev      # next dev on :3000  (needs the API for data, though)
task test     # vitest — unit + component tests
task lint     # eslint .  +  tsc --noEmit  (typecheck)
task build    # production build
task install  # npm install
```

Both `next dev` and `next build` use **Turbopack** by default (Next 16) — no
flag needed, and we have no custom webpack config. `lint` runs the ESLint CLI
against the flat config in `eslint.config.mjs` (`next lint` was removed in 16).

(Each is a thin wrapper over the `package.json` scripts: `npm test`,
`npm run lint`, `npm run typecheck`, etc.)

---

## 8. Testing

Two layers of tests protect the web app.

### Unit / component tests — Vitest (`web/src/__tests__/`)

- Runner: **Vitest** in a **jsdom** environment (`vitest.config.ts`).
- Library: **React Testing Library** (`render`, `screen`, `fireEvent`,
  `getByRole`, `getByLabelText`).
- Layout mirrors `src/`. **All tests live under `src/__tests__/`** — don't
  colocate `*.test.ts` next to source. A component at
  `src/components/DynamicForm.tsx` has its test at
  `src/__tests__/components/dynamic-form.test.tsx`.
- Route-group test dirs are named after the group (to avoid an old
  `artist/` vs `artists/` ambiguity): `__tests__/app-artist/` = the `(artist)`
  group; `__tests__/app-public-artists/` = the public `/artists/[id]` pages.
- The `@/` alias works in tests too (`import DynamicForm from '@/components/DynamicForm'`).

These test components in isolation (no real backend). Example — note how it
queries by accessible role/label, the way a user/screen-reader would:

```tsx
it('renders a text field', () => {
  const fields = [{ type: 'text' as const, label: 'Your name', required: true }]
  render(<DynamicForm fields={fields} onSubmit={vi.fn()} />)
  expect(screen.getByLabelText(/Your name/)).toBeInTheDocument()
})
```

**Testing a whole page or a data hook?** Drive it with a *real* React Query
provider and mock at the API boundary — **don't** stub `@tanstack/react-query`
and satisfy each `useQuery` positionally (that's brittle: adding a query shifts
every mock). Use the helper `src/__tests__/helpers/query.tsx`:

```tsx
import { renderWithClient, ok, err, byPath } from '../helpers/query'

vi.mock('@/lib/api', () => ({ apiClient: { GET: mockGet, POST: mockPost } }))

mockGet.mockImplementation(byPath({
  '/festivals/{festivalID}': ok(festival),       // { data, error, response }
  '/festivals/{festivalID}/form': err(404),
}))
renderWithClient(<ApplyPage />)
expect(await screen.findByRole('heading', { name: /Apply to/ })).toBeInTheDocument()
```

Assert *behaviour* ("shows 3 applications", "calls the reorder endpoint"), never
hook call order. Avoid `toHaveClass('grid-cols-2')` style assertions — a visual
refactor shouldn't break a test. Good examples to copy:
`__tests__/app-artist/apply-page.test.tsx`,
`__tests__/organiser/applications-page.test.tsx`.

Run them: `task test` (or `npm test`, or `npx vitest run path/to/file.test.tsx`
for one file, or `npx vitest` for watch mode). Coverage is reporting-only:
`npm run test:coverage` (output in `web/coverage/`, gitignored) — there's no
failing threshold gate.

### End-to-end tests — Playwright (`e2e/browser/`, at the repo root)

These drive a **real browser against the full running stack** — the genuine
user journeys (apply → accept → pin on map, organiser setup, etc.). They live
*outside* `web/` and need `task up` first. You'll mostly run these when changing
a full flow. The repo's `.claude/rules/e2e-debugging.md` is the definitive guide
to running and debugging them — read it before diving in.

**Rule of thumb:** logic in a component → Vitest. A whole user journey across
pages → Playwright e2e.

---

## 9. CI/CD

Defined in `.github/workflows/ci.yml`. On every push to `main` and every PR:

1. **Detect changes** — a path filter decides which jobs run. Touching `web/**`
   or `openapi/**` triggers the **web** job (and the e2e gate).
2. **Web job** (`working-directory: web`) runs, in order:
   - `npm run lint` (ESLint)
   - `npm run typecheck` (`tsc --noEmit`)
   - `npm test` (Vitest)
   If any fail, the PR is red. **Run `task lint && task test` locally before
   pushing** to catch these early.
3. **OpenAPI drift** — regenerates the client and fails if you didn't commit the
   regenerated output (see Section 4).
4. **E2E gate** — after api/web/mobile/openapi pass, spins up the Compose stack
   and runs the API + Playwright e2e suites. On failure it uploads the
   Playwright report as an artifact.

There's no auto-deploy yet (hosting target is still an open decision — see the
root `CLAUDE.md`). CI is purely the quality gate.

---

## 10. How to add a new feature (worked recipe)

Say you're adding a new authenticated artist page, `/awards`, that lists awards
from a (hypothetical) `GET /me/awards` endpoint.

1. **Read the spec first.** Open `src/app/(artist)/artist.spec.md` — note the
   invariants (typed client only, `API_URL` on the server, no raw fetch).

2. **Make the route.** Create `src/app/(artist)/awards/page.tsx`. Pick your
   pattern from Section 3:
   - Server Component: `await requireAuth()`, fetch with a cookie-injected
     client (copy `profile/page.tsx`), pass data to a client component.
   - Or `'use client'` + `useQuery` (copy `applications/page.tsx`).

3. **Call the backend through the typed client.** `apiClient.GET('/me/awards', {})`.
   If the endpoint is new, it must exist in the OpenAPI spec and the client must
   be regenerated first — otherwise TypeScript won't know the path.

4. **Pull entity types** from `components['schemas']['Award']` rather than
   re-declaring shapes.

5. **Style with tokens** — `font-serif text-ink`, `bg-offwhite`, etc. Reuse
   existing components/cards where one fits.

6. **Extract reusable logic** into `src/hooks/` or `src/components/` if another
   page will need it. Don't copy-paste a shared field component — import it.

7. **Write tests.** A Vitest test in `src/__tests__/app-artist/awards-page.test.tsx`
   (route-group dirs are `app-artist` / `app-public-artists`). For a page, use the
   real-provider + boundary-mock pattern from Section 8. If it's a full journey,
   add/extend a Playwright spec in `e2e/browser/`.

8. **Run the gates locally:** `task lint && task test` in `web/`. If you touched
   the API shape, regenerate the client so the drift check stays green.

9. **Update the spec.** Add a changelog line (and adjust Contract/Invariants if
   behaviour changed) in `artist.spec.md`, in the same PR.

10. **Open the PR** against `main`. CI runs lint → typecheck → test → (e2e).

---

## 11. Cheat sheet

| I want to… | Do this |
|---|---|
| Add a page | New folder + `page.tsx` under the right route group in `src/app/` |
| Make a page interactive | Add `'use client'` at the top (now hooks/onClick work) |
| Fetch data on the server | `async` Server Component + `requireAuth()` / cookie-injected client |
| Fetch data on the client | `'use client'` + `useQuery` + `apiClient` |
| Call the backend | `apiClient.GET/POST(...)` from `@/lib/api` — never raw `fetch` |
| Get an entity's type | `components['schemas']['Name']` from `@render/api-client` |
| Know who's logged in (server) | `getSessionUser()` / `requireAuth()` from `@/lib/auth-server` |
| Style something | Tailwind classes + tokens (`text-ink`, `bg-amber`, `font-serif`) |
| Reuse logic | Cross-page hook in `src/hooks/`; page-specific data hook co-located next to the page; UI in `src/components/` |
| Test a page/hook | `renderWithClient` + `byPath` boundary mock (`__tests__/helpers/query.tsx`); never stub react-query |
| Add a missing endpoint | Edit `openapi/openapi.yaml` → `task openapi:gen` → commit both → call via `apiClient` |
| Run the app | `task up` (repo root) → http://localhost:3000 |
| Run unit tests | `task test` (in `web/`) |
| Run lint + types | `task lint` (in `web/`) |
| Understand a route group's rules | Read its colocated `*.spec.md` |
| Embed a map | `next/dynamic({ ssr: false })` inside a `'use client'` file only |

### The five things that will bite you

1. Forgetting `'use client'` when you use a hook or event handler.
2. Using `NEXT_PUBLIC_API_URL` in server code (→ `ECONNREFUSED`, all pages 500).
3. `ssr: false` dynamic import placed in a Server Component (→ whole app 500s).
4. Hand-writing `fetch` instead of the typed client (loses type safety, fails review).
5. Changing the API shape without regenerating the client (→ CI drift check red).

---

*When in doubt, the colocated `*.spec.md` files and the root `CLAUDE.md` are the
source of truth. This doc is the gentle introduction; those are the contract.*
