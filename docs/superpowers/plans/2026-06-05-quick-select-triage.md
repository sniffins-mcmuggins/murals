# Quick-Select Triage (B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full-screen, keyboard-driven triage overlay on the applications board so an organiser can fast-screen submitted applications into a shortlist.

**Architecture:** Pure frontend. A new `TriageMode` overlay iterates the board's already-loaded `applicationsQuery` data one card at a time and toggles only the `shortlisted` flag via the existing `PATCH /festivals/{festivalID}/applications/{applicationID}` (the board's `patchMutation`). No API or DB change. Opening full detail reuses the existing `ApplicationSlideOver`.

**Tech Stack:** Next.js App Router, React Query, Vitest + Testing Library (web unit), Playwright (browser e2e).

**Spec:** `docs/superpowers/specs/2026-06-05-quick-select-triage-design.md`

**Conventions:**
- Web unit tests: Vitest + `@testing-library/react`, `React.createElement` style (see `web/src/__tests__/components/dynamic-form.test.tsx`).
- Run web tests: `cd web && npx vitest run <path>`. Lint: `npx eslint <files>`.
- E2E needs the stack up (`task up`); run one spec: `npx playwright test e2e/browser/<spec>`.
- Commit convention: end each message with a blank line then `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- lefthook pre-commit runs typecheck + lint on staged files; fix issues, don't bypass.
- Docker bind-mounts the main repo; you are on branch `feat/triage` in the main checkout, so edits reach the running containers directly.
- Design tokens: `text-ink/mid/clay`, `bg-amber/warm/offwhite/ink`, `border-light`, `font-serif/sans/mono`.

---

## File Structure

**Create:**
- `web/src/lib/triage.ts` — pure index helpers (`initialTriageIndex`, `clampIndex`).
- `web/src/lib/triage.test.ts` — unit tests.
- `web/src/components/TriageMode.tsx` — the overlay component.
- `web/src/__tests__/components/triage-mode.test.tsx` — component test.
- `e2e/browser/triage.spec.ts` — browser flow.

**Modify:**
- `web/src/app/organiser/festivals/[id]/applications/page.tsx` — add a "Triage" button + render `<TriageMode>` + wire callbacks to the existing shortlist mutation and slide-over.

---

## Task 1: Pure triage index helpers

**Files:**
- Create: `web/src/lib/triage.ts`
- Test: `web/src/lib/triage.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// web/src/lib/triage.test.ts
import { describe, it, expect } from 'vitest'
import { initialTriageIndex, clampIndex } from '@/lib/triage'

describe('triage helpers', () => {
  it('initialTriageIndex returns the first not-yet-shortlisted index', () => {
    expect(initialTriageIndex([{ shortlisted: true }, { shortlisted: false }, { shortlisted: false }])).toBe(1)
  })
  it('initialTriageIndex returns 0 when all are shortlisted', () => {
    expect(initialTriageIndex([{ shortlisted: true }, { shortlisted: true }])).toBe(0)
  })
  it('initialTriageIndex returns 0 for an empty list', () => {
    expect(initialTriageIndex([])).toBe(0)
  })
  it('clampIndex keeps the index within [0, len-1]', () => {
    expect(clampIndex(-1, 3)).toBe(0)
    expect(clampIndex(3, 3)).toBe(2)
    expect(clampIndex(1, 3)).toBe(1)
    expect(clampIndex(0, 0)).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/triage.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// web/src/lib/triage.ts
// Minimal index math for the triage overlay. Kept pure so it is unit-testable
// independently of React. Accepts any object with a `shortlisted` flag.
export function initialTriageIndex(apps: { shortlisted?: boolean | null }[]): number {
  const i = apps.findIndex(a => !a.shortlisted)
  return i === -1 ? 0 : i
}

export function clampIndex(i: number, len: number): number {
  if (len <= 0) return 0
  return Math.max(0, Math.min(i, len - 1))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/lib/triage.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/triage.ts web/src/lib/triage.test.ts
git commit -m "feat(web): pure triage index helpers"
```

---

## Task 2: TriageMode overlay component

**Files:**
- Create: `web/src/components/TriageMode.tsx`
- Test: `web/src/__tests__/components/triage-mode.test.tsx`

**Context:** `Application` is `components['schemas']['Application']` (has `id`, `shortlisted`, `review_flag`, `status`, `answers`, and an `artist` summary with `display_name`). `FormField` is exported from `@/components/DynamicForm`. The component is presentational + keyboard handling only — all persistence is done by the parent via `onShortlist`.

- [ ] **Step 1: Write the failing test**

```tsx
// web/src/__tests__/components/triage-mode.test.tsx
import { vi, describe, it, expect } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { TriageMode } from '@/components/TriageMode'

type App = { id: string; shortlisted: boolean; answers: Record<string, string>; artist?: { display_name?: string } }

const apps: App[] = [
  { id: 'a1', shortlisted: false, answers: { q1: 'I paint big walls' }, artist: { display_name: 'Rosa Vane' } },
  { id: 'a2', shortlisted: false, answers: { q1: 'Portraits' }, artist: { display_name: 'Amara Diallo' } },
]
const formFields = [{ id: 'q1', type: 'text' as const, label: 'About your work' }]

function setup(overrides: Record<string, unknown> = {}) {
  const onShortlist = vi.fn()
  const onOpenDetail = vi.fn()
  const onClose = vi.fn()
  render(React.createElement(TriageMode, {
    apps, formFields, detailOpen: false, onShortlist, onOpenDetail, onClose, ...overrides,
  }))
  return { onShortlist, onOpenDetail, onClose }
}

describe('TriageMode', () => {
  it('shows the first card and progress', () => {
    setup()
    expect(screen.getByText('Rosa Vane')).toBeInTheDocument()
    expect(screen.getByText(/1 \/ 2/)).toBeInTheDocument()
  })

  it('ArrowRight shortlists current and advances', () => {
    const { onShortlist } = setup()
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(onShortlist).toHaveBeenCalledWith('a1', true)
    expect(screen.getByText('Amara Diallo')).toBeInTheDocument()
  })

  it('ArrowLeft un-shortlists current and advances', () => {
    const { onShortlist } = setup()
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(onShortlist).toHaveBeenCalledWith('a1', false)
  })

  it('Enter opens detail for the current app', () => {
    const { onOpenDetail } = setup()
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onOpenDetail).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }))
  })

  it('Escape closes', () => {
    const { onClose } = setup()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('ignores keys while detailOpen is true', () => {
    const { onShortlist } = setup({ detailOpen: true })
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(onShortlist).not.toHaveBeenCalled()
  })

  it('Shortlist button mirrors the key', () => {
    const { onShortlist } = setup()
    fireEvent.click(screen.getByRole('button', { name: /shortlist/i }))
    expect(onShortlist).toHaveBeenCalledWith('a1', true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/__tests__/components/triage-mode.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```tsx
// web/src/components/TriageMode.tsx
'use client'

import { useState, useEffect } from 'react'
import type { components } from '@render/api-client'
import type { FormField } from '@/components/DynamicForm'
import { initialTriageIndex, clampIndex } from '@/lib/triage'

type Application = components['schemas']['Application']

type Props = {
  apps: Application[]
  formFields: FormField[]
  detailOpen: boolean
  onShortlist: (id: string, shortlisted: boolean) => void
  onOpenDetail: (app: Application) => void
  onClose: () => void
}

export function TriageMode({ apps, formFields, detailOpen, onShortlist, onOpenDetail, onClose }: Props) {
  const [index, setIndex] = useState(() => initialTriageIndex(apps))
  const current = apps[index] ?? null
  const shortlistedCount = apps.filter(a => a.shortlisted).length

  function decide(shortlisted: boolean) {
    if (current?.id) onShortlist(current.id, shortlisted)
    setIndex(i => clampIndex(i + 1, apps.length))
  }

  // Re-bind each render so the handler closes over the current index/app.
  // Inert while the detail slide-over is open (parent owns that interaction).
  useEffect(() => {
    if (detailOpen) return
    function onKey(e: KeyboardEvent) {
      switch (e.key) {
        case 'ArrowRight': e.preventDefault(); decide(true); break
        case 'ArrowLeft': e.preventDefault(); decide(false); break
        case 'ArrowDown': e.preventDefault(); setIndex(i => clampIndex(i + 1, apps.length)); break
        case 'ArrowUp': e.preventDefault(); setIndex(i => clampIndex(i - 1, apps.length)); break
        case 'Enter': e.preventDefault(); if (current) onOpenDetail(current); break
        case 'Escape': e.preventDefault(); onClose(); break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, apps, detailOpen])

  const name = current?.artist?.display_name ?? 'Unknown artist'
  const answers = (current?.answers ?? {}) as Record<string, string>
  const labelFor = (fieldId: string) => formFields.find(f => f.id === fieldId)?.label ?? fieldId

  return (
    <div className="fixed inset-0 z-40 bg-offwhite flex flex-col" data-testid="triage-mode">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-light">
        <span className="font-mono text-xs text-mid uppercase tracking-widest">
          Triage · {Math.min(index + 1, apps.length)} / {apps.length} · {shortlistedCount} shortlisted
        </span>
        <button onClick={onClose} className="font-sans text-sm text-mid hover:text-ink">Close ✕</button>
      </div>

      {/* Card */}
      <div className="flex-1 overflow-y-auto flex items-start justify-center p-8">
        {current ? (
          <div className="w-full max-w-xl bg-warm border border-light rounded-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-serif text-2xl text-ink">{name}</h2>
              {current.shortlisted && (
                <span className="font-mono text-xs text-amber uppercase tracking-widest">★ shortlisted</span>
              )}
            </div>
            <div className="space-y-3">
              {Object.entries(answers).slice(0, 4).map(([fieldId, value]) => (
                <div key={fieldId}>
                  <p className="font-sans text-xs text-mid mb-0.5">{labelFor(fieldId)}</p>
                  <p className="font-sans text-sm text-ink line-clamp-3">{value}</p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="font-sans text-sm text-mid">No applications to triage.</p>
        )}
      </div>

      {/* Controls (mirror the keys) */}
      <div className="flex items-center justify-center gap-3 px-6 py-4 border-t border-light">
        <button onClick={() => decide(false)} disabled={!current}
          className="font-sans text-sm border border-light rounded-lg px-5 py-2 hover:border-clay disabled:opacity-40">
          ← No
        </button>
        <button onClick={() => current && onOpenDetail(current)} disabled={!current}
          className="font-sans text-sm border border-light rounded-lg px-5 py-2 hover:border-amber disabled:opacity-40">
          Details ↵
        </button>
        <button onClick={() => decide(true)} disabled={!current}
          className="font-sans text-sm bg-amber text-ink font-medium rounded-lg px-5 py-2 hover:opacity-90 disabled:opacity-40">
          Shortlist →
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/__tests__/components/triage-mode.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 5: Lint**

Run: `cd web && npx eslint src/components/TriageMode.tsx src/lib/triage.ts`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/TriageMode.tsx web/src/__tests__/components/triage-mode.test.tsx
git commit -m "feat(web): TriageMode keyboard-driven shortlist overlay"
```

---

## Task 3: Wire triage into the applications board

**Files:**
- Modify: `web/src/app/organiser/festivals/[id]/applications/page.tsx`

**Context (verified against current code):**
- State already includes `selectedApp` / `setSelectedApp` (drives `ApplicationSlideOver`), `allApps`, `formFields`, `isReleased`, and `isReviewer`.
- `patchMutation.mutate({ id, shortlisted, reviewFlag })` toggles the shortlist flag (it requires `reviewFlag`, so pass the app's current `review_flag`).
- The board header is around line 427 (`<h1>Applications</h1>`); organiser action buttons are gated by `!isReviewer && !isReleased`.
- `ApplicationSlideOver` is rendered with `application={selectedApp}`.

- [ ] **Step 1: Add imports and triage state**

Add to the imports at the top:
```tsx
import { TriageMode } from '@/components/TriageMode'
```
Add near the other `useState` declarations (next to `selectedApp`):
```tsx
const [triageOpen, setTriageOpen] = useState(false)
```

- [ ] **Step 2: Add the submitted-apps slice + handlers**

Near where `allApps` / `stagedCount` are computed (after line ~311), add:
```tsx
const submittedApps = allApps.filter(a => a.status === 'submitted')

function handleTriageShortlist(id: string, shortlisted: boolean) {
  const app = allApps.find(a => a.id === id)
  patchMutation.mutate({ id, shortlisted, reviewFlag: app?.review_flag ?? false })
}
```

- [ ] **Step 3: Add the Triage button to the header**

Inside the `{!isReviewer && !isReleased && ( … )}` action group near the header (around line 434), add a button (match the styling of the neighbouring buttons you find there):
```tsx
<button
  onClick={() => setTriageOpen(true)}
  disabled={submittedApps.length === 0}
  className="font-sans text-sm border border-light rounded-lg px-4 py-2 hover:border-amber disabled:opacity-40"
  data-testid="open-triage"
>
  Triage
</button>
```

- [ ] **Step 4: Render TriageMode when open**

Just before the existing `<ApplicationSlideOver … />` in the main `return` (around line 400 in the non-reviewer branch; if there are two render branches, add it to the primary organiser branch that shows the board), add:
```tsx
{triageOpen && (
  <TriageMode
    apps={submittedApps}
    formFields={formFields}
    detailOpen={!!selectedApp}
    onShortlist={handleTriageShortlist}
    onOpenDetail={setSelectedApp}
    onClose={() => setTriageOpen(false)}
  />
)}
```
> `detailOpen={!!selectedApp}` makes the overlay's keyboard handler inert while the slide-over is open (spec invariant). The slide-over (`z-50`) renders above the overlay (`z-40`).

- [ ] **Step 5: Verify existing board test still passes + typecheck**

Run: `cd web && npx vitest run src/__tests__/organiser/applications-page.test.tsx`
Expected: PASS. Then `npx eslint "src/app/organiser/festivals/[id]/applications/page.tsx"` — no errors.

- [ ] **Step 6: Commit**

```bash
git add "web/src/app/organiser/festivals/[id]/applications/page.tsx"
git commit -m "feat(web): Triage button + overlay wired into applications board"
```

---

## Task 4: E2E browser flow

**Files:**
- Create: `e2e/browser/triage.spec.ts`

**Context:** Reuse helpers from `e2e/fixtures/helpers.ts`. Read `e2e/browser/application-flow.spec.ts` first for the local `loginAs` pattern and the real signatures of `createOrganiser`, `createFestival`, `upsertForm`, `createArtist`, and `submitApplication` — adapt to them. The flow needs ≥2 submitted applications on one festival.

- [ ] **Step 1: Write the spec**

```ts
// e2e/browser/triage.spec.ts
import { test, expect } from '@playwright/test'
// Import the helpers that actually exist (verify names/signatures in helpers.ts):
import { createOrganiser, createFestival, upsertForm, createArtist, submitApplication } from '../fixtures/helpers'

// Local loginAs — copy the pattern from application-flow.spec.ts (returns { ctx, page }).
// ...define loginAs here exactly as that spec does...

test('organiser triages submitted applications into the shortlist', async ({ browser }) => {
  const suffix = Date.now()
  const org = await createOrganiser(suffix)
  const { festivalId } = await createFestival(org.token, {
    name: `Triage Fest ${suffix}`, slug: `triage-fest-${suffix}`,
  })
  await upsertForm(org.token, festivalId, [
    { id: 'q1', type: 'text', label: 'About your work', required: true },
  ])
  // Festival must accept applications — set status to 'open' if the helper exists (setFestivalStatus).
  // Two artists submit.
  for (const n of [1, 2]) {
    const artist = await createArtist(suffix + n)
    await submitApplication(artist.token, festivalId, { q1: `Artist ${n} statement` })
  }

  const { page } = await loginAs(browser, org.email, org.password, 'http://localhost:3000')
  await page.goto(`http://localhost:3000/organiser/festivals/${festivalId}/applications`)

  await page.getByTestId('open-triage').click()
  await expect(page.getByTestId('triage-mode')).toBeVisible()
  await page.keyboard.press('ArrowRight') // shortlist first, advance
  await page.keyboard.press('Escape')     // exit triage

  // Back on the board, one application is now in the Shortlisted column.
  await expect(page.getByText(/1 shortlisted|Shortlisted/i).first()).toBeVisible()
})
```
> Adapt `submitApplication` / `createArtist` / `setFestivalStatus` calls to the real helper signatures. If the board's shortlisted column has a distinct testid, assert on that instead of text. If a submitted application requires the festival to be `open`, set it via `setFestivalStatus(org.token, festivalId, 'open')` before artists apply.

- [ ] **Step 2: Run the spec (stack must be up)**

Run: `task up` if needed, then `npx playwright test e2e/browser/triage.spec.ts`
Expected: PASS. On a selector failure read `test-results/*/error-context.md` before adjusting.

- [ ] **Step 3: Confirm no regression on the board specs**

Run: `npx playwright test e2e/browser/application-flow.spec.ts e2e/browser/organiser-setup.spec.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add e2e/browser/triage.spec.ts
git commit -m "test(e2e): quick-select triage shortlist flow"
```

---

## Final verification

- [ ] `cd web && npx vitest run` — all web unit tests pass (incl. triage helpers + TriageMode).
- [ ] `task web:lint` — clean.
- [ ] Stack up; `npx playwright test e2e/browser/triage.spec.ts` — pass; full browser suite still green.
- [ ] Manual smoke: open a festival's applications board with submitted apps → click **Triage** → `→`/`←` to screen, `↑/↓` to navigate, `enter` opens detail (keys go inert), `esc` exits → shortlisted apps appear in the Shortlisted column.

---

## Self-Review notes (author)

- **Spec coverage:** overlay launched from board button (Task 3), keys `→/←/↑/↓/enter/esc` (Task 2), shortlist-only via existing PATCH (Task 3 `handleTriageShortlist`), minimal card + enter-to-detail (Task 2), progress header (Task 2), inert-while-detail-open invariant (`detailOpen` prop), no API/DB change, no new route. ✓
- **Boundaries:** no accept/decline/rank in triage; anonymity inherited from the server response (the overlay renders `artist.display_name` exactly as the board's data provides it). ✓
- **Type consistency:** `Application` = `components['schemas']['Application']` used in Task 2 + 3; `initialTriageIndex`/`clampIndex` (Task 1) consumed in Task 2; `onShortlist(id, boolean)` signature matches `handleTriageShortlist` (Task 3). ✓
- **Adaptation points flagged:** exact helper signatures in `helpers.ts` and the board's two render branches (reviewer vs organiser) — Task 3/4 call these out.
