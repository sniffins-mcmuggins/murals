# Artist live-page ↔ edit-suite round trip — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an artist jump from the dashboard to their own public live page, and from that live page back into the edit suite via an owner-only sticky bar.

**Architecture:** Pure `web/` change, no API changes. A new reusable `isProfileOwner(profileId)` server helper does an authed `GET /profiles/me` and compares to the given id — the single source of truth for "should this viewer see owner controls", usable by any public page keyed on a profile id. The owner bar and dashboard link are plain `next/link` elements rendered in existing server components.

**Tech Stack:** Next.js (App Router, server components), TypeScript, Playwright e2e, Tailwind (design tokens in `web/src/app/globals.css`).

---

## File structure

- `web/src/lib/auth-server.ts` — add `isProfileOwner(profileId)` helper (reuses the existing cookie-authed-client pattern).
- `web/src/components/OwnerBar.tsx` — new shared presentational sticky bar (Links only); reused by both public pages.
- `web/src/app/(public)/artists/[id]/page.tsx` — ownership check, owner bar, bottom padding.
- `web/src/app/(public)/artists/[id]/collections/[collectionId]/page.tsx` — same ownership check + owner bar (Edit collection).
- `web/src/app/dashboard/page.tsx` — "View live page" link.
- `web/src/app/(public)/public.spec.md` — record the owner-only bar behaviour.
- `web/src/lib/lib.spec.md` — record the new exported `isProfileOwner()` helper.
- `e2e/browser/artist-onboarding.spec.ts` — assert owner bar present (owner) / absent (anonymous).

Docker note (from e2e-debugging rule): the web container bind-mounts the **main repo** at `/Users/adampowis/workspace/murals`, which is where we're working — no worktree dual-edit needed here.

---

### Task 1: `isProfileOwner()` helper

**Files:**
- Modify: `web/src/lib/auth-server.ts`

- [ ] **Step 1: Add the helper at the end of the file**

The existing `getSessionUser()` already builds a per-request cookie-authed client. `isProfileOwner()` follows the same shape but calls `/profiles/me` and compares the viewer's profile id to the supplied one — the reusable "should this viewer see owner controls" check. Append this after `requireAuth()`:

```ts
/**
 * Return true if the authenticated viewer owns the artist profile identified by
 * `profileId`. False for anonymous visitors, other artists, and viewers with no
 * profile. The single source of truth for showing owner-only controls on an
 * otherwise-public page (e.g. the live /artists/{id} page).
 *
 * Keyed on the profile id (not the user id) because public artist routes are
 * keyed on the profile id. Does no fetch at all when there is no session cookie.
 */
export async function isProfileOwner(profileId: string): Promise<boolean> {
  const cookieStore = await cookies()
  const sessionValue = cookieStore.get('session')?.value

  if (!sessionValue) {
    return false
  }

  const authedClient = createApiClient({
    baseUrl: process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080',
  })
  authedClient.use({
    onRequest({ request }) {
      request.headers.set('Cookie', `session=${sessionValue}`)
      return request
    },
  })

  const { data, response } = await authedClient.GET('/profiles/me', {})

  if (response.status === 401 || !data) {
    return false
  }

  return data.id === profileId
}
```

- [ ] **Step 2: Type-check**

Run: `docker compose -f infra/docker-compose.yml exec -T web npx tsc --noEmit -p tsconfig.json`
Expected: no errors referencing `auth-server.ts`. (If `task web:typecheck` exists, prefer it.)

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/auth-server.ts
git commit -m "feat(web): add isProfileOwner server helper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Owner bar + ownership check on the public artist page

**Files:**
- Modify: `web/src/app/(public)/artists/[id]/page.tsx`

- [ ] **Step 1: Import the helper**

- [ ] **Step 1: Create the shared `OwnerBar` component**

Create `web/src/components/OwnerBar.tsx`. It is purely presentational (Links only, no client state, no ownership logic — the caller decides whether to render it), so it stays a server component and is reused by both the live page and the collection page.

```tsx
import Link from 'next/link'

/**
 * Sticky bottom bar shown ONLY to the owner of a public page (artist live page,
 * collection page). The caller gates rendering with isProfileOwner(); this
 * component just presents the label + edit/dashboard links.
 *
 * Pages that render this MUST add bottom padding (e.g. `pb-28`) so the fixed bar
 * does not overlap their last section.
 */
export function OwnerBar({
  label,
  editHref,
  editLabel,
}: {
  label: string
  editHref: string
  editLabel: string
}) {
  return (
    <div
      data-testid="owner-bar"
      className="fixed bottom-0 inset-x-0 z-40 border-t border-light bg-warm/95 backdrop-blur"
    >
      <div className="max-w-4xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
        <span className="font-mono text-xs uppercase tracking-wider text-mid">{label}</span>
        <div className="flex items-center gap-4">
          <Link
            href="/dashboard"
            className="font-sans text-sm text-ink underline hover:text-amber transition-colors whitespace-nowrap"
          >
            Dashboard
          </Link>
          <Link
            href={editHref}
            className="px-5 py-2 bg-amber text-ink font-sans font-medium text-sm rounded-lg hover:opacity-90 transition-opacity whitespace-nowrap"
          >
            {editLabel}
          </Link>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Import the helper and component into the live page**

Add to the imports at the top of `(public)/artists/[id]/page.tsx`:

```ts
import { isProfileOwner } from '@/lib/auth-server'
import { OwnerBar } from '@/components/OwnerBar'
```

- [ ] **Step 3: Compute ownership after the profile 404 guard**

The component already has `const profile = profileRes.data` after the `notFound()` guard (around line 81). Immediately after that line add:

```ts
const isOwner = await isProfileOwner(id)
```

- [ ] **Step 4: Add bottom padding so the fixed bar never overlaps content**

Change the inner container `div` (currently `className="max-w-4xl mx-auto px-6 py-12"`, around line 139) to reserve space for the bar when present:

```tsx
<div className={`max-w-4xl mx-auto px-6 py-12 ${isOwner ? 'pb-28' : ''}`}>
```

- [ ] **Step 5: Render the owner bar just before the closing `</main>`**

The component's return ends with `</div>` then `</main>` (around lines 391-392). Insert the bar between the closing container `</div>` and `</main>`:

```tsx
      </div>

      {isOwner && (
        <OwnerBar
          label="You're viewing your live page"
          editHref="/profile"
          editLabel="Edit profile"
        />
      )}
    </main>
```

- [ ] **Step 6: Type-check**

Run: `docker compose -f infra/docker-compose.yml exec -T web npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/OwnerBar.tsx web/src/app/\(public\)/artists/\[id\]/page.tsx
git commit -m "feat(web): owner-only Edit profile bar on public artist page

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Owner bar on the public collection detail page

**Files:**
- Modify: `web/src/app/(public)/artists/[id]/collections/[collectionId]/page.tsx`

Same reuse pattern: this page is keyed on the profile `id`, so `isProfileOwner(id)` gates an "Edit collection" bar linking to the collection editor at `/collections/{collectionId}`.

- [ ] **Step 1: Import the helper and component**

Add alongside the existing imports (`import Link from 'next/link'` etc.):

```ts
import { isProfileOwner } from '@/lib/auth-server'
import { OwnerBar } from '@/components/OwnerBar'
```

- [ ] **Step 2: Compute ownership after the 404 guard**

After `const images = imagesRes.data ?? []` (around line 79), add:

```ts
const isOwner = await isProfileOwner(id)
```

- [ ] **Step 3: Add bottom padding to the container**

Change the inner container `div` (`className="max-w-4xl mx-auto px-6 py-12"`, around line 82):

```tsx
<div className={`max-w-4xl mx-auto px-6 py-12 ${isOwner ? 'pb-28' : ''}`}>
```

- [ ] **Step 4: Render the bar before the closing `</main>`**

The return ends with `</div>` then `</main>`. Insert between them:

```tsx
      </div>

      {isOwner && (
        <OwnerBar
          label="You're viewing your live collection"
          editHref={`/collections/${collectionId}`}
          editLabel="Edit collection"
        />
      )}
    </main>
```

- [ ] **Step 5: Type-check**

Run: `docker compose -f infra/docker-compose.yml exec -T web npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add web/src/app/\(public\)/artists/\[id\]/collections/\[collectionId\]/page.tsx
git commit -m "feat(web): owner-only Edit collection bar on public collection page

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Dashboard "View live page" link

**Files:**
- Modify: `web/src/app/dashboard/page.tsx`

- [ ] **Step 1: Add the link next to "Manage profile"**

The artist section (around lines 108-126) renders a single `Link` to `/profile` labelled "Manage profile". Wrap the two links in a flex row so they sit side by side. Replace the existing `<Link href="/profile" …>Manage profile</Link>` block with:

```tsx
              <div className="flex items-center gap-4 whitespace-nowrap">
                <Link
                  href={`/artists/${summary.artist_profile.id}`}
                  className="font-sans text-sm text-ink underline hover:text-amber"
                >
                  View live page
                </Link>
                <Link
                  href="/profile"
                  className="font-sans text-sm text-ink underline hover:text-amber"
                >
                  Manage profile
                </Link>
              </div>
```

- [ ] **Step 2: Type-check**

Run: `docker compose -f infra/docker-compose.yml exec -T web npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add web/src/app/dashboard/page.tsx
git commit -m "feat(web): add View live page link to dashboard

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: E2E coverage — owner bar present/absent

**Files:**
- Modify: `e2e/browser/artist-onboarding.spec.ts`

This spec already signs up an artist, builds + publishes their profile, captures `profileId`, holds an authenticated owner `page`, and opens an unauthenticated `publicPage`. We extend both checks. (`OwnerBar` is a shared component, so verifying it on the live page also exercises the component the collection page reuses.)

- [ ] **Step 1: Add owner-bar assertion on the authenticated owner page**

After the publish block (after the `db.end()` `finally`, before the "Verify public artist profile page" section, around line 88), add — the owner `page` is still authenticated as this artist:

```ts
  // ── Owner sees the live page + Edit profile bar ──────────────────────────────
  await page.goto(`/artists/${profileId}`)
  await expect(page.getByRole('heading', { name: 'Test Muralist' })).toBeVisible()
  const ownerBar = page.getByTestId('owner-bar')
  await expect(ownerBar).toBeVisible()
  await expect(ownerBar.getByRole('link', { name: 'Edit profile' })).toHaveAttribute(
    'href',
    '/profile',
  )
```

- [ ] **Step 2: Assert the bar is ABSENT for the anonymous visitor**

In the existing `publicPage` block (the `try` that asserts the heading + "Urban Walls"), add an absence check before `publicPage.close()`:

```ts
    await expect(publicPage.getByTestId('owner-bar')).toHaveCount(0)
```

- [ ] **Step 3: Run the spec**

Ensure the stack is up first (`task up`). Then:

Run: `npx playwright test e2e/browser/artist-onboarding.spec.ts`
Expected: PASS (1 passed). If the owner bar assertion fails with the bar hidden, confirm the web container rebuilt the page (`docker compose -f infra/docker-compose.yml logs web --tail=20`).

- [ ] **Step 4: Commit**

```bash
git add e2e/browser/artist-onboarding.spec.ts
git commit -m "test(e2e): assert owner-only Edit profile bar on live page

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Update the spec docs

**Files:**
- Modify: `web/src/app/(public)/public.spec.md`
- Modify: `web/src/lib/lib.spec.md`

- [ ] **Step 1: Update the public spec**

Run: `sed -n '1,80p' web/src/app/\(public\)/public.spec.md`
Then add a bullet under the section describing the public artist pages (Contract or Key Decisions) capturing: "The `/artists/{id}` and `/artists/{id}/collections/{collectionId}` pages render a shared owner-only sticky bar (`components/OwnerBar`) when `isProfileOwner(id)` is true — 'Edit profile' → `/profile` on the live page, 'Edit collection' → `/collections/{collectionId}` on the collection page, plus a Dashboard link. Anonymous visitors and non-owners get a byte-for-byte identical page without the bar." Add a `Changelog` line: `2026-06-10 — owner-only OwnerBar on live + collection pages; isProfileOwner() ownership check.`

- [ ] **Step 2: Update the lib spec**

In `web/src/lib/lib.spec.md`, under Contract add to the `auth-server.ts` bullet: "...and `isProfileOwner(profileId)` — returns whether the authenticated viewer owns that profile (authed `GET /profiles/me`, id compare); the source of truth for owner-only controls on public pages." Add a `Changelog` line: `2026-06-10 — added isProfileOwner() to auth-server.ts (owner-control gating on public pages).`

- [ ] **Step 3: Commit**

```bash
git add web/src/app/\(public\)/public.spec.md web/src/lib/lib.spec.md
git commit -m "docs(spec): note owner-only live-page edit bar + isProfileOwner

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-review

- **Spec coverage:** Goal 1 (dashboard → live page) = Task 4. Goal 2 (live page → edit, owner-only) = Tasks 1+2. Reuse on the collection page (added per review) = Task 3, on the same `isProfileOwner` + shared `OwnerBar`. Non-goals respected (no API changes; anonymous view unchanged — Task 5 step 2 asserts this). Testing section = Task 5. Spec-maintenance obligation = Task 6.
- **Placeholder scan:** No TBD/TODO; every code step shows full code. The only descriptive steps are Task 6's spec edits, unavoidable (depend on the specs' current section layout) and bounded by exact text to add.
- **Type consistency:** `isProfileOwner(profileId)` defined in Task 1 is imported and used identically in Tasks 2 and 3. `OwnerBar` defined in Task 2 step 1 takes `{ label, editHref, editLabel }` — matched by both call sites (Task 2 step 5, Task 3 step 4). `data-testid="owner-bar"` defined in `OwnerBar` is queried by the same string in Task 5 steps 1-2. `summary.artist_profile.id` in Task 4 matches the `ArtistProfile` type already declared in `dashboard/page.tsx`.
