# Web PR 1 — lib foundations, DRY consolidation & robustness

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate duplicated lib logic (base URLs, authed server client, dates, status maps, upload choreography), stop swallowing API errors, and add error boundaries + a site favicon — PR 1 of the 4-PR plan derived from `web-code-audit.md`.

**Architecture:** All shared logic moves into `web/src/lib/` modules with unit tests; call sites become thin imports. Query functions throw on API error so React Query's `isError` drives distinct error UI. No API/backend changes in this PR (that's PR 2).

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Tailwind v4, React Query 5, Vitest + React Testing Library. Tests live in `web/src/__tests__/` mirroring `src/`.

**The 4-PR roadmap (context):**
1. **This PR** — lib foundations + DRY + robustness + polish
2. OpenAPI spec completion (billing/beta/MFA/auth endpoints) + raw-fetch migration
3. Structure refactors (split `MapEditorClient`, extract `useApplicationReview`, extract `MfaForm`)
4. Testing (middleware/hooks/apply-page tests, dir renames, coverage in CI)

**Conventions for every task:**
- Run all commands from `web/` unless stated otherwise (`npx vitest run …`, `npm run typecheck`).
- ⚠️ **Worktree trap:** the Docker stack bind-mounts the MAIN repo (`/Users/adampowis/workspace/murals`). Unit tests/typecheck work fine in a worktree, but any live browser verification requires the edit to exist in the main repo too.
- Do NOT migrate the env-fallback in files that PR 2 will rewrite entirely (`dashboard/page.tsx`, both billing pages, login/signup/verify-email pages, `BetaFeedbackWidget`, `BetaInviteCard`, `SocialLinks`). Touching them twice is churn.

**Branch setup (do first):**
```bash
git checkout -b refactor/web-lib-foundations
```

---

### Task 1: Export base URLs from `lib/api.ts`

**Files:**
- Modify: `web/src/lib/api.ts`
- Test: `web/src/__tests__/api.test.ts` (existing — just run it)

- [ ] **Step 1: Edit `lib/api.ts` to export the computed base URLs**

Replace the whole file with:

```ts
import { createApiClient } from '@render/api-client'

// Server uses API_URL (internal Docker hostname), browser uses NEXT_PUBLIC_API_URL.
// Both fall back to localhost:8080 for non-Docker local dev.
// apiBaseUrl is correct for the current runtime (server or browser);
// publicApiBaseUrl is ALWAYS the browser-reachable URL (for hrefs, QR codes, etc.).
export const publicApiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'

export const apiBaseUrl =
  typeof window === 'undefined'
    ? (process.env.API_URL ?? publicApiBaseUrl)
    : publicApiBaseUrl

export const apiClient = createApiClient({ baseUrl: apiBaseUrl })
```

- [ ] **Step 2: Run the existing api tests + typecheck**

Run: `npx vitest run src/__tests__/api.test.ts && npm run typecheck`
Expected: PASS / clean

- [ ] **Step 3: Commit**

```bash
git add src/lib/api.ts
git commit -m "refactor(web): export apiBaseUrl/publicApiBaseUrl from lib/api"
```

---

### Task 2: `lib/dates.ts` — shared date formatting

**Files:**
- Create: `web/src/lib/dates.ts`
- Create: `web/src/__tests__/lib/dates.test.ts`
- Modify: `web/src/app/(artist)/applications/page.tsx:17-23` (delete local `formatDate`)
- Modify: `web/src/components/ApplicationNotes.tsx:16-18` (delete local `formatDate`)
- Modify: `web/src/app/(public)/festivals/[id]/page.tsx:24-58` (delete local `formatDates`)
- Modify: `web/src/app/organiser/festivals/[id]/applications/page.tsx:509` (inline `toLocaleDateString`)

- [ ] **Step 1: Write the failing tests**

Create `web/src/__tests__/lib/dates.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { formatDate, formatDateRange } from '@/lib/dates'

describe('formatDate', () => {
  it('formats an ISO timestamp as en-GB day month year', () => {
    expect(formatDate('2026-03-15T10:00:00Z')).toBe('15 Mar 2026')
  })
})

describe('formatDateRange', () => {
  it('returns TBC when both dates are missing', () => {
    expect(formatDateRange(null, null)).toBe('TBC')
    expect(formatDateRange(undefined, undefined)).toBe('TBC')
  })

  it('same-year range uses short start date', () => {
    expect(formatDateRange('2027-10-01', '2027-10-03')).toBe('1 Oct – 3 Oct 2027')
  })

  it('cross-year range uses full dates on both sides', () => {
    expect(formatDateRange('2026-12-30', '2027-01-02')).toBe('30 Dec 2026 – 2 Jan 2027')
  })

  it('start-only and end-only fall back to a single full date', () => {
    expect(formatDateRange('2027-10-01', null)).toBe('1 Oct 2027')
    expect(formatDateRange(null, '2027-10-03')).toBe('3 Oct 2027')
  })

  it('parses date-only strings without timezone shifting (regression)', () => {
    // new Date('2027-10-01') is UTC midnight; naive use can render 30 Sep in BST.
    expect(formatDateRange('2027-10-01', '2027-10-01')).toContain('1 Oct')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/lib/dates.test.ts`
Expected: FAIL — `Cannot find module '@/lib/dates'`

- [ ] **Step 3: Create `web/src/lib/dates.ts`**

The range logic is ported verbatim from `(public)/festivals/[id]/page.tsx` (it deliberately parses date-only strings by parts to avoid the UTC-midnight shift):

```ts
/** Format an ISO timestamp (e.g. created_at) as "15 Mar 2026" (en-GB). */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/** Parse a date-only "YYYY-MM-DD" string as a LOCAL date (avoids UTC-midnight shift). */
function parseDateOnly(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function formatDateOnly(dateStr: string): string {
  return parseDateOnly(dateStr).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function formatDateOnlyShort(dateStr: string): string {
  return parseDateOnly(dateStr).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  })
}

/**
 * Human date range for date-only strings ("YYYY-MM-DD").
 * Same-year ranges shorten the start ("1 Oct – 3 Oct 2027"); returns "TBC"
 * when both ends are missing.
 */
export function formatDateRange(
  startDate?: string | null,
  endDate?: string | null,
): string {
  if (!startDate && !endDate) return 'TBC'

  if (startDate && endDate) {
    const [sy] = startDate.split('-').map(Number)
    const [ey] = endDate.split('-').map(Number)
    if (sy === ey) {
      return `${formatDateOnlyShort(startDate)} – ${formatDateOnly(endDate)}`
    }
    return `${formatDateOnly(startDate)} – ${formatDateOnly(endDate)}`
  }

  if (startDate) return formatDateOnly(startDate)
  return formatDateOnly(endDate!)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/lib/dates.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Migrate the four call sites**

`web/src/app/(artist)/applications/page.tsx` — delete lines 17–23 (the local `formatDate`) and add the import. Also switch the festival date range (lines 113–117) to `formatDateRange` (festival dates are date-only strings; the local formatter had the UTC-shift bug):

```ts
import { formatDate, formatDateRange } from '@/lib/dates'
```
and replace
```tsx
{festival.start_date && festival.end_date && (
  <p className="font-sans text-xs text-mid">
    {formatDate(festival.start_date)} – {formatDate(festival.end_date)}
  </p>
)}
```
with
```tsx
{festival.start_date && festival.end_date && (
  <p className="font-sans text-xs text-mid">
    {formatDateRange(festival.start_date, festival.end_date)}
  </p>
)}
```

`web/src/components/ApplicationNotes.tsx` — delete lines 16–18 and add `import { formatDate } from '@/lib/dates'`.

`web/src/app/(public)/festivals/[id]/page.tsx` — delete the whole `formatDates` function (lines 24–58), add `import { formatDateRange } from '@/lib/dates'`, and rename the one call site from `formatDates(...)` to `formatDateRange(...)` (search the file for `formatDates(`).

`web/src/app/organiser/festivals/[id]/applications/page.tsx:509` — replace
```tsx
{new Date(releasedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
```
with `{formatDate(releasedAt)}` and add `import { formatDate } from '@/lib/dates'` to the imports block.

- [ ] **Step 6: Run the affected test files + typecheck**

Run: `npx vitest run src/__tests__/artist/applications-page.test.tsx src/__tests__/festivals/festival-page.test.tsx src/__tests__/organiser/applications-page.test.tsx && npm run typecheck`
Expected: PASS / clean. (Note: same-year festival ranges now render as "1 Oct – 3 Oct 2027" on the artist applications page — if a test asserted the old "1 Oct 2027 – 3 Oct 2027" format, update the assertion; the new format is the intended shared behaviour.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/dates.ts src/__tests__/lib/dates.test.ts "src/app/(artist)/applications/page.tsx" src/components/ApplicationNotes.tsx "src/app/(public)/festivals/[id]/page.tsx" "src/app/organiser/festivals/[id]/applications/page.tsx"
git commit -m "refactor(web): shared date formatting in lib/dates"
```

---

### Task 3: `lib/collections.ts` — collection status maps

**Files:**
- Create: `web/src/lib/collections.ts`
- Modify: `web/src/app/(public)/artists/[id]/collections/[collectionId]/page.tsx:13-23`
- Modify: `web/src/app/(public)/artists/[id]/page.tsx:91-101`

- [ ] **Step 1: Create `web/src/lib/collections.ts`**

(Pure constants — no unit test needed; the page tests cover rendering.)

```ts
/** Display labels for collection.status. Single source — used by all public pages. */
export const COLLECTION_STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  archived: 'Archived',
  ongoing: 'Ongoing',
}

/** Badge classes for collection.status (design tokens only). */
export const COLLECTION_STATUS_BADGES: Record<string, string> = {
  active: 'bg-amber text-ink',
  archived: 'bg-warm text-mid border border-light',
  ongoing: 'bg-clay text-offwhite',
}

/** Fallback badge class for unknown statuses. */
export const COLLECTION_STATUS_BADGE_FALLBACK = 'bg-warm text-mid'
```

- [ ] **Step 2: Migrate the public collection page**

`web/src/app/(public)/artists/[id]/collections/[collectionId]/page.tsx` — delete the `statusLabel` and `statusColour` consts (lines 13–23), add:

```ts
import {
  COLLECTION_STATUS_LABELS,
  COLLECTION_STATUS_BADGES,
  COLLECTION_STATUS_BADGE_FALLBACK,
} from '@/lib/collections'
```

and update the badge JSX (currently around line 99):

```tsx
<span
  className={`font-mono text-xs uppercase tracking-widest px-2 py-0.5 rounded shrink-0 mt-3 ${COLLECTION_STATUS_BADGES[collection.status] ?? COLLECTION_STATUS_BADGE_FALLBACK}`}
>
  {COLLECTION_STATUS_LABELS[collection.status] ?? collection.status}
</span>
```

- [ ] **Step 3: Migrate the public artist page**

`web/src/app/(public)/artists/[id]/page.tsx` — delete the `statusLabel`/`statusColour` consts from the component body (lines 91–101), add the same import, and update their two usages further down the file (search for `statusLabel[` and `statusColour[`) to `COLLECTION_STATUS_LABELS[...]` / `COLLECTION_STATUS_BADGES[...] ?? COLLECTION_STATUS_BADGE_FALLBACK`.

- [ ] **Step 4: Run affected tests + typecheck**

Run: `npx vitest run src/__tests__/artists/ && npm run typecheck`
Expected: PASS / clean

- [ ] **Step 5: Commit**

```bash
git add src/lib/collections.ts "src/app/(public)/artists/[id]/collections/[collectionId]/page.tsx" "src/app/(public)/artists/[id]/page.tsx"
git commit -m "refactor(web): shared collection status maps in lib/collections"
```

---

### Task 4: `lib/festivals.ts` — festival status maps

**Files:**
- Create: `web/src/lib/festivals.ts`
- Modify: `web/src/app/(public)/festivals/[id]/page.tsx:60-72`
- Modify: `web/src/app/organiser/festivals/page.tsx:12-17`

Labels are shared; the two colour treatments are deliberately different (public badge vs organiser text accent) and stay separate named exports.

- [ ] **Step 1: Create `web/src/lib/festivals.ts`**

```ts
import type { components } from '@render/api-client'

type FestivalStatus = components['schemas']['FestivalStatus']

/** Display labels for festival.status. */
export const FESTIVAL_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  open: 'Open',
  live: 'Live',
  archived: 'Archived',
}

/** Badge classes for public festival pages. */
export const FESTIVAL_STATUS_BADGES: Record<string, string> = {
  draft: 'bg-warm text-mid border-light',
  open: 'bg-amber/20 text-amber border-amber/30',
  live: 'bg-clay/20 text-clay border-clay/30',
  archived: 'bg-warm text-mid border-light',
}

/** Text-accent classes for the organiser festivals list. */
export const FESTIVAL_STATUS_TEXT: Record<FestivalStatus, string> = {
  draft: 'text-mid',
  open: 'text-amber',
  live: 'text-clay',
  archived: 'text-mid',
}
```

- [ ] **Step 2: Migrate both pages**

`web/src/app/(public)/festivals/[id]/page.tsx` — delete the local `STATUS_LABELS`/`STATUS_COLORS` (lines 60–72), add `import { FESTIVAL_STATUS_LABELS, FESTIVAL_STATUS_BADGES } from '@/lib/festivals'`, update lines 93–94:

```ts
const statusLabel = FESTIVAL_STATUS_LABELS[status] ?? status
const statusColor = FESTIVAL_STATUS_BADGES[status] ?? FESTIVAL_STATUS_BADGES.draft
```

`web/src/app/organiser/festivals/page.tsx` — delete the local `STATUS_COLORS` (lines 12–17), add `import { FESTIVAL_STATUS_TEXT } from '@/lib/festivals'`, and rename its usage (search for `STATUS_COLORS[`) to `FESTIVAL_STATUS_TEXT[`.

- [ ] **Step 3: Run affected tests + typecheck**

Run: `npx vitest run src/__tests__/festivals/festival-page.test.tsx src/__tests__/organiser/festivals-page.test.tsx && npm run typecheck`
Expected: PASS / clean

- [ ] **Step 4: Commit**

```bash
git add src/lib/festivals.ts "src/app/(public)/festivals/[id]/page.tsx" src/app/organiser/festivals/page.tsx
git commit -m "refactor(web): shared festival status maps in lib/festivals"
```

---

### Task 5: `lib/murals.ts` — fix the inconsistent mural-status colours

**Files:**
- Create: `web/src/lib/murals.ts`
- Create: `web/src/__tests__/lib/murals.test.ts`
- Modify: `web/src/app/(public)/artists/[id]/MuralMap.tsx:35-36`
- Modify: `web/src/app/organiser/festivals/[id]/map/MapEditorClient.tsx:733`

**Bug being fixed:** organiser editor uses `#E2DDD6` for `unknown`, public map uses `#C0BDB8` (not a token). Unify on `#E2DDD6` (the `--color-light` design token).

- [ ] **Step 1: Write the failing test**

Create `web/src/__tests__/lib/murals.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { muralStatusColour, MURAL_STATUS_COLOURS } from '@/lib/murals'

describe('muralStatusColour', () => {
  it('maps each known status to its design-token hex', () => {
    expect(muralStatusColour('permanent')).toBe('#E8A838') // --color-amber
    expect(muralStatusColour('temporary')).toBe('#8A8896') // --color-mid
    expect(muralStatusColour('unknown')).toBe('#E2DDD6') // --color-light
  })

  it('falls back to the unknown colour for missing/unrecognised statuses', () => {
    expect(muralStatusColour(undefined)).toBe(MURAL_STATUS_COLOURS.unknown)
    expect(muralStatusColour(null)).toBe(MURAL_STATUS_COLOURS.unknown)
    expect(muralStatusColour('graffiti')).toBe(MURAL_STATUS_COLOURS.unknown)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/lib/murals.test.ts`
Expected: FAIL — `Cannot find module '@/lib/murals'`

- [ ] **Step 3: Create `web/src/lib/murals.ts`**

```ts
/**
 * Mural-status → marker colour, shared by the public MuralMap and the
 * organiser map editor. Hexes mirror the design tokens in globals.css
 * (Leaflet divIcon/CircleMarker HTML can't use Tailwind classes).
 */
export const MURAL_STATUS_COLOURS: Record<string, string> = {
  permanent: '#E8A838', // --color-amber
  temporary: '#8A8896', // --color-mid
  unknown: '#E2DDD6', // --color-light
}

export function muralStatusColour(status: string | null | undefined): string {
  return MURAL_STATUS_COLOURS[status ?? 'unknown'] ?? MURAL_STATUS_COLOURS.unknown
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/lib/murals.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Migrate both maps**

`web/src/app/(public)/artists/[id]/MuralMap.tsx` — add `import { muralStatusColour } from '@/lib/murals'`, delete line 35–36 (`const statusColor = (s: string) => …`), and rename its usage in the JSX below (search for `statusColor(`) to `muralStatusColour(`.

`web/src/app/organiser/festivals/[id]/map/MapEditorClient.tsx:733` — add `import { muralStatusColour } from '@/lib/murals'` and replace:

```ts
const color = e.mural_status === 'permanent' ? '#E8A838' : e.mural_status === 'temporary' ? '#8A8896' : '#E2DDD6'
```
with
```ts
const color = muralStatusColour(e.mural_status)
```

- [ ] **Step 6: Run affected tests + typecheck**

Run: `npx vitest run src/__tests__/organiser/map-editor-page.test.tsx src/__tests__/artists/ && npm run typecheck`
Expected: PASS / clean

- [ ] **Step 7: Commit**

```bash
git add src/lib/murals.ts src/__tests__/lib/murals.test.ts "src/app/(public)/artists/[id]/MuralMap.tsx" "src/app/organiser/festivals/[id]/map/MapEditorClient.tsx"
git commit -m "fix(web): unify mural-status colours in lib/murals (organiser/public divergence)"
```

---

### Task 6: `createAuthedServerClient()` — kill the 6× cookie-injection copy-paste

**Files:**
- Modify: `web/src/lib/auth-server.ts`
- Modify: `web/src/app/(artist)/profile/page.tsx:15-23`
- Modify: `web/src/app/(artist)/profile/preview/page.tsx:12-23`
- Modify: `web/src/app/(artist)/profile/setup/page.tsx:9-17`
- Modify: `web/src/app/(artist)/analytics/page.tsx:18-26`
- Test: `web/src/__tests__/auth/auth-server.test.ts` (extend)

- [ ] **Step 1: Read the existing test file's mocking pattern**

Run: `sed -n '1,40p' src/__tests__/auth/auth-server.test.ts`
It mocks `next/headers` (cookies) and `@render/api-client`. Follow the same pattern for the new tests.

- [ ] **Step 2: Write failing tests for the new helper**

Append to `web/src/__tests__/auth/auth-server.test.ts` (adapting to the file's existing mock setup — the assertions below are the contract):

```ts
describe('createAuthedServerClient', () => {
  it('returns null when there is no session cookie', async () => {
    // arrange: cookies() mock returns no 'session' cookie (same arrangement
    // the existing getSessionUser "no cookie" test uses)
    const client = await createAuthedServerClient()
    expect(client).toBeNull()
  })

  it('returns a client with cookie middleware when a session exists', async () => {
    // arrange: cookies() mock returns { name: 'session', value: 'tok123' }
    const client = await createAuthedServerClient()
    expect(client).not.toBeNull()
    // the mocked createApiClient captures .use() calls — assert one was registered
    // (same spy style the existing tests use for the apiClient mock)
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run src/__tests__/auth/auth-server.test.ts`
Expected: FAIL — `createAuthedServerClient` is not exported

- [ ] **Step 4: Implement in `lib/auth-server.ts` and refactor its internals**

Add near the top (after the imports; also add `import { apiBaseUrl } from './api'`):

```ts
type ApiClient = ReturnType<typeof createApiClient>

/**
 * Per-request API client with the session cookie injected. Returns null when
 * there is no session cookie — callers decide whether that means redirect,
 * 403, or anonymous fallback. This is THE way to make authed API calls from
 * Server Components; never reuse the singleton apiClient for authed calls.
 */
export async function createAuthedServerClient(): Promise<ApiClient | null> {
  const cookieStore = await cookies()
  const sessionValue = cookieStore.get('session')?.value
  if (!sessionValue) return null

  const client = createApiClient({ baseUrl: apiBaseUrl })
  client.use({
    onRequest({ request }) {
      request.headers.set('Cookie', `session=${sessionValue}`)
      return request
    },
  })
  return client
}
```

Then refactor the two internal duplicates to use it:

`getSessionUser` becomes:

```ts
export async function getSessionUser(): Promise<User | null> {
  const authedClient = await createAuthedServerClient()
  if (!authedClient) return null

  const { data, response } = await authedClient.GET('/me', {})
  if (response.status === 401 || !data) return null
  return data
}
```

`isProfileOwner` becomes:

```ts
export async function isProfileOwner(profileId: string): Promise<boolean> {
  const authedClient = await createAuthedServerClient()
  if (!authedClient) return false

  const { data, response } = await authedClient.GET('/profiles/me', {})
  if (response.status === 401 || !data) return false
  return data.id === profileId
}
```

Keep the existing doc comments on both functions. `requireAuth` is unchanged.

- [ ] **Step 5: Run the auth tests**

Run: `npx vitest run src/__tests__/auth/auth-server.test.ts`
Expected: PASS (existing + 2 new)

- [ ] **Step 6: Migrate the four server pages**

In each file below: delete the local `cookies()` read + `createApiClient` + `.use(...)` block, remove now-unused `cookies`/`createApiClient` imports, and add `createAuthedServerClient` to the existing `@/lib/auth-server` import.

`web/src/app/(artist)/profile/page.tsx` (lines 15–23) → the page already calls `requireAuth()`, so a session must exist; still handle the race where the cookie vanished:

```ts
const authedClient = await createAuthedServerClient()
if (!authedClient) redirect('/login')
```

`web/src/app/(artist)/profile/setup/page.tsx` (lines 9–17): same replacement (it has `redirect` imported already; if not, add it).

`web/src/app/(artist)/profile/preview/page.tsx` (lines 12–23): same replacement (the local variable there is named `client` — keep the name to minimise the diff).

`web/src/app/(artist)/analytics/page.tsx` (lines 18–26): same replacement.

- [ ] **Step 7: Run the full unit suite + typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: 182+ tests PASS / clean. The four migrated pages are server components covered indirectly; typecheck catches signature mistakes.

- [ ] **Step 8: Commit**

```bash
git add src/lib/auth-server.ts src/__tests__/auth/auth-server.test.ts "src/app/(artist)/profile/page.tsx" "src/app/(artist)/profile/preview/page.tsx" "src/app/(artist)/profile/setup/page.tsx" "src/app/(artist)/analytics/page.tsx"
git commit -m "refactor(web): createAuthedServerClient() replaces 6x cookie-injection copy-paste"
```

---

### Task 7: Merge the two upload hooks into `useImageUpload`

**Files:**
- Create: `web/src/hooks/useImageUpload.ts`
- Create: `web/src/__tests__/hooks/useImageUpload.test.ts`
- Modify: `web/src/app/(artist)/collections/[id]/page.tsx:22,183`
- Modify: `web/src/app/(artist)/profile/ProfileForm.tsx:8,46-57`
- Modify: `web/src/app/(artist)/profile/setup/ProfileWizard.tsx:12,122-127,333`
- Modify: `web/src/__tests__/artist/collection-detail-page.test.tsx:16-27` (mock path)
- Delete: `web/src/hooks/useUploadImage.ts`, `web/src/hooks/useProfileImageUpload.ts`

**Design:** one hook owning presign → PUT → confirm; the post-confirm step is a caller callback. Errors thrown inside the callback are caught by the hook (state → `'error'`), so collection-attach failures surface exactly as before.

- [ ] **Step 1: Write the failing tests**

Create `web/src/__tests__/hooks/useImageUpload.test.ts`:

```ts
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('@/lib/api', () => ({
  apiClient: { POST: vi.fn() },
}))

import { apiClient } from '@/lib/api'
import { useImageUpload } from '@/hooks/useImageUpload'

const mockPOST = vi.mocked(apiClient.POST)
const file = new File(['x'], 'mural.jpg', { type: 'image/jpeg' })

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
})

describe('useImageUpload', () => {
  it('runs presign → PUT → confirm → onUploaded with cdnUrl and s3Key', async () => {
    mockPOST
      .mockResolvedValueOnce({ data: { uploadUrl: 'http://minio/put', s3Key: 'k1' }, error: undefined } as never)
      .mockResolvedValueOnce({ data: { cdnUrl: 'http://cdn/k1' }, error: undefined } as never)
    const onUploaded = vi.fn()
    const { result } = renderHook(() => useImageUpload(onUploaded))

    await act(() => result.current.upload(file))

    expect(mockPOST).toHaveBeenNthCalledWith(1, '/images/presign', {
      body: { contentType: 'image/jpeg' },
    })
    expect(fetch).toHaveBeenCalledWith('http://minio/put', {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: file,
    })
    expect(mockPOST).toHaveBeenNthCalledWith(2, '/images/confirm', { body: { s3Key: 'k1' } })
    expect(onUploaded).toHaveBeenCalledWith({ cdnUrl: 'http://cdn/k1', s3Key: 'k1' })
    expect(result.current.state).toBe('idle')
    expect(result.current.error).toBeNull()
  })

  it('sets error state when presign fails', async () => {
    mockPOST.mockResolvedValueOnce({ data: undefined, error: { message: 'nope' } } as never)
    const { result } = renderHook(() => useImageUpload(vi.fn()))

    await act(() => result.current.upload(file))

    expect(result.current.state).toBe('error')
    expect(result.current.error).toBe('Failed to get upload URL')
  })

  it('sets error state when the S3 PUT fails', async () => {
    mockPOST.mockResolvedValueOnce({ data: { uploadUrl: 'http://minio/put', s3Key: 'k1' }, error: undefined } as never)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    const { result } = renderHook(() => useImageUpload(vi.fn()))

    await act(() => result.current.upload(file))

    expect(result.current.state).toBe('error')
    expect(result.current.error).toBe('Failed to upload file')
  })

  it('catches errors thrown by onUploaded (e.g. attach failure)', async () => {
    mockPOST
      .mockResolvedValueOnce({ data: { uploadUrl: 'http://minio/put', s3Key: 'k1' }, error: undefined } as never)
      .mockResolvedValueOnce({ data: { cdnUrl: 'http://cdn/k1' }, error: undefined } as never)
    const { result } = renderHook(() =>
      useImageUpload(() => {
        throw new Error('Failed to attach image')
      }),
    )

    await act(() => result.current.upload(file))

    expect(result.current.state).toBe('error')
    expect(result.current.error).toBe('Failed to attach image')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/__tests__/hooks/useImageUpload.test.ts`
Expected: FAIL — `Cannot find module '@/hooks/useImageUpload'`

- [ ] **Step 3: Create `web/src/hooks/useImageUpload.ts`**

```ts
'use client'

import { useState } from 'react'
import { apiClient } from '@/lib/api'

type UploadState = 'idle' | 'uploading' | 'error'

export interface UploadedImage {
  cdnUrl: string
  s3Key: string
}

/**
 * The full image-upload choreography: presign → PUT to S3/MinIO → confirm.
 * What happens to the confirmed image is the caller's business — attach it to
 * a collection, set it as an avatar, etc. — via onUploaded. Errors thrown by
 * onUploaded are caught and surfaced through the hook's error state.
 */
export function useImageUpload(
  onUploaded: (img: UploadedImage) => void | Promise<void>,
) {
  const [state, setState] = useState<UploadState>('idle')
  const [error, setError] = useState<string | null>(null)

  async function upload(file: File): Promise<void> {
    setState('uploading')
    setError(null)
    try {
      // 1. Presign
      const presignRes = await apiClient.POST('/images/presign', {
        body: { contentType: file.type as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' },
      })
      if (presignRes.error || !presignRes.data) throw new Error('Failed to get upload URL')
      const { uploadUrl, s3Key } = presignRes.data

      // 2. PUT to S3/MinIO (presigned URL — not our API, raw fetch is correct here)
      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      })
      if (!putRes.ok) throw new Error('Failed to upload file')

      // 3. Confirm
      const confirmRes = await apiClient.POST('/images/confirm', { body: { s3Key } })
      if (confirmRes.error || !confirmRes.data) throw new Error('Failed to confirm upload')

      // 4. Caller's post-upload step
      await onUploaded({ cdnUrl: confirmRes.data.cdnUrl, s3Key })

      setState('idle')
    } catch (err) {
      setState('error')
      setError(err instanceof Error ? err.message : 'Upload failed')
    }
  }

  return { upload, state, error, isUploading: state === 'uploading' }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/__tests__/hooks/useImageUpload.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Migrate the collection editor**

`web/src/app/(artist)/collections/[id]/page.tsx` — replace the import at line 22:

```ts
import { useImageUpload } from '@/hooks/useImageUpload'
```

and line 183:

```ts
const { upload, isUploading, error: uploadError } = useImageUpload(async ({ cdnUrl, s3Key }) => {
  const attachRes = await apiClient.POST('/collections/{collectionID}/images', {
    params: { path: { collectionID: collectionId } },
    body: { s3Key, cdnUrl },
  })
  if (attachRes.error) throw new Error('Failed to attach image')
  queryClient.invalidateQueries({ queryKey: ['collection-images', collectionId] })
})
```

(Check what the old code did after attach — if the existing page already invalidates `collection-images` elsewhere after upload, don't double it; mirror current behaviour exactly.)

- [ ] **Step 6: Migrate ProfileForm and ProfileWizard**

`web/src/app/(artist)/profile/ProfileForm.tsx` — line 8 import becomes `import { useImageUpload } from '@/hooks/useImageUpload'`; lines 46–57 callbacks change shape from `url => …` to `({ cdnUrl }) => …`:

```ts
const { upload: uploadAvatar, isUploading: avatarUploading } = useImageUpload(
  ({ cdnUrl }) => setAvatarUrl(cdnUrl)
)
const { upload: uploadHeadline0, isUploading: headline0Uploading } = useImageUpload(
  ({ cdnUrl }) => setHeadlineUrls(prev => { const n = [...prev]; n[0] = cdnUrl; return n })
)
const { upload: uploadHeadline1, isUploading: headline1Uploading } = useImageUpload(
  ({ cdnUrl }) => setHeadlineUrls(prev => { const n = [...prev]; n[1] = cdnUrl; return n })
)
const { upload: uploadHeadline2, isUploading: headline2Uploading } = useImageUpload(
  ({ cdnUrl }) => setHeadlineUrls(prev => { const n = [...prev]; n[2] = cdnUrl; return n })
)
```

`web/src/app/(artist)/profile/setup/ProfileWizard.tsx` — line 12 import; lines 122–127 and 333:

```ts
const { upload: uploadAvatar, isUploading: avatarUploading } = useImageUpload(({ cdnUrl }) => patch('avatarUrl', cdnUrl))
const h0 = useImageUpload(({ cdnUrl }) => setHeadline(0, cdnUrl))
const h1 = useImageUpload(({ cdnUrl }) => setHeadline(1, cdnUrl))
const h2 = useImageUpload(({ cdnUrl }) => setHeadline(2, cdnUrl))
// …line 333:
const cover = useImageUpload(({ cdnUrl, s3Key }) => { setCoverUrl(cdnUrl); setCoverKey(s3Key) })
```

- [ ] **Step 7: Update the test mock, delete the old hooks**

`web/src/__tests__/artist/collection-detail-page.test.tsx` lines 16–27 — change every `@/hooks/useUploadImage` to `@/hooks/useImageUpload` and `useUploadImage` to `useImageUpload` (the mocked return shape `{ upload, isUploading, error }` is unchanged).

```bash
rm src/hooks/useUploadImage.ts src/hooks/useProfileImageUpload.ts
grep -rn "useUploadImage\|useProfileImageUpload" src/   # must return nothing
```

- [ ] **Step 8: Run the full suite + typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: PASS / clean

- [ ] **Step 9: Commit**

```bash
git add -A src/hooks/ src/__tests__/hooks/ "src/app/(artist)/collections/[id]/page.tsx" "src/app/(artist)/profile/ProfileForm.tsx" "src/app/(artist)/profile/setup/ProfileWizard.tsx" src/__tests__/artist/collection-detail-page.test.tsx
git commit -m "refactor(web): merge upload hooks into useImageUpload"
```

---

### Task 8: endorse/endorsements pages → React Query + singleton client

**Files:**
- Modify: `web/src/app/(artist)/endorsements/page.tsx`
- Modify: `web/src/app/(artist)/endorse/[profileID]/page.tsx`

Both pages currently `createApiClient` at module scope and fetch in `useEffect` with **no error handling**. Markup stays identical; only the data layer changes.

- [ ] **Step 1: Rewrite `endorsements/page.tsx` data layer**

Replace lines 1–36 (imports, module client, state, useEffect, toggleVisibility, loading return) with:

```tsx
'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { components } from '@render/api-client'

type Endorsement = components['schemas']['EndorsementResponse']

export default function EndorsementsPage() {
  const queryClient = useQueryClient()

  const endorsementsQuery = useQuery({
    queryKey: ['endorsements-received'],
    queryFn: async () => {
      const res = await apiClient.GET('/endorsements/received', {})
      if (res.error) throw new Error('Failed to load endorsements')
      return res.data?.endorsements ?? []
    },
  })
  const endorsements = endorsementsQuery.data ?? []

  const toggleMutation = useMutation({
    mutationFn: async ({ id, hidden }: { id: string; hidden: boolean }) => {
      const res = await apiClient.PATCH('/endorsements/{endorsementID}/visibility', {
        params: { path: { endorsementID: id } },
        body: { hidden },
      })
      if (res.error || !res.data) throw new Error('Failed to update visibility')
      return res.data
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<Endorsement[]>(['endorsements-received'], (prev) =>
        (prev ?? []).map((e) => (e.id === updated.id ? updated : e)),
      )
    },
  })

  function toggleVisibility(id: string, currentHidden: boolean) {
    toggleMutation.mutate({ id, hidden: !currentHidden })
  }

  if (endorsementsQuery.isLoading) {
    return <p className="font-sans text-mid">Loading…</p>
  }

  if (endorsementsQuery.isError) {
    return (
      <p role="alert" className="font-sans text-clay">
        Couldn&apos;t load endorsements. Refresh to try again.
      </p>
    )
  }
```

Everything from `return (` / `<div>` down (the JSX) is unchanged — the existing `toggleVisibility(e.id, e.hidden_by_endorsee)` onClick keeps working with the new function.

- [ ] **Step 2: Rewrite `endorse/[profileID]/page.tsx` data layer**

Changes only — the form JSX and `submit` body are untouched:

1. Replace imports/module client (lines 3–12):
```ts
import { useState, use } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { components } from '@render/api-client'

type Festival = components['schemas']['Festival']
```
2. Delete the `ownedFestivals` useState (line 23) and the `useEffect` (lines 27–31); add inside the component:
```ts
const festivalsQuery = useQuery({
  queryKey: ['my-festivals'],
  queryFn: async () => {
    const res = await apiClient.GET('/festivals', {})
    if (res.error) throw new Error('Failed to load festivals')
    return (res.data ?? []) as Festival[]
  },
})
const ownedFestivals = festivalsQuery.data ?? []
```
(A failure here just hides the "Festival organiser" option — acceptable degradation for an optional affordance; the query error is not fatal to the form.)
3. In `submit`, replace the two `client.POST` references with `apiClient.POST` (same arguments).

- [ ] **Step 3: Run suite + typecheck, verify in browser**

Run: `npx vitest run && npm run typecheck`
Expected: PASS / clean

If the stack is up (`task up` from repo root), log in as `ladygabe@demo.art` / `demo-password-2027` and load `http://localhost:3000/endorsements` — list renders, Hide/Show toggles still work. (Worktree? Mirror the edits to the main repo first.)

- [ ] **Step 4: Commit**

```bash
git add "src/app/(artist)/endorsements/page.tsx" "src/app/(artist)/endorse/[profileID]/page.tsx"
git commit -m "refactor(web): endorse pages use React Query + singleton apiClient"
```

---

### Task 9: Stop swallowing API errors in query functions

**Files:**
- Modify: `web/src/app/(artist)/applications/page.tsx:26-48,58,97`
- Modify: `web/src/app/organiser/reviewing/page.tsx:11-44`
- Modify: `web/src/app/organiser/dashboard/page.tsx:11-18`
- Modify: `web/src/app/organiser/festivals/[id]/ReviewersSection.tsx:53-62`
- Modify: `web/src/app/(artist)/applications/apply/[id]/page.tsx:55-76`

**Pattern:** `queryFn` throws on `res.error`; the page renders `isError` distinctly from the empty state. (React Query's default retry of 3 stays — transient blips self-heal.)

- [ ] **Step 1: Artist applications page**

`web/src/app/(artist)/applications/page.tsx` — in both queryFns replace `if (res.error) return []` with:

```ts
if (res.error) throw new Error('Failed to load applications')   // line 30
if (res.error) throw new Error('Failed to load festivals')      // line 41
```

Add after line 48 (`const isLoading = …`):

```ts
const isError = applicationsQuery.isError || festivalsQuery.isError
```

In the "My applications" section, change the empty-state guard (line 60) to `{!isLoading && !isError && applications.length === 0 && (…)}` and add directly above it:

```tsx
{isError && (
  <p role="alert" className="font-sans text-sm text-clay">
    Couldn&apos;t load your applications. Refresh to try again.
  </p>
)}
```

In the "Open festivals" section, change the empty-state guard (line 97) to `{!isLoading && !isError && festivals.length === 0 && (…)}`.

- [ ] **Step 2: Organiser reviewing page**

`web/src/app/organiser/reviewing/page.tsx` — queryFn (lines 14–16) becomes:

```ts
const res = await apiClient.GET('/me/reviewing')
if (res.error) throw new Error('Failed to load reviewing festivals')
return (res.data ?? []) as FestivalSummary[]
```

Change the empty-state guard (line 40) to `{!reviewingQuery.isLoading && !reviewingQuery.isError && festivals.length === 0 && (…)}` and add above it:

```tsx
{reviewingQuery.isError && (
  <p role="alert" className="font-sans text-sm text-clay">
    Couldn&apos;t load your reviewing list. Refresh to try again.
  </p>
)}
```

- [ ] **Step 3: Organiser dashboard**

`web/src/app/organiser/dashboard/page.tsx` — queryFn (lines 14–16): same throw pattern (`'Failed to load reviewing festivals'`). The "Reviewing" card is an optional affordance; on error simply don't render it — `reviewing.length > 0` already handles that since `data` stays `undefined`. No UI change needed; just stop masking the error so React Query retries and devtools/error tracking see it.

- [ ] **Step 4: ReviewersSection**

`web/src/app/organiser/festivals/[id]/ReviewersSection.tsx` — queryFn (line 59) becomes `if (res.error) throw new Error('Failed to load reviewers')`. Find the reviewers empty-state render in the JSX below (it gates on `!reviewersQuery.isLoading && reviewers.length === 0`) and add `&& !reviewersQuery.isError` to that gate, plus above it:

```tsx
{reviewersQuery.isError && (
  <p role="alert" className="font-sans text-sm text-clay">
    Couldn&apos;t load reviewers. Refresh to try again.
  </p>
)}
```

- [ ] **Step 5: Apply page — preserve the 404-means-no-profile case**

`web/src/app/(artist)/applications/apply/[id]/page.tsx` — the profile queryFn (lines 57–61) must keep returning `null` on 404 (artist without a profile is a legitimate state) but throw on real failures:

```ts
const res = await apiClient.GET('/profiles/me')
if (res.response.status === 404) return null
if (res.error) throw new Error('Failed to load profile')
return (res.data ?? null) as ArtistProfile | null
```

The collections queryFn (line 72) becomes `if (res.error) throw new Error('Failed to load collections')`.

Find the page's main loading gate (search for `isLoading` in the render section) and add an error branch alongside it:

```tsx
if (profileQuery.isError || collectionsQuery.isError) {
  return (
    <p role="alert" className="font-sans text-clay">
      Couldn&apos;t load your details. Refresh to try again.
    </p>
  )
}
```

- [ ] **Step 6: Run the suite + typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: PASS / clean. (The page tests mock `useQuery` itself, so changed queryFns don't affect them; if any test asserted the old empty-state text while simulating an error, update it to expect the alert.)

- [ ] **Step 7: Commit**

```bash
git add "src/app/(artist)/applications/page.tsx" src/app/organiser/reviewing/page.tsx src/app/organiser/dashboard/page.tsx "src/app/organiser/festivals/[id]/ReviewersSection.tsx" "src/app/(artist)/applications/apply/[id]/page.tsx"
git commit -m "fix(web): surface API errors instead of rendering empty states"
```

---

### Task 10: Error boundaries + site favicon

**Files:**
- Create: `web/src/app/error.tsx`
- Create: `web/src/app/global-error.tsx`
- Create: `web/src/app/icon.svg`

- [ ] **Step 1: Create `web/src/app/error.tsx`**

```tsx
'use client'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <main className="min-h-screen bg-offwhite flex items-center justify-center px-6">
      <div className="text-center max-w-md">
        <p className="font-mono text-xs uppercase tracking-widest text-mid mb-3">Error</p>
        <h1 className="font-serif text-4xl text-ink mb-3">Something went wrong</h1>
        <p className="font-sans text-mid mb-8">
          An unexpected error occurred. It&apos;s been logged — try again, or head back home.
        </p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={reset}
            className="font-mono text-xs uppercase tracking-widest bg-ink text-offwhite px-6 py-2 rounded hover:bg-amber hover:text-ink transition-colors"
          >
            Try again
          </button>
          <a
            href="/"
            className="font-mono text-xs uppercase tracking-widest text-mid border border-light px-6 py-2 rounded hover:text-ink transition-colors"
          >
            Home
          </a>
        </div>
      </div>
    </main>
  )
}
```

- [ ] **Step 2: Create `web/src/app/global-error.tsx`**

Catches errors in the root layout itself, so it must render its own `<html>`/`<body>` and can't rely on `globals.css` being loaded — inline the colours:

```tsx
'use client'

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en">
      <body style={{ background: '#FAF7F2', color: '#1A1A2E', fontFamily: 'Georgia, serif', display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', margin: 0 }}>
        <div style={{ textAlign: 'center' }}>
          <h1 style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>Something went wrong</h1>
          <button
            onClick={reset}
            style={{ background: '#1A1A2E', color: '#FAF7F2', border: 0, padding: '0.6rem 1.5rem', borderRadius: 6, cursor: 'pointer', letterSpacing: '0.1em', textTransform: 'uppercase', fontSize: '0.7rem' }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}
```

- [ ] **Step 3: Create `web/src/app/icon.svg`** (paint-drop on ink, brand tokens)

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#1A1A2E"/>
  <path d="M32 10c-7 11-14 18-14 27a14 14 0 0 0 28 0c0-9-7-16-14-27z" fill="#E8A838"/>
</svg>
```

Next.js App Router serves `app/icon.svg` automatically and injects the `<link rel="icon">` tag — no `layout.tsx` change needed.

- [ ] **Step 4: Verify live**

With the stack up (and edits present in the main repo if working from a worktree):

```bash
curl -sf -o /dev/null -w "%{http_code}\n" http://localhost:3000/icon.svg   # expect 200
```
Load any page in Playwright/browser and confirm the console no longer logs a favicon 404, and the tab shows the icon.

- [ ] **Step 5: Run gates + commit**

Run: `npm run lint && npm run typecheck && npx vitest run`
Expected: clean / PASS

```bash
git add src/app/error.tsx src/app/global-error.tsx src/app/icon.svg
git commit -m "feat(web): branded error boundaries + site favicon"
```

---

### Task 11: Spec updates, full gates, PR

**Files:**
- Modify: `web/src/lib/lib.spec.md` (Contract + Changelog)
- Modify: `web/src/app/(artist)/artist.spec.md` (Changelog)

- [ ] **Step 1: Update `lib.spec.md`**

Under `## Contract`, add a bullet list of the new modules (adapt to the section's existing style):

```markdown
- `dates.ts` — `formatDate(iso)`, `formatDateRange(start?, end?)`: all user-facing date strings (en-GB). Date-only strings are parsed as local dates (no UTC shift).
- `collections.ts` / `festivals.ts` — status label & colour-class maps. Labels are shared; colour treatments are per-context named exports.
- `murals.ts` — `muralStatusColour(status)`: the single mural-status → marker-hex mapping (hexes mirror design tokens).
- `api.ts` additionally exports `apiBaseUrl` (runtime-correct) and `publicApiBaseUrl` (always browser-reachable). Never hand-roll the env fallback.
- `auth-server.ts` exports `createAuthedServerClient()` — THE way to make authed API calls from Server Components (returns null with no session).
```

Under `## Changelog`, add:

```markdown
2026-06-10 — PR1 consolidation: added dates.ts, collections.ts, festivals.ts, murals.ts; api.ts exports apiBaseUrl/publicApiBaseUrl; auth-server.ts exports createAuthedServerClient(). Mural-status colour divergence fixed (unknown = --color-light).
```

- [ ] **Step 2: Update `artist.spec.md` Changelog**

```markdown
2026-06-10 — upload hooks merged into hooks/useImageUpload (post-confirm step is a caller callback); endorse/endorsements pages migrated to React Query + singleton apiClient; queryFns now throw on API error (isError UI instead of silent empty states).
```

- [ ] **Step 3: Full gates from `web/`**

Run: `npm run lint && npm run typecheck && npx vitest run`
Expected: lint = only the 13 pre-existing `no-img-element` warnings, typecheck clean, all tests pass (182 + ~12 new).

- [ ] **Step 4: E2E smoke (repo root, stack up)**

```bash
cd /Users/adampowis/workspace/murals && task e2e:api
npx playwright test e2e/browser/artist-onboarding.spec.ts
```
Expected: PASS. (Uploads, profile setup, and applications are the flows this PR touched. ⚠️ If in a worktree, the compose stack runs the MAIN repo's code — mirror changes or run from main.)

- [ ] **Step 5: Commit specs, push, open PR**

```bash
git add src/lib/lib.spec.md "src/app/(artist)/artist.spec.md"
git commit -m "docs(web): spec updates for lib consolidation PR"
git push -u origin refactor/web-lib-foundations
gh pr create --title "refactor(web): lib foundations, DRY consolidation & error robustness" --body "$(cat <<'EOF'
PR 1 of 4 from web-code-audit.md.

- lib/: new dates.ts, collections.ts, festivals.ts, murals.ts; api.ts exports apiBaseUrl/publicApiBaseUrl; auth-server.ts exports createAuthedServerClient() (kills 6x cookie-injection copy-paste)
- Fixes mural-status colour divergence between organiser editor and public map (unknown = --color-light)
- Merges useUploadImage + useProfileImageUpload into hooks/useImageUpload
- endorse/endorsements pages: useEffect fetching → React Query + singleton apiClient (error handling for free)
- queryFns throw on API error: failures now render alert UI instead of fake empty states (6 sites)
- Adds app/error.tsx + global-error.tsx + site favicon (was 404ing on every page)

Out of scope (later PRs): OpenAPI spec gaps & raw-fetch migration (PR 2), MapEditorClient/login splits (PR 3), test expansion (PR 4).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review notes

- **Audit coverage:** PR-1 scope items 1.1 (error swallowing → Task 9), 1.2 (error.tsx → Task 10), 1.3 (mural colours → Task 5), 1.4 (favicon → Task 10), 2.3 (authed client → Task 6), 2.4 (env fallback → Tasks 1+6; raw-fetch files deliberately deferred to PR 2), 2.5 (module clients → Task 8), 3.1 (upload hooks → Task 7), 3.2/3.3 (status maps → Tasks 3+4), 3.4 (dates → Task 2), 4.4 (useEffect fetching → Task 8). ✔
- **Known behaviour changes (intentional, flag in PR):** same-year festival date ranges on the artist applications page render in the shortened shared format; `unknown` mural pins on the public map change from `#C0BDB8` to `#E2DDD6`.
- **Types:** `useImageUpload` returns `{ upload, state, error, isUploading }` — identical to both old hooks, so the updated test mock shape stays valid. `createAuthedServerClient` returns `Promise<ApiClient | null>` and all four migrated pages handle `null`.
