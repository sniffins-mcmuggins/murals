# Epic 1 · Phase 2 — Reviewer-Only Scoring Queue (seal the leak) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give reviewers a dedicated scoring queue instead of the organiser's kanban, and trim the API response so reviewers never receive decision data (`staged_decision`, `shortlisted`, `review_flag`, `rank`, `notes`).

**Architecture:** On the API, branch the existing `GET /festivals/{id}/applications` to serialise a trimmed `reviewerApplicationResponse` for reviewers (same endpoint, role-branched shape — do not add a route). On the web, render a new `ReviewerQueue` component when the caller is a reviewer, reusing the existing `ApplicationSlideOver` (reviewer mode) for the actual scoring. The organiser kanban is untouched.

**Tech Stack:** Go (chi, pgx, sqlc), Next.js + React Query, Vitest + Playwright, Taskfile.

**Preconditions:**
- **Phase 1 is merged** (`2026-06-04-epic1-phase1-remove-anonymous-review.md`). `identity_hidden` and `anonymous_review` no longer exist.
- Same Docker bind-mount caveat as Phase 1 (edit the main checkout, or mirror into it from a worktree).
- Stack up (`task up`).

**Design reference:** `docs/superpowers/specs/2026-06-04-reviewer-scoring-round-design.md` (Phase 2 section).

---

### Task 1: Keystone leak-seal test — reviewer response omits decision fields

**Files:**
- Modify: `e2e/api/reviewer-panellist.test.ts`

- [ ] **Step 1: Add the failing test**

Add inside the existing `describe`, after the `'reviewer sees applications and can score → 200'` block (~line 67):

```ts
  // Phase 2 leak-seal: the reviewer's application list must NOT carry any
  // organiser decision data. This is the most important test in this phase.
  it('reviewer list response omits all decision fields', async () => {
    const res = await fetch(`${API}/festivals/${festivalId}/applications`, { headers: auth(reviewerToken) })
    expect(res.status).toBe(200)
    const apps = await res.json()
    const app = apps.find((a: { id: string }) => a.id === appId)
    expect(app).toBeDefined()
    // Decision fields must be absent from the reviewer shape.
    expect(app.staged_decision).toBeUndefined()
    expect(app.shortlisted).toBeUndefined()
    expect(app.review_flag).toBeUndefined()
    expect(app.rank).toBeUndefined()
    expect(app.notes).toBeUndefined()
    // Scoring-relevant fields remain.
    expect(app.artist?.display_name).toBeDefined()
    expect(Array.isArray(app.criterion_scores)).toBe(true)
  })

  // Owner shape is unchanged — decision fields still present for the organiser.
  it('owner list response still includes decision fields', async () => {
    const res = await fetch(`${API}/festivals/${festivalId}/applications`, { headers: auth(orgToken) })
    const apps = await res.json()
    const app = apps.find((a: { id: string }) => a.id === appId)
    expect(app.shortlisted).toBeDefined()
    expect(Array.isArray(app.notes)).toBe(true)
  })
```

- [ ] **Step 2: Run to verify the first test fails**

Run: `npx vitest run e2e/api/reviewer-panellist.test.ts -t "omits all decision fields"`
Expected: FAIL — `staged_decision`/`shortlisted`/etc. are present (reviewers currently get the full `applicationResponse`).

- [ ] **Step 3: Commit the failing test**

```bash
git add e2e/api/reviewer-panellist.test.ts
git commit -m "test: reviewer response omits decision fields (failing)"
```

---

### Task 2: Trimmed reviewer response shape (API)

**Files:**
- Modify: `api/internal/festival/application.go` (add `reviewerApplicationResponse` + mapper)
- Modify: `api/internal/festival/review.go` (branch the final encode)

- [ ] **Step 1: Add the trimmed struct and mapper**

In `application.go`, immediately after `toMyApplicationResponse` (~line 111), add:

```go
// reviewerApplicationResponse is the panellist-facing view. It deliberately
// omits all organiser decision signals (staged_decision, shortlisted,
// review_flag, rank, status) and notes — reviewers score blind to decisions.
type reviewerApplicationResponse struct {
	ID              string           `json:"id"`
	FormID          string           `json:"form_id"`
	ArtistID        string           `json:"artist_id"`
	Answers         json.RawMessage  `json:"answers"`
	CreatedAt       string           `json:"created_at"`
	AvgScore        *float64         `json:"avg_score"`
	ScoreCount      int32            `json:"score_count"`
	MyScore         *int32           `json:"my_score"`
	Artist          *artistSummary   `json:"artist,omitempty"`
	CriterionScores []criterionScore `json:"criterion_scores"`
}

func toReviewerApplicationResponse(a applicationResponse) reviewerApplicationResponse {
	return reviewerApplicationResponse{
		ID:              a.ID,
		FormID:          a.FormID,
		ArtistID:        a.ArtistID,
		Answers:         a.Answers,
		CreatedAt:       a.CreatedAt,
		AvgScore:        a.AvgScore,
		ScoreCount:      a.ScoreCount,
		MyScore:         a.MyScore,
		Artist:          a.Artist,
		CriterionScores: a.CriterionScores,
	}
}
```

- [ ] **Step 2: Branch the encode in `review.go`**

At the end of `ListApplicationsHandler`, the handler currently builds `resp []applicationResponse` and encodes it (~line 272). Replace the final encode:

```go
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
```

with a role branch:

```go
		w.Header().Set("Content-Type", "application/json")
		if role == roleReviewer {
			trimmed := make([]reviewerApplicationResponse, len(resp))
			for i := range resp {
				trimmed[i] = toReviewerApplicationResponse(resp[i])
			}
			_ = json.NewEncoder(w).Encode(trimmed)
			return
		}
		_ = json.NewEncoder(w).Encode(resp)
```

(`role` is already in scope from `resolveFestivalAccess` near the top of the handler.)

- [ ] **Step 3: Build**

Run: `go -C api build ./...`
Expected: compiles.

- [ ] **Step 4: Run the keystone tests**

Run: `npx vitest run e2e/api/reviewer-panellist.test.ts -t "decision fields"`
Expected: both PASS (reviewer omits, owner retains).

- [ ] **Step 5: Run the whole reviewer file + API gate**

Run: `task e2e:api`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add api/internal/festival/application.go api/internal/festival/review.go
git commit -m "feat(api): trim reviewer application response (seal decision leak)"
```

---

### Task 3: `ReviewerQueue` component (web)

**Files:**
- Create: `web/src/components/ReviewerQueue.tsx`

The queue renders the trimmed list, groups unscored vs scored, shows a progress bar, and opens the existing `ApplicationSlideOver` (reviewer mode) to score. It is presentational: the parent page owns the data and the score mutation, and passes them in.

- [ ] **Step 1: Write the component**

Create `web/src/components/ReviewerQueue.tsx`:

```tsx
'use client'

import type { components } from '@render/api-client'

type Application = components['schemas']['Application']
type ApplicationArtist = components['schemas']['ApplicationArtist']

interface Props {
  applications: Application[]
  festivalName: string
  roundOpen: boolean       // Phase 3 wires this; pass `true` until then
  onSelect: (app: Application) => void
}

function initials(name: string): string {
  return name.split(' ').slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('')
}

function isScored(app: Application): boolean {
  return app.my_score != null
}

export function ReviewerQueue({ applications, festivalName, roundOpen, onSelect }: Props) {
  const toScore = applications.filter(a => !isScored(a))
  const scored = applications.filter(isScored)
  const total = applications.length
  const done = scored.length
  const pct = total > 0 ? Math.round((done / total) * 100) : 0

  return (
    <div className="max-w-2xl">
      <div className={`rounded-lg px-5 py-3 mb-6 text-sm font-sans ${roundOpen ? 'bg-ink text-offwhite' : 'bg-warm text-mid border border-light'}`}>
        {roundOpen
          ? <>⏳ Review round is <span className="text-amber font-bold">open</span> — score each artist. The organiser closes it when ready.</>
          : <>Review round is <span className="font-bold">closed</span> — scoring is read-only.</>}
      </div>

      <h1 className="font-serif text-4xl text-ink mb-1">{festivalName}</h1>
      <p className="font-mono text-xs text-mid uppercase tracking-widest mb-2">You&apos;ve scored {done} of {total}</p>
      <div className="h-2 bg-warm rounded-full overflow-hidden mb-8">
        <div className="h-full bg-amber" style={{ width: `${pct}%` }} />
      </div>

      {toScore.length > 0 && (
        <>
          <h2 className="font-mono text-xs text-mid uppercase tracking-widest mb-2">To score ({toScore.length})</h2>
          <ul className="space-y-2 mb-8">
            {toScore.map(app => (
              <ReviewerRow key={app.id} app={app} onSelect={onSelect} scored={false} disabled={!roundOpen} />
            ))}
          </ul>
        </>
      )}

      {scored.length > 0 && (
        <>
          <h2 className="font-mono text-xs text-mid uppercase tracking-widest mb-2">Scored ({scored.length})</h2>
          <ul className="space-y-2">
            {scored.map(app => (
              <ReviewerRow key={app.id} app={app} onSelect={onSelect} scored disabled={!roundOpen} />
            ))}
          </ul>
        </>
      )}

      {total === 0 && (
        <p className="font-sans text-sm text-mid">No applications to review yet.</p>
      )}
    </div>
  )
}

function ReviewerRow({ app, onSelect, scored, disabled }: {
  app: Application; onSelect: (a: Application) => void; scored: boolean; disabled: boolean
}) {
  const artist = app.artist as ApplicationArtist | undefined
  const name = artist?.display_name ?? 'Unknown Artist'
  const tags = (artist?.medium_tags ?? []).slice(0, 2)

  return (
    <li className={`flex items-center gap-3 p-3 rounded-lg border ${scored ? 'bg-warm border-light' : 'bg-white border-light'}`}>
      <div className="w-10 h-10 rounded-full bg-clay flex items-center justify-center text-offwhite font-bold text-xs flex-shrink-0">
        {initials(name)}
      </div>
      <div className="min-w-0">
        <div className="font-sans font-semibold text-ink text-sm truncate">{name}</div>
        {tags.length > 0 && (
          <div className="font-mono text-mid uppercase tracking-wider" style={{ fontSize: '9px' }}>{tags.join(' · ')}</div>
        )}
      </div>
      <div className="ml-auto flex items-center gap-3 flex-shrink-0">
        {scored
          ? <>
              <span className="font-mono text-amber text-xs">★ {app.my_score}</span>
              <button onClick={() => onSelect(app)} className="font-mono text-mid text-xs underline disabled:opacity-50" disabled={disabled}>edit</button>
            </>
          : <button onClick={() => onSelect(app)} className="font-sans text-xs font-semibold bg-amber text-ink px-3.5 py-2 rounded-lg hover:opacity-90 disabled:opacity-50" disabled={disabled}>Score →</button>}
      </div>
    </li>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -p web --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/ReviewerQueue.tsx
git commit -m "feat(web): ReviewerQueue component"
```

---

### Task 4: Render the queue for reviewers in the applications page

**Files:**
- Modify: `web/src/app/organiser/festivals/[id]/applications/page.tsx`

The page already computes `isReviewer` (via the 403 sentinel on the reviewers query) and already wires `selectedApp` + `handleScore` + `<ApplicationSlideOver isReviewer={isReviewer} … />`. We add an early reviewer branch that renders `<ReviewerQueue>` + the slide-over instead of the kanban.

- [ ] **Step 1: Import the queue**

Add to the imports at the top of `page.tsx` (alongside the existing `ApplicationCard`/`KanbanColumn` imports, ~lines 9–11):

```tsx
import { ReviewerQueue } from '@/components/ReviewerQueue'
```

- [ ] **Step 2: Add the reviewer branch**

In `KanbanView`, immediately before the existing `return (` of the main layout (the one starting `<div>` with the back-link, ~line 355), insert a reviewer-only return. Use the already-computed `isReviewer`, `allApps`, `festivalQuery`, `formFields`, `criteria`, `selectedApp`, `handleScore`, `isPending`:

```tsx
  if (isReviewer) {
    const festName = (festivalQuery.data as { name?: string } | undefined)?.name ?? 'Festival'
    return (
      <div>
        <div className="mb-6">
          <Link href="/organiser/reviewing"
            className="font-mono text-xs text-mid uppercase tracking-widest hover:text-ink transition-colors">
            ← Reviewing
          </Link>
        </div>
        {applicationsQuery.isLoading
          ? <p className="font-sans text-mid text-sm">Loading…</p>
          : <ReviewerQueue
              applications={allApps}
              festivalName={festName}
              roundOpen={true}
              onSelect={setSelectedApp}
            />}
        <ApplicationSlideOver
          application={selectedApp}
          formFields={formFields}
          festivalId={festivalId}
          onClose={() => setSelectedApp(null)}
          onStage={() => {}}
          onScore={handleScore}
          isReviewer={true}
          isPending={isPending}
          criteria={criteria}
          isReleased={false}
        />
      </div>
    )
  }
```

(`roundOpen={true}` is a placeholder until Phase 3 supplies real round state. `onStage={() => {}}` is never invoked because the slide-over hides Decision buttons when `isReviewer`.)

- [ ] **Step 3: Confirm the slide-over already hides notes for reviewers**

Open `web/src/components/ApplicationSlideOver.tsx`. The Decision selector is already gated `!isReviewer`. Verify the **Notes** block at the bottom is also reviewer-gated; if it is not, wrap `<ApplicationNotes … />` so it only renders when `!isReviewer`:

```tsx
          {!isReviewer && (
            <ApplicationNotes festivalId={festivalId} applicationId={id} notes={notes} />
          )}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc -p web --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/app/organiser/festivals/\[id\]/applications/page.tsx web/src/components/ApplicationSlideOver.tsx
git commit -m "feat(web): reviewers see the scoring queue, not the kanban"
```

---

### Task 5: Replace the reviewer-board browser spec with a reviewer-queue spec

`e2e/browser/reviewer-board.spec.ts` asserts the reviewer sees the "Applications" kanban heading with no decision buttons. That contract is gone — reviewers now see a queue. Rewrite it.

**Files:**
- Delete: `e2e/browser/reviewer-board.spec.ts`
- Create: `e2e/browser/reviewer-queue.spec.ts`

- [ ] **Step 1: Delete the old spec**

```bash
git rm e2e/browser/reviewer-board.spec.ts
```

- [ ] **Step 2: Write the new spec**

Create `e2e/browser/reviewer-queue.spec.ts`:

```ts
import { test, expect, Browser } from '@playwright/test'
import {
  createArtist, createOrganiser, createProfile,
  createFestival, setFestivalStatus, upsertForm, submitApplication,
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

test.describe('reviewer queue', () => {
  const suffix = `rev-queue-${Date.now()}`
  const baseURL = process.env.BASE_URL ?? 'http://localhost:3000'

  let festivalId: string
  let orgToken: string
  let reviewerEmail: string
  let reviewerPassword: string

  test.beforeAll(async () => {
    const organiser = await createOrganiser(suffix)
    orgToken = organiser.token
    const { festivalId: fid } = await createFestival(orgToken, {
      name: `Reviewer Queue Fest ${suffix}`,
      slug: `rev-queue-${suffix}`,
    })
    festivalId = fid
    await upsertForm(orgToken, festivalId)
    await setFestivalStatus(orgToken, festivalId, 'open')

    const applicant = await createArtist(`${suffix}-applicant`)
    await createProfile(applicant.token, { displayName: `Applicant ${suffix}` })
    await submitApplication(applicant.token, festivalId)

    const reviewer = await createArtist(`${suffix}-reviewer`)
    reviewerEmail = reviewer.email
    reviewerPassword = reviewer.password
    await inviteReviewer(orgToken, festivalId, reviewerEmail)
  })

  test('reviewer sees the queue, not the kanban, and can score', async ({ browser }) => {
    const { ctx, page } = await loginAs(browser, reviewerEmail, reviewerPassword, baseURL)
    try {
      await page.goto(`/organiser/festivals/${festivalId}/applications`)

      // Queue UI present; kanban absent.
      await expect(page.getByText(/You've scored 0 of 1/)).toBeVisible({ timeout: 10_000 })
      await expect(page.getByRole('heading', { name: 'Undecided' })).toHaveCount(0)
      await expect(page.getByRole('button', { name: '✓ Accept' })).toHaveCount(0)
      await expect(page.getByRole('button', { name: /Release/ })).toHaveCount(0)

      // Score via the slide-over.
      await page.getByRole('button', { name: 'Score →' }).click()
      await page.getByRole('button', { name: 'Score 4' }).click()  // overall rubric star
      await page.keyboard.press('Escape')

      // Progress advances; no Decision controls were ever shown.
      await expect(page.getByText(/You've scored 1 of 1/)).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Decision' })).toHaveCount(0)
    } finally {
      await ctx.close()
    }
  })
})
```

Note: the star aria-label is `Score {n}` for the no-rubric path (`ApplicationSlideOver.tsx`). If the test festival defines rubric criteria, use `Score {label} {n}` instead.

- [ ] **Step 3: Run the new spec**

Run: `npx playwright test e2e/browser/reviewer-queue.spec.ts`
Expected: PASS. If `Score →` isn't found, confirm Task 4 rendered the queue (the page must detect `isReviewer` via the reviewers-query 403 sentinel).

- [ ] **Step 4: Commit**

```bash
git add e2e/browser/reviewer-queue.spec.ts
git commit -m "test: reviewer-queue browser spec (replaces reviewer-board)"
```

---

### Task 6: Full verification + spec update

**Files:**
- Modify: `api/internal/festival/festival.spec.md`

- [ ] **Step 1: Full e2e**

Run: `task e2e`
Expected: all PASS. Watch for any other spec that assumed reviewers see the kanban (e.g. `reviewer-management.spec.ts`) — if one fails, update its reviewer-view assertions to the queue.

- [ ] **Step 2: Lint**

Run: `task lint`
Expected: clean.

- [ ] **Step 3: Update the spec**

In `api/internal/festival/festival.spec.md`:
- Under `## Invariants`, add:
  `- Reviewer application responses use the trimmed reviewerApplicationResponse — they MUST omit staged_decision, shortlisted, review_flag, rank, status, and notes. The organiser response is the full applicationResponse. Do not unify them.`
- Under `## AI Context`, add a line: `review.go branches the final encode by role — reviewers get toReviewerApplicationResponse; the web renders ReviewerQueue (not the kanban) for them.`
- Append to `## Changelog`:
  `2026-06-04 — Epic 1 Phase 2: reviewer-only scoring queue; trimmed reviewerApplicationResponse seals the decision-field leak.`

- [ ] **Step 4: Commit**

```bash
git add api/internal/festival/festival.spec.md
git commit -m "docs(spec): festival — reviewer queue + trimmed response"
```

---

## Self-review notes (author)

- **Spec coverage:** trimmed response (T1–T2), ReviewerQueue (T3), page branch + notes-gate (T4), browser spec (T5), invariant doc (T6). ✅
- **Leak seal is the keystone:** T1 asserts absence of every decision field; T6 records it as an invariant. ✅
- **`roundOpen` placeholder:** hard-coded `true` here; Phase 3 replaces it with real round state. Flagged in T4 Step 2.
- **No new route:** same `GET …/applications`, role-branched encode — matches the spec decision.
- **Naming:** `reviewerApplicationResponse` / `toReviewerApplicationResponse` (Go); `ReviewerQueue` (web). Consistent across tasks.
