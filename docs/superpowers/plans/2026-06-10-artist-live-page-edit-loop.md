# Artist live-page ↔ edit-suite round trip — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an artist jump from the dashboard to their own public live page, and from that live page back into the edit suite via an owner-only sticky bar.

**Architecture:** Pure `web/` change, no API changes. A new `getOwnProfileId()` server helper does an authed `GET /profiles/me` to detect ownership on the otherwise-public artist page. The owner bar and dashboard link are plain `next/link` elements rendered in existing server components.

**Tech Stack:** Next.js (App Router, server components), TypeScript, Playwright e2e, Tailwind (design tokens in `web/src/app/globals.css`).

---

## File structure

- `web/src/lib/auth-server.ts` — add `getOwnProfileId()` helper (reuses the existing cookie-authed-client pattern).
- `web/src/app/(public)/artists/[id]/page.tsx` — ownership check, owner bar, bottom padding.
- `web/src/app/dashboard/page.tsx` — "View live page" link.
- `web/src/app/(public)/public.spec.md` — record the owner-only bar behaviour.
- `e2e/browser/artist-onboarding.spec.ts` — assert owner bar present (owner) / absent (anonymous).

Docker note (from e2e-debugging rule): the web container bind-mounts the **main repo** at `/Users/adampowis/workspace/murals`, which is where we're working — no worktree dual-edit needed here.

---

### Task 1: `getOwnProfileId()` helper

**Files:**
- Modify: `web/src/lib/auth-server.ts`

- [ ] **Step 1: Add the helper at the end of the file**

The existing `getSessionUser()` already builds a per-request cookie-authed client. `getOwnProfileId()` follows the same shape but calls `/profiles/me` and returns the profile `id`. Append this after `requireAuth()`:

```ts
/**
 * Return the authenticated viewer's OWN artist-profile id, or null if they are
 * not logged in or have no profile. Used to detect ownership of a public
 * /artists/{id} page without changing what anonymous visitors see.
 *
 * Keyed on the profile id (not the user id) because /artists/{id} routes on the
 * profile id. Does no fetch at all when there is no session cookie.
 */
export async function getOwnProfileId(): Promise<string | null> {
  const cookieStore = await cookies()
  const sessionValue = cookieStore.get('session')?.value

  if (!sessionValue) {
    return null
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
    return null
  }

  return data.id ?? null
}
```

- [ ] **Step 2: Type-check**

Run: `docker compose -f infra/docker-compose.yml exec -T web npx tsc --noEmit -p tsconfig.json`
Expected: no errors referencing `auth-server.ts`. (If `task web:typecheck` exists, prefer it.)

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/auth-server.ts
git commit -m "feat(web): add getOwnProfileId server helper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Owner bar + ownership check on the public artist page

**Files:**
- Modify: `web/src/app/(public)/artists/[id]/page.tsx`

- [ ] **Step 1: Import the helper**

Add to the imports at the top of the file (alongside the existing `import Link from 'next/link'`):

```ts
import { getOwnProfileId } from '@/lib/auth-server'
```

- [ ] **Step 2: Compute ownership after the profile 404 guard**

The component already has `const profile = profileRes.data` after the `notFound()` guard (around line 81). Immediately after that line add:

```ts
const isOwner = (await getOwnProfileId()) === id
```

- [ ] **Step 3: Add bottom padding so the fixed bar never overlaps content**

Change the inner container `div` (currently `className="max-w-4xl mx-auto px-6 py-12"`, around line 139) to reserve space for the bar when present:

```tsx
<div className={`max-w-4xl mx-auto px-6 py-12 ${isOwner ? 'pb-28' : ''}`}>
```

- [ ] **Step 4: Render the owner bar just before the closing `</main>`**

The component's return ends with `</div>` then `</main>` (around lines 391-392). Insert the bar between the closing container `</div>` and `</main>`:

```tsx
      </div>

      {isOwner && (
        <div
          data-testid="owner-live-bar"
          className="fixed bottom-0 inset-x-0 z-40 border-t border-light bg-warm/95 backdrop-blur"
        >
          <div className="max-w-4xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
            <span className="font-mono text-xs uppercase tracking-wider text-mid">
              You&apos;re viewing your live page
            </span>
            <div className="flex items-center gap-4">
              <Link
                href="/dashboard"
                className="font-sans text-sm text-ink underline hover:text-amber transition-colors whitespace-nowrap"
              >
                Dashboard
              </Link>
              <Link
                href="/profile"
                className="px-5 py-2 bg-amber text-ink font-sans font-medium text-sm rounded-lg hover:opacity-90 transition-opacity whitespace-nowrap"
              >
                Edit profile
              </Link>
            </div>
          </div>
        </div>
      )}
    </main>
```

- [ ] **Step 5: Type-check**

Run: `docker compose -f infra/docker-compose.yml exec -T web npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add web/src/app/\(public\)/artists/\[id\]/page.tsx
git commit -m "feat(web): owner-only Edit profile bar on public artist page

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Dashboard "View live page" link

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

### Task 4: E2E coverage — owner bar present/absent

**Files:**
- Modify: `e2e/browser/artist-onboarding.spec.ts`

This spec already signs up an artist, builds + publishes their profile, captures `profileId`, holds an authenticated owner `page`, and opens an unauthenticated `publicPage`. We extend both checks.

- [ ] **Step 1: Add owner-bar assertion on the authenticated owner page**

After the publish block (after the `db.end()` `finally`, before the "Verify public artist profile page" section, around line 88), add — the owner `page` is still authenticated as this artist:

```ts
  // ── Owner sees the live page + Edit profile bar ──────────────────────────────
  await page.goto(`/artists/${profileId}`)
  await expect(page.getByRole('heading', { name: 'Test Muralist' })).toBeVisible()
  const ownerBar = page.getByTestId('owner-live-bar')
  await expect(ownerBar).toBeVisible()
  await expect(ownerBar.getByRole('link', { name: 'Edit profile' })).toHaveAttribute(
    'href',
    '/profile',
  )
```

- [ ] **Step 2: Assert the bar is ABSENT for the anonymous visitor**

In the existing `publicPage` block (the `try` that asserts the heading + "Urban Walls"), add an absence check before `publicPage.close()`:

```ts
    await expect(publicPage.getByTestId('owner-live-bar')).toHaveCount(0)
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

### Task 5: Update the public spec doc

**Files:**
- Modify: `web/src/app/(public)/public.spec.md`

- [ ] **Step 1: Read the spec to find the right section**

Run: `sed -n '1,80p' web/src/app/\(public\)/public.spec.md`
Then add a bullet under the section describing the `/artists/[id]` page (Contract or Key Decisions) capturing: "The `/artists/{id}` page renders an owner-only sticky bar ('You're viewing your live page' + Edit profile → `/profile`, Dashboard → `/dashboard`) when the authenticated viewer's own profile id (via `getOwnProfileId()`) equals the route id. Anonymous visitors and non-owners get a byte-for-byte identical page without the bar." Add a `Changelog` line: `2026-06-10 — owner-only live-page edit bar; getOwnProfileId() ownership check.`

- [ ] **Step 2: Commit**

```bash
git add web/src/app/\(public\)/public.spec.md
git commit -m "docs(spec): note owner-only live-page edit bar

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-review

- **Spec coverage:** Goal 1 (dashboard → live page) = Task 3. Goal 2 (live page → edit, owner-only) = Tasks 1+2. Non-goals respected (no API changes; anonymous view unchanged — Task 4 step 2 asserts this). Testing section = Task 4. Spec-maintenance obligation = Task 5.
- **Placeholder scan:** No TBD/TODO; every code step shows full code. The only descriptive step is Task 5 step 1, which is unavoidable (depends on the spec's current section layout) and bounded by exact bullet text to add.
- **Type consistency:** `getOwnProfileId()` defined in Task 1 is imported and used identically in Task 2. `data-testid="owner-live-bar"` defined in Task 2 step 4 is queried by the same string in Task 4 steps 1-2. `summary.artist_profile.id` in Task 3 matches the `ArtistProfile` type already declared in `dashboard/page.tsx`.
