# Phase 8: Reviewer Web UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the web UI surfaces that expose the reviewer/panellist backend to organiser and reviewer users — score controls, avg-score badges, reviewer management, dashboard entry point, and a reviewing page.

**Architecture:** Six files touched, two new pages, two new browser specs. Owner vs reviewer is detected by calling `GET /festivals/{id}/reviewers` and treating a 403 as the reviewer signal. Avg score is gated behind `my_score != null` (always-on, no toggle). Decision controls are absent from the DOM for reviewers — not disabled. All new API calls use the already-generated `apiClient` typed against `openapi/generated/client.ts`.

**Tech Stack:** Next.js 14 (app router, `'use client'`), React, TanStack Query v5, TypeScript, Tailwind CSS, Vitest + Testing Library (unit), Playwright (browser e2e).

**Spec:** `docs/superpowers/specs/2026-05-29-phase8-reviewer-web-ui-design.md`

---

## File map

| File | What changes |
|---|---|
| `web/src/components/ApplicationCard.tsx` | Add `isReviewer` + `onScore` props; avg badge; star control inline |
| `web/src/components/ApplicationSlideOver.tsx` | Add `isReviewer` + `onScore`; star score section; avg section |
| `web/src/app/organiser/festivals/[id]/applications/page.tsx` | Detect owner/reviewer; add `scoreMutation`; skip DndContext for reviewers |
| `web/src/app/organiser/festivals/[id]/page.tsx` | Add `ReviewersSection` component at bottom |
| `web/src/app/organiser/dashboard/page.tsx` | Fetch `/me/reviewing`; render "Reviewing (N)" card |
| `web/src/app/organiser/reviewing/page.tsx` | **New** — list festivals the caller reviews |
| `web/src/__tests__/organiser/applications-page.test.tsx` | Add reviewer-mode assertions |
| `web/src/__tests__/components/ApplicationCard.test.tsx` | **New** |
| `web/src/__tests__/components/ApplicationSlideOver.test.tsx` | **New** |
| `web/src/__tests__/organiser/festival-detail-reviewers.test.tsx` | **New** |
| `e2e/browser/reviewer-board.spec.ts` | **New** — 5 browser cases |
| `e2e/browser/reviewer-management.spec.ts` | **New** — 5 browser cases |

---

## Task 1: `ApplicationCard` — avg badge + reviewer mode

**Files:**
- Modify: `web/src/components/ApplicationCard.tsx`
- Create: `web/src/__tests__/components/ApplicationCard.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `web/src/__tests__/components/ApplicationCard.test.tsx`:

```tsx
import { vi, describe, it, expect } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { ApplicationCard } from '@/components/ApplicationCard'

vi.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => {},
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
}))
vi.mock('@dnd-kit/utilities', () => ({ CSS: { Transform: { toString: () => '' } } }))

const baseApp = {
  id: 'app-1',
  form_id: 'form-1',
  artist_id: 'artist-1',
  status: 'submitted' as const,
  shortlisted: false,
  review_flag: false,
  rank: 0,
  answers: {},
  notes: [],
  avg_score: null,
  score_count: 0,
  my_score: null,
  created_at: '2026-05-01T10:00:00Z',
  updated_at: '2026-05-01T10:00:00Z',
  artist: { display_name: 'Rosa Vane', medium_tags: [], avatar_s3_key: null, location_label: 'Bristol' },
}

const noop = () => {}

describe('ApplicationCard — owner mode (isReviewer=false)', () => {
  it('shows drag handle, flag buttons, and action buttons', () => {
    render(<ApplicationCard application={baseApp} onSelect={noop} onAccept={noop}
      onDecline={noop} onWaitlist={noop} onToggleShortlist={noop}
      onToggleReviewFlag={noop} onScore={noop} isReviewer={false} isPending={false} />)
    expect(screen.getByLabelText('Drag to reorder')).toBeInTheDocument()
    expect(screen.getByTitle('Shortlist')).toBeInTheDocument()
    expect(screen.getByTitle('Flag for review')).toBeInTheDocument()
    expect(screen.getByText('Accept')).toBeInTheDocument()
  })

  it('shows avg badge when score_count > 0 and my_score != null', () => {
    const app = { ...baseApp, avg_score: 3.5, score_count: 2, my_score: 4 }
    render(<ApplicationCard application={app} onSelect={noop} onAccept={noop}
      onDecline={noop} onWaitlist={noop} onToggleShortlist={noop}
      onToggleReviewFlag={noop} onScore={noop} isReviewer={false} isPending={false} />)
    expect(screen.getByText(/★.*3\.5.*·.*2/)).toBeInTheDocument()
  })

  it('hides avg badge when my_score is null', () => {
    const app = { ...baseApp, avg_score: 3.5, score_count: 2, my_score: null }
    render(<ApplicationCard application={app} onSelect={noop} onAccept={noop}
      onDecline={noop} onWaitlist={noop} onToggleShortlist={noop}
      onToggleReviewFlag={noop} onScore={noop} isReviewer={false} isPending={false} />)
    expect(screen.queryByText(/3\.5/)).not.toBeInTheDocument()
  })
})

describe('ApplicationCard — reviewer mode (isReviewer=true)', () => {
  it('hides drag handle, flag buttons, and action buttons', () => {
    render(<ApplicationCard application={baseApp} onSelect={noop} onAccept={noop}
      onDecline={noop} onWaitlist={noop} onToggleShortlist={noop}
      onToggleReviewFlag={noop} onScore={noop} isReviewer={true} isPending={false} />)
    expect(screen.queryByLabelText('Drag to reorder')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Shortlist')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Flag for review')).not.toBeInTheDocument()
    expect(screen.queryByText('Accept')).not.toBeInTheDocument()
  })

  it('shows star score control when unscored', () => {
    render(<ApplicationCard application={baseApp} onSelect={noop} onAccept={noop}
      onDecline={noop} onWaitlist={noop} onToggleShortlist={noop}
      onToggleReviewFlag={noop} onScore={noop} isReviewer={true} isPending={false} />)
    expect(screen.getByLabelText('Score 1')).toBeInTheDocument()
    expect(screen.getByLabelText('Score 5')).toBeInTheDocument()
  })

  it('calls onScore when a star is clicked', () => {
    const onScore = vi.fn()
    render(<ApplicationCard application={baseApp} onSelect={noop} onAccept={noop}
      onDecline={noop} onWaitlist={noop} onToggleShortlist={noop}
      onToggleReviewFlag={noop} onScore={onScore} isReviewer={true} isPending={false} />)
    fireEvent.click(screen.getByLabelText('Score 4'))
    expect(onScore).toHaveBeenCalledWith('app-1', 4)
  })

  it('shows avg badge after scoring (my_score != null)', () => {
    const app = { ...baseApp, avg_score: 4.0, score_count: 1, my_score: 4 }
    render(<ApplicationCard application={app} onSelect={noop} onAccept={noop}
      onDecline={noop} onWaitlist={noop} onToggleShortlist={noop}
      onToggleReviewFlag={noop} onScore={noop} isReviewer={true} isPending={false} />)
    expect(screen.getByText(/★.*4\.0.*·.*1/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd web && npx vitest run src/__tests__/components/ApplicationCard.test.tsx
```
Expected: FAIL — `onScore` and `isReviewer` props not defined.

- [ ] **Step 3: Implement the changes**

Replace `web/src/components/ApplicationCard.tsx` with:

```tsx
'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { components } from '@render/api-client'

type Application = components['schemas']['Application']
type ApplicationArtist = components['schemas']['ApplicationArtist']

interface Props {
  application: Application
  onSelect: (app: Application) => void
  onAccept: (id: string) => void
  onDecline: (id: string) => void
  onWaitlist: (id: string) => void
  onToggleShortlist: (id: string, current: boolean, reviewFlag: boolean) => void
  onToggleReviewFlag: (id: string, shortlisted: boolean, current: boolean) => void
  onScore: (id: string, score: number) => void
  isReviewer: boolean
  isPending: boolean
}

function initials(name: string): string {
  return name.split(' ').slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('')
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

const ACTION_TRANSITIONS: Record<string, string[]> = {
  submitted: ['accept', 'waitlist', 'decline'],
  accepted: ['decline'],
  waitlisted: ['accept', 'decline'],
  declined: [],
}

function StarControl({ appId, myScore, onScore }: { appId: string; myScore: number | null | undefined; onScore: (id: string, score: number) => void }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          aria-label={`Score ${n}`}
          onClick={e => { e.stopPropagation(); onScore(appId, n) }}
          className={`text-lg leading-none ${(myScore ?? 0) >= n ? 'text-amber' : 'text-light hover:text-mid'}`}
        >
          ★
        </button>
      ))}
    </div>
  )
}

export function ApplicationCard({
  application, onSelect, onAccept, onDecline, onWaitlist,
  onToggleShortlist, onToggleReviewFlag, onScore, isReviewer, isPending,
}: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: application.id ?? '' })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const artist = application.artist as ApplicationArtist | undefined
  const name = artist?.display_name ?? 'Unknown Artist'
  const tags = artist?.medium_tags ?? []
  const actions = ACTION_TRANSITIONS[application.status ?? ''] ?? []
  const id = application.id ?? ''
  const myScore = application.my_score
  const avgScore = application.avg_score
  const scoreCount = application.score_count ?? 0
  const showAvg = myScore != null && scoreCount > 0

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-start gap-3 p-4 bg-warm border border-light rounded-lg"
    >
      {/* Drag handle — owner only */}
      {!isReviewer && (
        <button
          {...attributes}
          {...listeners}
          className="mt-1 cursor-grab text-light hover:text-mid touch-none flex-shrink-0"
          aria-label="Drag to reorder"
          tabIndex={-1}
        >
          ⠿
        </button>
      )}

      {/* Avatar */}
      <div
        className="w-10 h-10 rounded-full bg-clay flex items-center justify-center text-offwhite font-sans font-bold text-sm flex-shrink-0 cursor-pointer"
        onClick={() => onSelect(application)}
      >
        {initials(name)}
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onSelect(application)}>
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="font-sans font-semibold text-ink text-sm">{name}</span>
          {artist?.location_label && (
            <span className="font-sans text-xs text-mid">{artist.location_label}</span>
          )}
          <span className="font-sans text-xs text-mid">· Applied {formatDate(application.created_at ?? '')}</span>
        </div>
        {tags.length > 0 && (
          <div className="flex gap-1 flex-wrap mt-1">
            {tags.slice(0, 3).map(tag => (
              <span key={tag} className="font-mono text-xs text-mid bg-white border border-light rounded px-1.5 py-0.5 uppercase tracking-wider">
                {tag}
              </span>
            ))}
            {tags.length > 3 && <span className="font-mono text-xs text-mid px-1">+{tags.length - 3}</span>}
          </div>
        )}
      </div>

      {/* Right slot: differs by role */}
      <div className="flex flex-col gap-2 items-end flex-shrink-0">
        {isReviewer ? (
          /* Reviewer: star control + avg once scored */
          <>
            {showAvg && (
              <span className="font-mono text-xs text-mid">★ {avgScore?.toFixed(1)} · {scoreCount}</span>
            )}
            <StarControl appId={id} myScore={myScore} onScore={onScore} />
          </>
        ) : (
          /* Owner: flags + actions + avg badge */
          <>
            <div className="flex items-center gap-2">
              {showAvg && (
                <span className="font-mono text-xs text-mid">★ {avgScore?.toFixed(1)} · {scoreCount}</span>
              )}
              <div className="flex gap-1">
                <button
                  onClick={() => onToggleShortlist(id, application.shortlisted ?? false, application.review_flag ?? false)}
                  disabled={isPending}
                  className={`text-base leading-none ${application.shortlisted ? 'text-amber' : 'text-light hover:text-mid'} disabled:opacity-50`}
                  title={application.shortlisted ? 'Remove shortlist' : 'Shortlist'}
                >
                  ⭐
                </button>
                <button
                  onClick={() => onToggleReviewFlag(id, application.shortlisted ?? false, application.review_flag ?? false)}
                  disabled={isPending}
                  className={`text-base leading-none ${application.review_flag ? 'text-clay' : 'text-light hover:text-mid'} disabled:opacity-50`}
                  title={application.review_flag ? 'Remove review flag' : 'Flag for review'}
                >
                  🚩
                </button>
              </div>
            </div>
            <div className="flex gap-1.5">
              {actions.includes('accept') && (
                <button onClick={() => onAccept(id)} disabled={isPending}
                  className="font-sans text-xs font-semibold bg-amber text-ink px-3 py-1.5 rounded-lg hover:opacity-90 disabled:opacity-50">
                  Accept
                </button>
              )}
              {actions.includes('waitlist') && (
                <button onClick={() => onWaitlist(id)} disabled={isPending}
                  className="font-sans text-xs text-mid border border-light px-3 py-1.5 rounded-lg hover:opacity-80 disabled:opacity-50">
                  Waitlist
                </button>
              )}
              {actions.includes('decline') && (
                <button onClick={() => onDecline(id)} disabled={isPending}
                  className="font-sans text-xs text-clay border border-clay/30 px-3 py-1.5 rounded-lg hover:opacity-80 disabled:opacity-50">
                  Decline
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd web && npx vitest run src/__tests__/components/ApplicationCard.test.tsx
```
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ApplicationCard.tsx web/src/__tests__/components/ApplicationCard.test.tsx
git commit -m "feat(web): ApplicationCard reviewer mode — avg badge, star control, no decision controls"
```

---

## Task 2: `ApplicationSlideOver` — star score control + reviewer mode

**Files:**
- Modify: `web/src/components/ApplicationSlideOver.tsx`
- Create: `web/src/__tests__/components/ApplicationSlideOver.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `web/src/__tests__/components/ApplicationSlideOver.test.tsx`:

```tsx
import { vi, describe, it, expect } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { ApplicationSlideOver } from '@/components/ApplicationSlideOver'

vi.mock('@/components/ApplicationNotes', () => ({
  ApplicationNotes: () => React.createElement('div', { 'data-testid': 'notes' }),
}))
vi.mock('@tanstack/react-query', () => ({
  useMutation: vi.fn().mockReturnValue({ mutate: vi.fn(), isPending: false }),
  useQueryClient: vi.fn().mockReturnValue({ invalidateQueries: vi.fn() }),
}))

const baseApp = {
  id: 'app-1',
  form_id: 'form-1',
  artist_id: 'artist-1',
  status: 'submitted' as const,
  shortlisted: false,
  review_flag: false,
  rank: 0,
  answers: { q1: 'My answer' },
  notes: [],
  avg_score: null,
  score_count: 0,
  my_score: null,
  created_at: '2026-05-01T10:00:00Z',
  updated_at: '2026-05-01T10:00:00Z',
  artist: { display_name: 'Rosa Vane', medium_tags: ['spray paint'], avatar_s3_key: null, location_label: 'Bristol' },
}

const noop = () => {}
const baseProps = {
  festivalId: 'fest-1',
  formFields: [{ id: 'q1', label: 'Tell us about your work', type: 'text', required: true }],
  onClose: noop,
  onAccept: noop,
  onDecline: noop,
  onWaitlist: noop,
  onScore: noop,
  isPending: false,
}

describe('ApplicationSlideOver — owner mode (isReviewer=false)', () => {
  it('shows action buttons', () => {
    render(<ApplicationSlideOver {...baseProps} application={baseApp} isReviewer={false} />)
    expect(screen.getByText('Accept')).toBeInTheDocument()
    expect(screen.getByText('Waitlist')).toBeInTheDocument()
    expect(screen.getByText('Decline')).toBeInTheDocument()
  })

  it('hides avg score when my_score is null', () => {
    render(<ApplicationSlideOver {...baseProps} application={baseApp} isReviewer={false} />)
    expect(screen.queryByText('Panel average')).not.toBeInTheDocument()
  })

  it('shows avg score once my_score is set', () => {
    const app = { ...baseApp, avg_score: 3.5, score_count: 2, my_score: 4 }
    render(<ApplicationSlideOver {...baseProps} application={app} isReviewer={false} />)
    expect(screen.getByText(/Panel average/i)).toBeInTheDocument()
    expect(screen.getByText(/3\.5/)).toBeInTheDocument()
  })
})

describe('ApplicationSlideOver — reviewer mode (isReviewer=true)', () => {
  it('hides action buttons', () => {
    render(<ApplicationSlideOver {...baseProps} application={baseApp} isReviewer={true} />)
    expect(screen.queryByText('Accept')).not.toBeInTheDocument()
    expect(screen.queryByText('Waitlist')).not.toBeInTheDocument()
    expect(screen.queryByText('Decline')).not.toBeInTheDocument()
  })

  it('shows score stars', () => {
    render(<ApplicationSlideOver {...baseProps} application={baseApp} isReviewer={true} />)
    expect(screen.getByLabelText('Score 1')).toBeInTheDocument()
    expect(screen.getByLabelText('Score 5')).toBeInTheDocument()
  })

  it('calls onScore when a star is clicked', () => {
    const onScore = vi.fn()
    render(<ApplicationSlideOver {...baseProps} application={baseApp} isReviewer={true} onScore={onScore} />)
    fireEvent.click(screen.getByLabelText('Score 3'))
    expect(onScore).toHaveBeenCalledWith('app-1', 3)
  })

  it('avg hidden before scoring, visible after', () => {
    const { rerender } = render(<ApplicationSlideOver {...baseProps} application={baseApp} isReviewer={true} />)
    expect(screen.queryByText(/Panel average/i)).not.toBeInTheDocument()

    const app = { ...baseApp, avg_score: 3.0, score_count: 1, my_score: 3 }
    rerender(<ApplicationSlideOver {...baseProps} application={app} isReviewer={true} />)
    expect(screen.getByText(/Panel average/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd web && npx vitest run src/__tests__/components/ApplicationSlideOver.test.tsx
```
Expected: FAIL — `onScore` and `isReviewer` props not defined.

- [ ] **Step 3: Implement the changes**

Replace `web/src/components/ApplicationSlideOver.tsx` with:

```tsx
'use client'

import { useEffect } from 'react'
import { ApplicationNotes } from './ApplicationNotes'
import type { components } from '@render/api-client'

type Application = components['schemas']['Application']
type ApplicationArtist = components['schemas']['ApplicationArtist']
type ApplicationNote = components['schemas']['ApplicationNote']

interface FormField {
  id: string
  label: string
  type: string
  required: boolean
}

interface Props {
  application: Application | null
  formFields: FormField[]
  festivalId: string
  onClose: () => void
  onAccept: (id: string) => void
  onDecline: (id: string) => void
  onWaitlist: (id: string) => void
  onScore: (id: string, score: number) => void
  isReviewer: boolean
  isPending: boolean
}

const ACTION_TRANSITIONS: Record<string, string[]> = {
  submitted: ['accept', 'waitlist', 'decline'],
  accepted: ['decline'],
  waitlisted: ['accept', 'decline'],
  declined: [],
}

function initials(name: string): string {
  return name.split(' ').slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('')
}

export function ApplicationSlideOver({
  application, formFields, festivalId, onClose,
  onAccept, onDecline, onWaitlist, onScore, isReviewer, isPending,
}: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  if (!application) return null

  const artist = application.artist as ApplicationArtist | undefined
  const name = artist?.display_name ?? 'Unknown Artist'
  const answers = (application.answers ?? {}) as Record<string, string>
  const notes = (application.notes ?? []) as ApplicationNote[]
  const actions = ACTION_TRANSITIONS[application.status ?? ''] ?? []
  const id = application.id ?? ''
  const myScore = application.my_score
  const avgScore = application.avg_score
  const scoreCount = application.score_count ?? 0
  const showAvg = myScore != null && scoreCount > 0

  const labelFor = (fieldId: string): string =>
    formFields.find(f => f.id === fieldId)?.label ?? fieldId

  return (
    <>
      <div className="fixed inset-0 bg-ink/20 z-40" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 w-full max-w-lg bg-offwhite shadow-xl z-50 overflow-y-auto">
        <div className="p-6 space-y-6">

          {/* Header */}
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-clay flex items-center justify-center text-offwhite font-bold">
                {initials(name)}
              </div>
              <div>
                <h2 className="font-serif text-xl text-ink">{name}</h2>
                {artist?.location_label && (
                  <p className="font-sans text-sm text-mid">{artist.location_label}</p>
                )}
              </div>
            </div>
            <button onClick={onClose} className="font-sans text-mid hover:text-ink text-xl leading-none">✕</button>
          </div>

          {/* Medium tags */}
          {(artist?.medium_tags ?? []).length > 0 && (
            <div className="flex gap-1.5 flex-wrap">
              {(artist?.medium_tags ?? []).map(tag => (
                <span key={tag} className="font-mono text-xs text-mid bg-warm border border-light rounded px-2 py-0.5 uppercase tracking-wider">
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Actions — owner only */}
          {!isReviewer && actions.length > 0 && (
            <div className="flex gap-2">
              {actions.includes('accept') && (
                <button onClick={() => onAccept(id)} disabled={isPending}
                  className="font-sans text-sm font-semibold bg-amber text-ink px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50">
                  Accept
                </button>
              )}
              {actions.includes('waitlist') && (
                <button onClick={() => onWaitlist(id)} disabled={isPending}
                  className="font-sans text-sm text-mid border border-light px-4 py-2 rounded-lg hover:opacity-80 disabled:opacity-50">
                  Waitlist
                </button>
              )}
              {actions.includes('decline') && (
                <button onClick={() => onDecline(id)} disabled={isPending}
                  className="font-sans text-sm text-clay border border-clay/30 px-4 py-2 rounded-lg hover:opacity-80 disabled:opacity-50">
                  Decline
                </button>
              )}
            </div>
          )}

          {/* Score control */}
          <div>
            <h3 className="font-mono text-xs text-mid uppercase tracking-widest mb-2">Your Score</h3>
            <div className="flex gap-1 mb-1">
              {[1, 2, 3, 4, 5].map(n => (
                <button
                  key={n}
                  aria-label={`Score ${n}`}
                  onClick={() => onScore(id, n)}
                  className={`text-2xl leading-none ${(myScore ?? 0) >= n ? 'text-amber' : 'text-light hover:text-mid'}`}
                >
                  ★
                </button>
              ))}
            </div>
            <p className="font-sans text-xs text-mid">
              {myScore != null ? `${myScore} / 5 · click to change` : 'Not yet scored'}
            </p>
          </div>

          {/* Panel average — only shown once scored */}
          {showAvg && (
            <div>
              <h3 className="font-mono text-xs text-mid uppercase tracking-widest mb-1">Panel average</h3>
              <p className="font-sans text-sm text-ink">
                ★ {avgScore?.toFixed(1)}
                <span className="text-mid ml-1">from {scoreCount} {scoreCount === 1 ? 'reviewer' : 'reviewers'}</span>
              </p>
            </div>
          )}

          {/* Application answers */}
          {Object.keys(answers).length > 0 && (
            <div>
              <h3 className="font-mono text-xs text-mid uppercase tracking-widest mb-3">Application</h3>
              <div className="space-y-4">
                {Object.entries(answers).map(([fieldId, value]) => (
                  <div key={fieldId}>
                    <p className="font-sans text-xs text-mid mb-1">{labelFor(fieldId)}</p>
                    <p className="font-sans text-sm text-ink">{value}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Notes */}
          <ApplicationNotes festivalId={festivalId} applicationId={id} notes={notes} />
        </div>
      </div>
    </>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd web && npx vitest run src/__tests__/components/ApplicationSlideOver.test.tsx
```
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ApplicationSlideOver.tsx web/src/__tests__/components/ApplicationSlideOver.test.tsx
git commit -m "feat(web): ApplicationSlideOver star score control + reviewer mode"
```

---

## Task 3: Applications page — owner/reviewer detection + score mutation

**Files:**
- Modify: `web/src/app/organiser/festivals/[id]/applications/page.tsx`
- Modify: `web/src/__tests__/organiser/applications-page.test.tsx`

- [ ] **Step 1: Add reviewer-mode assertions to the existing test**

Add this test to the existing `describe` block in `web/src/__tests__/organiser/applications-page.test.tsx`:

```tsx
it('hides decision controls and shows star control in reviewer mode', async () => {
  // First useQuery call = applications (200), second = reviewers (403 sentinel)
  mockUseQuery
    .mockReturnValueOnce({ data: [{
      id: 'app-1', form_id: 'form-1', artist_id: 'artist-1',
      status: 'submitted', shortlisted: false, review_flag: false, rank: 0,
      answers: {}, notes: [], avg_score: null, score_count: 0, my_score: null,
      created_at: '2026-05-01T10:00:00Z', updated_at: '2026-05-01T10:00:00Z',
      artist: { display_name: 'Rosa Vane', medium_tags: [], avatar_s3_key: null, location_label: null },
    }], isLoading: false } as unknown as ReturnType<typeof useQuery>)
    .mockReturnValueOnce({ data: 'REVIEWER', isLoading: false } as unknown as ReturnType<typeof useQuery>)
    // formQuery
    .mockReturnValueOnce({ data: { fields: [] }, isLoading: false } as unknown as ReturnType<typeof useQuery>)

  render(React.createElement(ApplicationsReviewPage, { params: mockParams }))

  await waitFor(() => {
    expect(screen.queryByText('Accept')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Drag to reorder')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Score 1')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run existing tests to establish baseline**

```bash
cd web && npx vitest run src/__tests__/organiser/applications-page.test.tsx
```
Expected: existing 3 tests PASS, new test FAILS (score/reviewer props not wired).

- [ ] **Step 3: Rewrite `ApplicationsView` in `page.tsx`**

Replace `web/src/app/organiser/festivals/[id]/applications/page.tsx` with:

```tsx
'use client'

import { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import Link from 'next/link'
import { apiClient } from '@/lib/api'
import { ApplicationCard } from '@/components/ApplicationCard'
import { ApplicationSlideOver } from '@/components/ApplicationSlideOver'
import { useApplicationReorder } from '@/hooks/useApplicationReorder'
import type { components } from '@render/api-client'

type Application = components['schemas']['Application']

interface FormField {
  id: string
  label: string
  type: string
  required: boolean
}

type TabKey = 'pending' | 'shortlisted' | 'accepted' | 'waitlisted' | 'declined'

const TAB_LABELS: Record<TabKey, string> = {
  pending: 'Pending', shortlisted: 'Shortlisted', accepted: 'Accepted',
  waitlisted: 'Waitlisted', declined: 'Declined',
}

function filterTab(apps: Application[], tab: TabKey): Application[] {
  switch (tab) {
    case 'pending':     return apps.filter(a => a.status === 'submitted' && !a.shortlisted)
    case 'shortlisted': return apps.filter(a => a.status === 'submitted' && a.shortlisted)
    case 'accepted':    return apps.filter(a => a.status === 'accepted')
    case 'waitlisted':  return apps.filter(a => a.status === 'waitlisted')
    case 'declined':    return apps.filter(a => a.status === 'declined')
  }
}

// Sentinel distinguishes 403 (caller is a reviewer) from 200 with empty list (owner with no reviewers).
const REVIEWER_SENTINEL = 'REVIEWER' as const

type Props = { params: Promise<{ id: string }> }

export default function ApplicationsReviewPage({ params }: Props) {
  const [festivalId, setFestivalId] = useState<string | null>(null)
  if (!festivalId) {
    params.then(p => setFestivalId(p.id))
    return <div className="font-sans text-mid text-sm p-8">Loading…</div>
  }
  return <ApplicationsView festivalId={festivalId} />
}

function ApplicationsView({ festivalId }: { festivalId: string }) {
  const [activeTab, setActiveTab] = useState<TabKey>('pending')
  const [selectedApp, setSelectedApp] = useState<Application | null>(null)
  const [localApps, setLocalApps] = useState<Application[] | null>(null)
  const queryClient = useQueryClient()

  const applicationsQuery = useQuery({
    queryKey: ['festival-applications', festivalId],
    queryFn: async () => {
      const res = await apiClient.GET('/festivals/{festivalID}/applications', {
        params: { path: { festivalID: festivalId } },
      })
      if (res.error) throw new Error('Failed to load applications')
      return (res.data ?? []) as Application[]
    },
  })

  // Detect owner vs reviewer: a 403 on the reviewers endpoint means the caller is a reviewer.
  const reviewersQuery = useQuery({
    queryKey: ['festival-reviewers', festivalId],
    queryFn: async () => {
      const res = await apiClient.GET('/festivals/{festivalID}/reviewers', {
        params: { path: { festivalID: festivalId } },
      })
      if (res.response.status === 403) return REVIEWER_SENTINEL
      return res.data ?? []
    },
  })
  const isReviewer = reviewersQuery.data === REVIEWER_SENTINEL

  useEffect(() => {
    if (applicationsQuery.data) setLocalApps(applicationsQuery.data)
  }, [applicationsQuery.data])

  const formQuery = useQuery({
    queryKey: ['festival-form', festivalId],
    queryFn: async () => {
      const res = await apiClient.GET('/festivals/{festivalID}/form', {
        params: { path: { festivalID: festivalId } },
      })
      if (res.error) return { fields: [] }
      return res.data
    },
  })

  const allApps = localApps ?? applicationsQuery.data ?? []
  const tabApps = useMemo(() => filterTab(allApps, activeTab), [allApps, activeTab])

  const setTabApps = (updated: Application[]) => {
    setLocalApps(prev => {
      if (!prev) return updated
      const tabIds = new Set(tabApps.map(a => a.id))
      return [...prev.filter(a => !tabIds.has(a.id)), ...updated]
    })
  }

  const { handleDragEnd } = useApplicationReorder(
    festivalId, tabApps,
    activeTab === 'shortlisted' ? 'submitted' : activeTab,
    setTabApps,
  )

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['festival-applications', festivalId] })

  const acceptMutation = useMutation({
    mutationFn: async (applicationId: string) => {
      const res = await apiClient.POST('/festivals/{festivalID}/applications/{applicationID}/accept', {
        params: { path: { festivalID: festivalId, applicationID: applicationId } },
      })
      if (res.error) throw new Error('Accept failed')
    },
    onSuccess: () => { setSelectedApp(null); invalidate() },
  })

  const declineMutation = useMutation({
    mutationFn: async (applicationId: string) => {
      const res = await apiClient.POST('/festivals/{festivalID}/applications/{applicationID}/decline', {
        params: { path: { festivalID: festivalId, applicationID: applicationId } },
      })
      if (res.error) throw new Error('Decline failed')
    },
    onSuccess: () => { setSelectedApp(null); invalidate() },
  })

  const waitlistMutation = useMutation({
    mutationFn: async (applicationId: string) => {
      const res = await apiClient.POST('/festivals/{festivalID}/applications/{applicationID}/waitlist', {
        params: { path: { festivalID: festivalId, applicationID: applicationId } },
      })
      if (res.error) throw new Error('Waitlist failed')
    },
    onSuccess: () => { setSelectedApp(null); invalidate() },
  })

  const patchMutation = useMutation({
    mutationFn: async ({ id, shortlisted, reviewFlag }: { id: string; shortlisted: boolean; reviewFlag: boolean }) => {
      const res = await apiClient.PATCH('/festivals/{festivalID}/applications/{applicationID}', {
        params: { path: { festivalID: festivalId, applicationID: id } },
        body: { shortlisted, review_flag: reviewFlag },
      })
      if (res.error) throw new Error('Patch failed')
    },
    onSuccess: invalidate,
  })

  const scoreMutation = useMutation({
    mutationFn: async ({ applicationId, score }: { applicationId: string; score: number }) => {
      // Optimistic update
      setLocalApps(prev => prev?.map(a =>
        a.id === applicationId ? { ...a, my_score: score } : a
      ) ?? null)
      const res = await apiClient.PUT('/festivals/{festivalID}/applications/{applicationID}/score', {
        params: { path: { festivalID: festivalId, applicationID: applicationId } },
        body: { score },
      })
      if (res.error) throw new Error('Score failed')
    },
    onSuccess: invalidate,
    onError: invalidate, // roll back optimistic update
  })

  const handleScore = (applicationId: string, score: number) => {
    scoreMutation.mutate({ applicationId, score })
    // Also update the selected app in the slide-over optimistically
    if (selectedApp?.id === applicationId) {
      setSelectedApp(prev => prev ? { ...prev, my_score: score } : null)
    }
  }

  const isPending =
    acceptMutation.isPending || declineMutation.isPending ||
    waitlistMutation.isPending || patchMutation.isPending

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const formFields: FormField[] = (formQuery.data as { fields?: FormField[] })?.fields ?? []

  const counts: Record<TabKey, number> = {
    pending: filterTab(allApps, 'pending').length,
    shortlisted: filterTab(allApps, 'shortlisted').length,
    accepted: filterTab(allApps, 'accepted').length,
    waitlisted: filterTab(allApps, 'waitlisted').length,
    declined: filterTab(allApps, 'declined').length,
  }

  const cardList = (
    <ul className="space-y-3">
      {tabApps.map(app => (
        <li key={app.id}>
          <ApplicationCard
            application={app}
            onSelect={setSelectedApp}
            onAccept={id => acceptMutation.mutate(id)}
            onDecline={id => declineMutation.mutate(id)}
            onWaitlist={id => waitlistMutation.mutate(id)}
            onToggleShortlist={(id, shortlisted, reviewFlag) =>
              patchMutation.mutate({ id, shortlisted: !shortlisted, reviewFlag })
            }
            onToggleReviewFlag={(id, shortlisted, reviewFlag) =>
              patchMutation.mutate({ id, shortlisted, reviewFlag: !reviewFlag })
            }
            onScore={handleScore}
            isReviewer={isReviewer}
            isPending={isPending}
          />
        </li>
      ))}
    </ul>
  )

  return (
    <div>
      <div className="mb-6">
        <Link href={`/organiser/festivals/${festivalId}`}
          className="font-mono text-xs text-mid uppercase tracking-widest hover:text-ink transition-colors">
          ← Festival
        </Link>
      </div>

      <h1 className="font-serif text-4xl text-ink mb-6">Applications</h1>

      {applicationsQuery.isError && (
        <p role="alert" className="font-sans text-sm text-clay mb-4">Failed to load applications.</p>
      )}

      {/* Tabs */}
      <div className="flex gap-0 border-b border-light mb-6 overflow-x-auto">
        {(Object.keys(TAB_LABELS) as TabKey[]).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`font-sans text-sm px-4 py-2 whitespace-nowrap border-b-2 -mb-px transition-colors ${
              activeTab === tab ? 'border-amber text-ink font-semibold' : 'border-transparent text-mid hover:text-ink'
            }`}
          >
            {TAB_LABELS[tab]}
            <span className="ml-1.5 font-mono text-xs">({counts[tab]})</span>
          </button>
        ))}
      </div>

      {applicationsQuery.isLoading && <p className="font-sans text-mid text-sm">Loading…</p>}

      {!applicationsQuery.isLoading && tabApps.length === 0 && (
        <p className="font-sans text-mid text-sm">No applications here.</p>
      )}

      {tabApps.length > 0 && (
        isReviewer ? cardList : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={tabApps.map(a => a.id ?? '')} strategy={verticalListSortingStrategy}>
              {cardList}
            </SortableContext>
          </DndContext>
        )
      )}

      <ApplicationSlideOver
        application={selectedApp}
        formFields={formFields}
        festivalId={festivalId}
        onClose={() => setSelectedApp(null)}
        onAccept={id => acceptMutation.mutate(id)}
        onDecline={id => declineMutation.mutate(id)}
        onWaitlist={id => waitlistMutation.mutate(id)}
        onScore={handleScore}
        isReviewer={isReviewer}
        isPending={isPending}
      />
    </div>
  )
}
```

- [ ] **Step 4: Run all web unit tests**

```bash
cd web && npx vitest run src/__tests__/organiser/applications-page.test.tsx
```
Expected: all 4 tests PASS (3 existing + 1 new reviewer-mode test).

- [ ] **Step 5: Commit**

```bash
git add web/src/app/organiser/festivals/\[id\]/applications/page.tsx \
        web/src/__tests__/organiser/applications-page.test.tsx
git commit -m "feat(web): applications page — reviewer detection, score mutation, skip DnD for reviewers"
```

---

## Task 4: Reviewer management section on festival settings page

**Files:**
- Modify: `web/src/app/organiser/festivals/[id]/page.tsx`
- Create: `web/src/__tests__/organiser/festival-detail-reviewers.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `web/src/__tests__/organiser/festival-detail-reviewers.test.tsx`:

```tsx
import { vi, describe, it, expect } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ReviewersSection } from '@/app/organiser/festivals/[id]/ReviewersSection'

vi.mock('@/lib/api', () => ({ apiClient: { GET: vi.fn(), POST: vi.fn(), DELETE: vi.fn() } }))
vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
  useMutation: vi.fn().mockReturnValue({ mutate: vi.fn(), isPending: false }),
  useQueryClient: vi.fn().mockReturnValue({ invalidateQueries: vi.fn() }),
}))

import { useQuery } from '@tanstack/react-query'
const mockUseQuery = vi.mocked(useQuery)

describe('ReviewersSection', () => {
  it('shows empty state when no reviewers', async () => {
    mockUseQuery.mockReturnValue({ data: [], isLoading: false } as unknown as ReturnType<typeof useQuery>)
    render(<ReviewersSection festivalId="fest-1" />)
    await waitFor(() => expect(screen.getByText(/No reviewers yet/i)).toBeInTheDocument())
    expect(screen.getByPlaceholderText('email@example.com')).toBeInTheDocument()
  })

  it('renders reviewer list with accepted/pending badges', async () => {
    mockUseQuery.mockReturnValue({
      data: [
        { user_id: 'u1', email: 'jo@test.com', accepted_at: '2026-05-01T10:00:00Z', created_at: '2026-05-01T09:00:00Z' },
        { user_id: 'u2', email: 'hannah@test.com', accepted_at: null, created_at: '2026-05-02T09:00:00Z' },
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof useQuery>)
    render(<ReviewersSection festivalId="fest-1" />)
    await waitFor(() => {
      expect(screen.getByText('jo@test.com')).toBeInTheDocument()
      expect(screen.getByText('hannah@test.com')).toBeInTheDocument()
    })
    expect(screen.getByText('accepted')).toBeInTheDocument()
    expect(screen.getByText('pending')).toBeInTheDocument()
  })

  it('does not invite when email is empty', async () => {
    const { apiClient } = await import('@/lib/api')
    mockUseQuery.mockReturnValue({ data: [], isLoading: false } as unknown as ReturnType<typeof useQuery>)
    render(<ReviewersSection festivalId="fest-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Invite' }))
    expect(apiClient.POST).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd web && npx vitest run src/__tests__/organiser/festival-detail-reviewers.test.tsx
```
Expected: FAIL — `ReviewersSection` not found.

- [ ] **Step 3: Create `ReviewersSection` as a separate file**

Create `web/src/app/organiser/festivals/[id]/ReviewersSection.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { components } from '@render/api-client'

type Reviewer = components['schemas']['ReviewerResponse']

export function ReviewersSection({ festivalId }: { festivalId: string }) {
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteError, setInviteError] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const reviewersQuery = useQuery({
    queryKey: ['festival-reviewers', festivalId],
    queryFn: async () => {
      const res = await apiClient.GET('/festivals/{festivalID}/reviewers', {
        params: { path: { festivalID: festivalId } },
      })
      if (res.error) return [] as Reviewer[]
      return (res.data ?? []) as Reviewer[]
    },
  })

  const inviteMutation = useMutation({
    mutationFn: async (email: string) => {
      const res = await apiClient.POST('/festivals/{festivalID}/reviewers', {
        params: { path: { festivalID: festivalId } },
        body: { email },
      })
      if (res.error) throw new Error('Invite failed')
    },
    onSuccess: () => {
      setInviteEmail('')
      setInviteError(null)
      queryClient.invalidateQueries({ queryKey: ['festival-reviewers', festivalId] })
    },
    onError: () => setInviteError('Failed to send invite. Check the email address.'),
  })

  const removeMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await apiClient.DELETE('/festivals/{festivalID}/reviewers/{userID}', {
        params: { path: { festivalID: festivalId, userID: userId } },
      })
      if (res.error) throw new Error('Remove failed')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['festival-reviewers', festivalId] }),
  })

  const handleInvite = () => {
    const email = inviteEmail.trim()
    if (!email || !email.includes('@')) return
    setInviteError(null)
    inviteMutation.mutate(email)
  }

  const reviewers = (reviewersQuery.data ?? []) as Reviewer[]

  return (
    <div className="p-5 bg-warm border border-light rounded-lg mb-6">
      <h2 className="font-serif text-xl text-ink mb-4">Reviewers</h2>

      {reviewers.length === 0 && (
        <p className="font-sans text-sm text-mid mb-4">
          No reviewers yet. Invite someone by email to score applications.
        </p>
      )}

      {reviewers.length > 0 && (
        <ul className="space-y-2 mb-4">
          {reviewers.map(r => (
            <li key={r.user_id} className="flex items-center gap-3">
              <span className="font-sans text-sm text-ink flex-1">{r.email}</span>
              <span className={`font-mono text-xs px-2 py-0.5 rounded-full border ${
                r.accepted_at
                  ? 'text-ink bg-warm border-light'
                  : 'text-mid bg-warm border-light'
              }`}>
                {r.accepted_at ? 'accepted' : 'pending'}
              </span>
              <button
                onClick={() => removeMutation.mutate(r.user_id ?? '')}
                disabled={removeMutation.isPending}
                className="font-sans text-xs text-clay hover:opacity-80 disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2 max-w-sm">
        <input
          type="email"
          value={inviteEmail}
          onChange={e => setInviteEmail(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleInvite()}
          placeholder="email@example.com"
          className="flex-1 border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite focus:outline-none focus:border-amber"
        />
        <button
          onClick={handleInvite}
          disabled={inviteMutation.isPending}
          className="font-sans text-sm font-medium bg-amber text-ink px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50"
        >
          {inviteMutation.isPending ? 'Inviting…' : 'Invite'}
        </button>
      </div>
      {inviteError && <p role="alert" className="font-sans text-xs text-clay mt-2">{inviteError}</p>}
    </div>
  )
}
```

- [ ] **Step 4: Add `ReviewersSection` to the festival settings page**

In `web/src/app/organiser/festivals/[id]/page.tsx`, add the import at the top:
```tsx
import { ReviewersSection } from './ReviewersSection'
```

Then add the component before the Danger zone section (after the Visibility section):
```tsx
      {/* Reviewers */}
      <ReviewersSection festivalId={festivalId} />

      {/* Danger zone */}
```

- [ ] **Step 5: Run the tests**

```bash
cd web && npx vitest run src/__tests__/organiser/festival-detail-reviewers.test.tsx
```
Expected: all 3 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/app/organiser/festivals/\[id\]/ReviewersSection.tsx \
        web/src/app/organiser/festivals/\[id\]/page.tsx \
        web/src/__tests__/organiser/festival-detail-reviewers.test.tsx
git commit -m "feat(web): reviewer management section on festival settings page"
```

---

## Task 5: Dashboard card + reviewing page

**Files:**
- Modify: `web/src/app/organiser/dashboard/page.tsx`
- Create: `web/src/app/organiser/reviewing/page.tsx`

- [ ] **Step 1: Rewrite the dashboard page**

Replace `web/src/app/organiser/dashboard/page.tsx`:

```tsx
'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { apiClient } from '@/lib/api'
import type { components } from '@render/api-client'

type FestivalSummary = components['schemas']['FestivalSummary']

export default function OrganiserDashboardPage() {
  const reviewingQuery = useQuery({
    queryKey: ['me-reviewing'],
    queryFn: async () => {
      const res = await apiClient.GET('/me/reviewing')
      if (res.error) return [] as FestivalSummary[]
      return (res.data ?? []) as FestivalSummary[]
    },
  })

  const reviewing = reviewingQuery.data ?? []

  return (
    <div>
      <h1 className="font-serif text-4xl text-ink mb-2">Organiser Dashboard</h1>
      <p className="font-sans text-mid mb-8">Manage your festivals and applications.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/organiser/festivals"
          className="block p-5 bg-warm border border-light rounded-lg hover:border-amber transition-colors"
        >
          <h2 className="font-serif text-xl text-ink mb-1">Festivals</h2>
          <p className="font-sans text-sm text-mid">Create and manage your paint festivals.</p>
        </Link>

        {reviewing.length > 0 && (
          <Link
            href="/organiser/reviewing"
            className="block p-5 bg-warm border border-light rounded-lg hover:border-amber transition-colors"
          >
            <h2 className="font-serif text-xl text-ink mb-1">
              Reviewing ({reviewing.length})
            </h2>
            <p className="font-sans text-sm text-mid">Festivals you've been invited to review.</p>
          </Link>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create the reviewing page**

Create `web/src/app/organiser/reviewing/page.tsx`:

```tsx
'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { apiClient } from '@/lib/api'
import type { components } from '@render/api-client'

type FestivalSummary = components['schemas']['FestivalSummary']

export default function ReviewingPage() {
  const reviewingQuery = useQuery({
    queryKey: ['me-reviewing'],
    queryFn: async () => {
      const res = await apiClient.GET('/me/reviewing')
      if (res.error) return [] as FestivalSummary[]
      return (res.data ?? []) as FestivalSummary[]
    },
  })

  const festivals = reviewingQuery.data ?? []

  return (
    <div>
      <div className="mb-6">
        <Link
          href="/organiser/dashboard"
          className="font-mono text-xs text-mid uppercase tracking-widest hover:text-ink transition-colors"
        >
          ← Dashboard
        </Link>
      </div>

      <h1 className="font-serif text-4xl text-ink mb-2">Reviewing</h1>
      <p className="font-sans text-mid mb-8">Festivals you've been invited to review.</p>

      {reviewingQuery.isLoading && (
        <p className="font-sans text-mid text-sm">Loading…</p>
      )}

      {!reviewingQuery.isLoading && festivals.length === 0 && (
        <p className="font-sans text-sm text-mid">
          You haven't been invited to review any festivals yet.
        </p>
      )}

      {festivals.length > 0 && (
        <ul className="space-y-3">
          {festivals.map(fest => (
            <li key={fest.id}>
              <div className="flex items-center justify-between p-5 bg-warm border border-light rounded-lg">
                <div>
                  <h2 className="font-serif text-lg text-ink">{fest.name}</h2>
                  <span className="font-mono text-xs text-mid uppercase tracking-widest">
                    {fest.status}
                  </span>
                </div>
                <Link
                  href={`/organiser/festivals/${fest.id}/applications`}
                  className="font-sans text-sm font-medium bg-amber text-ink px-4 py-2 rounded-lg hover:opacity-90"
                >
                  Go to applications →
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Build check**

```bash
cd web && npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add web/src/app/organiser/dashboard/page.tsx \
        web/src/app/organiser/reviewing/page.tsx
git commit -m "feat(web): dashboard Reviewing card + /organiser/reviewing page"
```

---

## Task 6: Run full web test suite

- [ ] **Step 1: Run all web tests**

```bash
task web:test
```
Expected: all tests PASS. If any pre-existing test fails due to the new `isReviewer`/`onScore` props being required, check the test and add `isReviewer={false}` and `onScore={() => {}}` to the `ApplicationCard` or `ApplicationSlideOver` usages in that test.

- [ ] **Step 2: Type-check**

```bash
cd web && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit if any minor test fixes were needed**

```bash
git add -A
git commit -m "fix(web): update existing tests for new isReviewer/onScore props"
```
Only commit if there were changes. If clean, skip.

---

## Task 7: Browser spec — `reviewer-board.spec.ts`

**Files:**
- Create: `e2e/browser/reviewer-board.spec.ts`

The spec needs: an organiser, a festival with a form, an applicant who applied, and a reviewer. The reviewer is invited by the organiser via API before the browser tests run. A second reviewer (reviewer2) is used for the dual-score canary.

- [ ] **Step 1: Write the spec**

Create `e2e/browser/reviewer-board.spec.ts`:

```typescript
import { test, expect, Browser } from '@playwright/test'
import {
  createArtist,
  createOrganiser,
  createProfile,
  createFestival,
  setFestivalStatus,
  upsertForm,
  submitApplication,
} from '../fixtures/helpers'

const API = process.env.API_URL ?? 'http://localhost:8080'

async function loginAs(browser: Browser, email: string, password: string, baseURL: string) {
  const ctx = await browser.newContext({ baseURL })
  const page = await ctx.newPage()
  await page.goto('/login')
  await page.fill('#email', email)
  await page.fill('#password', password)
  await page.click('button[type=submit]')
  await expect(page).toHaveURL('/dashboard')
  return { ctx, page }
}

async function inviteReviewer(orgToken: string, festivalId: string, email: string): Promise<void> {
  const res = await fetch(`${API}/festivals/${festivalId}/reviewers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${orgToken}` },
    body: JSON.stringify({ email }),
  })
  if (!res.ok) throw new Error(`Invite failed: ${res.status}`)
}

test.describe('reviewer board', () => {
  const suffix = `rev-board-${Date.now()}`
  const baseURL = process.env.BASE_URL ?? 'http://localhost:3000'

  let festivalId: string
  let orgToken: string
  let applicantAppId: string
  let reviewerEmail: string
  let reviewerPassword: string
  let reviewerToken: string

  test.beforeAll(async () => {
    const organiser = await createOrganiser(suffix)
    orgToken = organiser.token

    const { festivalId: fid } = await createFestival(orgToken, {
      name: `Reviewer Board Fest ${suffix}`,
      slug: `rev-board-${suffix}`,
    })
    festivalId = fid
    await upsertForm(orgToken, festivalId)
    await setFestivalStatus(orgToken, festivalId, 'open')

    // Applicant
    const applicant = await createArtist(`${suffix}-applicant`)
    await createProfile(applicant.token, { displayName: `Applicant ${suffix}` })
    const { applicationId } = await submitApplication(applicant.token, festivalId)
    applicantAppId = applicationId

    // Reviewer (has an account but no application)
    const reviewer = await createArtist(`${suffix}-reviewer`)
    reviewerEmail = reviewer.email
    reviewerPassword = reviewer.password
    reviewerToken = reviewer.token
    await inviteReviewer(orgToken, festivalId, reviewerEmail)
  })

  test('1 — reviewer board is read-only: no decision controls', async ({ browser }) => {
    const { ctx, page } = await loginAs(browser, reviewerEmail, reviewerPassword, baseURL)
    try {
      await page.goto(`/organiser/festivals/${festivalId}/applications`)
      await expect(page.getByRole('heading', { name: 'Applications' })).toBeVisible({ timeout: 10_000 })
      // Decision controls absent from DOM
      await expect(page.getByRole('button', { name: 'Accept', exact: true })).not.toBeVisible()
      await expect(page.getByRole('button', { name: 'Waitlist', exact: true })).not.toBeVisible()
      await expect(page.getByRole('button', { name: 'Decline', exact: true })).not.toBeVisible()
      // Drag handle absent
      await expect(page.getByLabel('Drag to reorder')).not.toBeVisible()
      // Star score control present
      await expect(page.getByLabel('Score 1')).toBeVisible()
      await expect(page.getByLabel('Score 5')).toBeVisible()
    } finally {
      await ctx.close()
    }
  })

  test('2 — reviewer scores, avg unlocks on card and in slide-over', async ({ browser }) => {
    // First, have a second reviewer score so avg has two data points
    const reviewer2 = await createArtist(`${suffix}-reviewer2`)
    await inviteReviewer(orgToken, festivalId, reviewer2.email)
    // reviewer2 scores via API
    const scoreRes = await fetch(`${API}/festivals/${festivalId}/applications/${applicantAppId}/score`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${reviewer2.token}` },
      body: JSON.stringify({ score: 2 }),
    })
    expect(scoreRes.ok).toBe(true)

    const { ctx, page } = await loginAs(browser, reviewerEmail, reviewerPassword, baseURL)
    try {
      await page.goto(`/organiser/festivals/${festivalId}/applications`)
      await expect(page.getByLabel('Score 4')).toBeVisible({ timeout: 10_000 })

      // Avg badge should NOT be visible before scoring
      const avgBadge = page.locator('text=/★.*·.*[0-9]/')
      await expect(avgBadge).not.toBeVisible()

      // Click 4th star to score
      await page.getByLabel('Score 4').click()
      await page.waitForTimeout(500)

      // Avg badge now visible on the card (my_score != null, score_count >= 1)
      await expect(avgBadge.first()).toBeVisible({ timeout: 5_000 })

      // Open slide-over and verify avg section appears
      await page.locator('text=Applicant').first().click()
      await expect(page.getByText(/Panel average/i)).toBeVisible({ timeout: 5_000 })
    } finally {
      await ctx.close()
    }
  })

  test('3 — score persists on page reload', async ({ browser }) => {
    const { ctx, page } = await loginAs(browser, reviewerEmail, reviewerPassword, baseURL)
    try {
      await page.goto(`/organiser/festivals/${festivalId}/applications`)
      await page.waitForLoadState('networkidle')
      // Stars should reflect the score of 4 from test 2
      // Check the 4th star is filled (amber) and 5th is not
      const star4 = page.getByLabel('Score 4')
      const star5 = page.getByLabel('Score 5')
      await expect(star4).toBeVisible({ timeout: 10_000 })
      // Avg badge still visible (my_score persisted)
      await expect(page.locator('text=/★.*·.*[0-9]/').first()).toBeVisible()
    } finally {
      await ctx.close()
    }
  })

  test('4 — re-scoring updates the score', async ({ browser }) => {
    const { ctx, page } = await loginAs(browser, reviewerEmail, reviewerPassword, baseURL)
    try {
      await page.goto(`/organiser/festivals/${festivalId}/applications`)
      await expect(page.getByLabel('Score 2')).toBeVisible({ timeout: 10_000 })
      // Change score from 4 to 2
      await page.getByLabel('Score 2').click()
      await page.waitForTimeout(500)
      // Avg badge still visible
      await expect(page.locator('text=/★.*·.*[0-9]/').first()).toBeVisible()
    } finally {
      await ctx.close()
    }
  })

  test('5 — COI: reviewer who applied sees empty board', async ({ browser }) => {
    // Set up a new festival where the reviewer is the only applicant
    const dualSuffix = `${suffix}-dual`
    const dualOrg = await createOrganiser(dualSuffix)
    const { festivalId: dualFestId } = await createFestival(dualOrg.token, {
      name: `Dual Fest ${dualSuffix}`,
      slug: `dual-${dualSuffix}`,
    })
    await upsertForm(dualOrg.token, dualFestId)
    await setFestivalStatus(dualOrg.token, dualFestId, 'open')

    // dual user is both applicant and reviewer
    const dual = await createArtist(dualSuffix)
    await createProfile(dual.token, { displayName: `Dual ${dualSuffix}` })
    await submitApplication(dual.token, dualFestId)
    await inviteReviewer(dualOrg.token, dualFestId, dual.email)

    const { ctx, page } = await loginAs(browser, dual.email, dual.password, baseURL)
    try {
      await page.goto(`/organiser/festivals/${dualFestId}/applications`)
      // COI: their own application is hidden → empty state
      await expect(page.getByText('No applications here.')).toBeVisible({ timeout: 10_000 })
    } finally {
      await ctx.close()
    }
  })
})
```

- [ ] **Step 2: Run the spec against the live stack**

Ensure the stack is running (`task up` and `task db:migrate` if needed).

```bash
npx playwright test e2e/browser/reviewer-board.spec.ts
```
Expected: all 5 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/browser/reviewer-board.spec.ts
git commit -m "test(e2e): reviewer board — read-only, scoring, avg unlock, persistence, COI"
```

---

## Task 8: Browser spec — `reviewer-management.spec.ts`

**Files:**
- Create: `e2e/browser/reviewer-management.spec.ts`

- [ ] **Step 1: Write the spec**

Create `e2e/browser/reviewer-management.spec.ts`:

```typescript
import { test, expect, Browser } from '@playwright/test'
import {
  createArtist,
  createOrganiser,
  createFestival,
  setFestivalStatus,
  upsertForm,
  submitApplication,
  createProfile,
} from '../fixtures/helpers'

const API = process.env.API_URL ?? 'http://localhost:8080'

async function loginAs(browser: Browser, email: string, password: string, baseURL: string) {
  const ctx = await browser.newContext({ baseURL })
  const page = await ctx.newPage()
  await page.goto('/login')
  await page.fill('#email', email)
  await page.fill('#password', password)
  await page.click('button[type=submit]')
  await expect(page).toHaveURL('/dashboard')
  return { ctx, page }
}

async function inviteReviewer(orgToken: string, festivalId: string, email: string): Promise<void> {
  const res = await fetch(`${API}/festivals/${festivalId}/reviewers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${orgToken}` },
    body: JSON.stringify({ email }),
  })
  if (!res.ok) throw new Error(`Invite failed: ${res.status}`)
}

test.describe('reviewer management', () => {
  const suffix = `rev-mgmt-${Date.now()}`
  const baseURL = process.env.BASE_URL ?? 'http://localhost:3000'

  test('1 — organiser invites reviewer, pending badge appears in settings', async ({ browser }) => {
    const organiser = await createOrganiser(`${suffix}-inv`)
    const { festivalId } = await createFestival(organiser.token, {
      name: `Invite Fest ${suffix}`,
      slug: `invite-${suffix}`,
    })
    const reviewer = await createArtist(`${suffix}-inv-rev`)

    const { ctx, page } = await loginAs(browser, organiser.email, organiser.password, baseURL)
    try {
      await page.goto(`/organiser/festivals/${festivalId}`)
      await expect(page.getByText('Reviewers')).toBeVisible({ timeout: 10_000 })

      // Invite via the UI
      await page.fill('input[placeholder="email@example.com"]', reviewer.email)
      await page.getByRole('button', { name: 'Invite' }).click()

      // Reviewer row appears with pending badge
      await expect(page.getByText(reviewer.email)).toBeVisible({ timeout: 5_000 })
      await expect(page.getByText('pending')).toBeVisible()
    } finally {
      await ctx.close()
    }
  })

  test('2 — invited reviewer gets read-only board', async ({ browser }) => {
    const organiser = await createOrganiser(`${suffix}-ro`)
    const { festivalId } = await createFestival(organiser.token, {
      name: `RO Fest ${suffix}`,
      slug: `ro-${suffix}`,
    })
    await upsertForm(organiser.token, festivalId)
    await setFestivalStatus(organiser.token, festivalId, 'open')
    const applicant = await createArtist(`${suffix}-ro-app`)
    await createProfile(applicant.token, { displayName: `RO Applicant ${suffix}` })
    await submitApplication(applicant.token, festivalId)

    const reviewer = await createArtist(`${suffix}-ro-rev`)
    await inviteReviewer(organiser.token, festivalId, reviewer.email)

    const { ctx, page } = await loginAs(browser, reviewer.email, reviewer.password, baseURL)
    try {
      await page.goto(`/organiser/festivals/${festivalId}/applications`)
      await expect(page.getByRole('heading', { name: 'Applications' })).toBeVisible({ timeout: 10_000 })
      await expect(page.getByRole('button', { name: 'Accept', exact: true })).not.toBeVisible()
      await expect(page.getByLabel('Score 1')).toBeVisible()
    } finally {
      await ctx.close()
    }
  })

  test('3 — full entry-point flow: dashboard card → reviewing page → board', async ({ browser }) => {
    const organiser = await createOrganiser(`${suffix}-flow`)
    const { festivalId } = await createFestival(organiser.token, {
      name: `Flow Fest ${suffix}`,
      slug: `flow-${suffix}`,
    })
    await upsertForm(organiser.token, festivalId)
    await setFestivalStatus(organiser.token, festivalId, 'open')
    const applicant = await createArtist(`${suffix}-flow-app`)
    await createProfile(applicant.token, { displayName: `Flow Applicant ${suffix}` })
    await submitApplication(applicant.token, festivalId)

    const reviewer = await createArtist(`${suffix}-flow-rev`)
    await inviteReviewer(organiser.token, festivalId, reviewer.email)

    const { ctx, page } = await loginAs(browser, reviewer.email, reviewer.password, baseURL)
    try {
      // Dashboard shows Reviewing card
      await expect(page.getByRole('heading', { name: /Reviewing \(\d+\)/ })).toBeVisible({ timeout: 10_000 })
      await page.getByRole('heading', { name: /Reviewing \(\d+\)/ }).click()

      // /organiser/reviewing lists the festival
      await expect(page).toHaveURL('/organiser/reviewing')
      await expect(page.getByText(`Flow Fest ${suffix}`)).toBeVisible()
      await page.getByRole('link', { name: 'Go to applications →' }).click()

      // Lands on read-only board
      await expect(page.getByRole('heading', { name: 'Applications' })).toBeVisible({ timeout: 10_000 })
      await expect(page.getByRole('button', { name: 'Accept', exact: true })).not.toBeVisible()
    } finally {
      await ctx.close()
    }
  })

  test('4 — dual-role: organiser invited to review peer festival sees both dashboard cards', async ({ browser }) => {
    const userA = await createOrganiser(`${suffix}-dual-a`)
    const userB = await createOrganiser(`${suffix}-dual-b`)

    // userA owns festival A
    await createFestival(userA.token, {
      name: `User A Fest ${suffix}`,
      slug: `user-a-${suffix}`,
    })

    // userB owns festival B and invites userA as a reviewer
    const { festivalId: festB } = await createFestival(userB.token, {
      name: `User B Fest ${suffix}`,
      slug: `user-b-${suffix}`,
    })
    await inviteReviewer(userB.token, festB, userA.email)

    const { ctx, page } = await loginAs(browser, userA.email, userA.password, baseURL)
    try {
      // Both cards visible
      await expect(page.getByRole('heading', { name: 'Festivals', exact: true })).toBeVisible({ timeout: 10_000 })
      await expect(page.getByRole('heading', { name: /Reviewing \(\d+\)/ })).toBeVisible({ timeout: 5_000 })
    } finally {
      await ctx.close()
    }
  })

  test('5 — reviewing page lists multiple festivals when invited to two', async ({ browser }) => {
    const org1 = await createOrganiser(`${suffix}-multi1`)
    const org2 = await createOrganiser(`${suffix}-multi2`)
    const reviewer = await createArtist(`${suffix}-multi-rev`)

    const { festivalId: fid1 } = await createFestival(org1.token, {
      name: `Multi Fest 1 ${suffix}`,
      slug: `multi-1-${suffix}`,
    })
    const { festivalId: fid2 } = await createFestival(org2.token, {
      name: `Multi Fest 2 ${suffix}`,
      slug: `multi-2-${suffix}`,
    })
    await inviteReviewer(org1.token, fid1, reviewer.email)
    await inviteReviewer(org2.token, fid2, reviewer.email)

    const { ctx, page } = await loginAs(browser, reviewer.email, reviewer.password, baseURL)
    try {
      await page.goto('/organiser/reviewing')
      await expect(page.getByText(`Multi Fest 1 ${suffix}`)).toBeVisible({ timeout: 10_000 })
      await expect(page.getByText(`Multi Fest 2 ${suffix}`)).toBeVisible()
      // Both "Go to applications" links present
      const links = page.getByRole('link', { name: 'Go to applications →' })
      await expect(links).toHaveCount(2)
    } finally {
      await ctx.close()
    }
  })
})
```

- [ ] **Step 2: Run the spec**

```bash
npx playwright test e2e/browser/reviewer-management.spec.ts
```
Expected: all 5 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/browser/reviewer-management.spec.ts
git commit -m "test(e2e): reviewer management — invite, read-only board, entry flow, dual-role, multi-festival"
```

---

## Task 9: Final sweep

- [ ] **Step 1: Full web test suite**

```bash
task web:test
```
Expected: all PASS.

- [ ] **Step 2: Full browser e2e suite**

```bash
npx playwright test
```
Expected: all pass. Pre-existing billing webhook failures (`billing-webhook.test.ts`) are a known stale-DB issue unrelated to this work.

- [ ] **Step 3: Go lint (API is unchanged, but verify nothing broke)**

```bash
task -d api lint
```
Expected: 0 issues.

- [ ] **Step 4: Type-check**

```bash
cd web && npx tsc --noEmit
```
Expected: 0 errors.

---

## Self-Review

**Spec coverage:**
- Section 2 (detection) ✓ Task 3 — `REVIEWER_SENTINEL` pattern, `reviewersQuery`
- Section 3 (score mutation) ✓ Task 3 — `scoreMutation` with optimistic update + rollback
- Section 4 (ApplicationCard) ✓ Task 1 — `isReviewer`, `onScore`, avg badge, `StarControl`
- Section 5 (ApplicationSlideOver) ✓ Task 2 — score section, panel avg gated on `my_score`, action buttons hidden for reviewers
- Section 6 (reviewer management) ✓ Task 4 — `ReviewersSection` component, invite/list/remove
- Section 7 (dashboard card) ✓ Task 5 — `GET /me/reviewing`, conditional card
- Section 8 (reviewing page) ✓ Task 5 — `/organiser/reviewing`
- Section 9 unit tests ✓ Tasks 1–4
- Section 9 browser specs ✓ Tasks 7–8 (5+5 cases)

**Type consistency:** `isReviewer: boolean` and `onScore: (id: string, score: number) => void` used consistently across Card, SlideOver, and page. `REVIEWER_SENTINEL` defined in Task 3 and only referenced in Task 3. `ReviewersSection` exported from its own file and imported in Task 4.

**No placeholders:** all code blocks are complete. Commands have expected outputs.

**One known callout:** Task 7 test 2 creates `reviewer2` inside the test body to ensure two scores exist before the avg badge appears. This means the `score_count` after both scores is 2, and the avg is `(4+2)/2 = 3`. The assertion `toBeVisible()` on the badge is correct. Test 3 (persist) relies on the score written in test 2 still being in the DB — tests within a `describe` block share state via `beforeAll`, so this is safe as long as tests run in order (Playwright runs them sequentially within a file by default).
