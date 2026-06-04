# Epic 1 · Phase 3 — Review Round Lifecycle (sequential gate) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicit, organiser-controlled review round (`not started → open → closed`) that gates the workflow: while open, reviewers can score and the organiser's decisions are locked; closing it (allowed anytime, even with reviewers outstanding) finalises averages and unlocks the kanban.

**Architecture:** Two timestamps on `festivals` (`review_opened_at`, `review_closed_at`) drive a derived status. New owner-only `open`/`close` endpoints; opening emails reviewers via a detached goroutine. A `reviewRoundStatus()` helper gates the score endpoint (reviewers may only score while open) and the decision endpoints (locked while open). The web shows an organiser banner with Open/Close controls and disables drag + Decision buttons while open; the reviewer queue reflects real round state.

**Tech Stack:** Go (chi, pgx, sqlc), golang-migrate, OpenAPI + openapi-typescript, Next.js + React Query, Vitest + Playwright, Taskfile.

**Preconditions:**
- **Phases 1 and 2 are merged.** `reviewerApplicationResponse` and `ReviewerQueue` exist.
- Same Docker bind-mount caveat as earlier phases.
- Stack up (`task up`).

**Design reference:** `docs/superpowers/specs/2026-06-04-reviewer-scoring-round-design.md` (Phase 3 section).

**State machine:**
```
not_started (opened_at=∅, closed_at=∅)
   → open    (opened_at set, closed_at=∅)   reviewers score · decisions locked
   → closed  (closed_at set)                averages final · kanban unlocked
```

---

### Task 1: DB — round timestamps + queries

**Files:**
- Create: `db/migrations/000024_review_round.up.sql`
- Create: `db/migrations/000024_review_round.down.sql`
- Modify: `db/queries/festivals.sql` (add `OpenReviewRound`, `CloseReviewRound`)

- [ ] **Step 1: Up migration**

`db/migrations/000024_review_round.up.sql`:

```sql
ALTER TABLE festivals
  ADD COLUMN review_opened_at TIMESTAMPTZ,
  ADD COLUMN review_closed_at TIMESTAMPTZ;
```

- [ ] **Step 2: Down migration**

`db/migrations/000024_review_round.down.sql`:

```sql
ALTER TABLE festivals
  DROP COLUMN review_opened_at,
  DROP COLUMN review_closed_at;
```

- [ ] **Step 3: Add the queries**

Append to `db/queries/festivals.sql`:

```sql
-- name: OpenReviewRound :one
UPDATE festivals
SET review_opened_at = now(), review_closed_at = NULL, updated_at = now()
WHERE id = $1
  AND deleted_at IS NULL
  AND review_closed_at IS NULL
RETURNING *;

-- name: CloseReviewRound :one
UPDATE festivals
SET review_closed_at = now(), updated_at = now()
WHERE id = $1
  AND deleted_at IS NULL
  AND review_opened_at IS NOT NULL
  AND review_closed_at IS NULL
RETURNING *;
```

(`OpenReviewRound` refuses to reopen a closed round — matches the "no reopen in v1" decision. `CloseReviewRound` only closes a currently-open round.)

- [ ] **Step 4: Migrate + regen + verify**

Run: `task db:migrate`
Run: `task db:generate`
Run: `grep -n "ReviewOpenedAt\|ReviewClosedAt" api/internal/sqlcdb/models.go`
Expected: both fields present on the `Festival` struct (type `pgtype.Timestamptz`).

- [ ] **Step 5: Commit**

```bash
git add db/migrations/000024_review_round.up.sql db/migrations/000024_review_round.down.sql db/queries/festivals.sql api/internal/sqlcdb/
git commit -m "feat(db): review round timestamps + open/close queries"
```

---

### Task 2: Expose round status on the festival response

**Files:**
- Modify: `api/internal/festival/festival.go` (`festivalResponse` + `toFestivalResponse`)

- [ ] **Step 1: Add fields to `festivalResponse`**

In `festival.go`, add to the `festivalResponse` struct (after `DecisionsReleasedAt`, ~line 31):

```go
	ReviewOpenedAt *string `json:"review_opened_at,omitempty"`
	ReviewClosedAt *string `json:"review_closed_at,omitempty"`
	ReviewStatus   string  `json:"review_status"`
```

- [ ] **Step 2: Populate them in `toFestivalResponse`**

In `toFestivalResponse`, before `return resp`, add:

```go
	resp.ReviewStatus = "not_started"
	if f.ReviewOpenedAt.Valid {
		s := f.ReviewOpenedAt.Time.Format(time.RFC3339)
		resp.ReviewOpenedAt = &s
		resp.ReviewStatus = "open"
	}
	if f.ReviewClosedAt.Valid {
		s := f.ReviewClosedAt.Time.Format(time.RFC3339)
		resp.ReviewClosedAt = &s
		resp.ReviewStatus = "closed"
	}
```

- [ ] **Step 3: Build**

Run: `go -C api build ./...`
Expected: compiles.

- [ ] **Step 4: Commit**

```bash
git add api/internal/festival/festival.go
git commit -m "feat(api): expose review_status on festival response"
```

---

### Task 3: A shared round-status helper + gating tests (failing)

**Files:**
- Create: `api/internal/festival/review_round.go` (helper now; handlers in Task 4)
- Modify: `e2e/api/reviewer-panellist.test.ts` (gating tests)

- [ ] **Step 1: Write the helper**

Create `api/internal/festival/review_round.go`:

```go
package festival

import "github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"

type reviewRoundState int

const (
	reviewNotStarted reviewRoundState = iota
	reviewOpen
	reviewClosed
)

// reviewRoundStatus derives the round state from the festival's timestamps.
func reviewRoundStatus(f sqlcdb.Festival) reviewRoundState {
	if f.ReviewClosedAt.Valid {
		return reviewClosed
	}
	if f.ReviewOpenedAt.Valid {
		return reviewOpen
	}
	return reviewNotStarted
}
```

- [ ] **Step 2: Add gating tests (failing)**

In `e2e/api/reviewer-panellist.test.ts`, add a new `describe` at the end of the file (before the final closing `})` of the suite), using the existing `org`/`festivalId`/`appId`/`reviewerToken` from the outer scope is not possible across `describe` blocks, so set up fresh state:

```ts
  describe('review round gating', () => {
    let rOrg: OrganiserSetup
    let rFest: string
    let rApp: string
    let rReviewer: ArtistSetup

    beforeAll(async () => {
      rOrg = await createOrganiser(`${SUFFIX}-rr-org`)
      const f = await createFestival(rOrg.token, { name: `RR Fest ${SUFFIX}`, slug: `rr-${SUFFIX}` })
      rFest = f.festivalId
      await upsertForm(rOrg.token, rFest)
      await setFestivalStatus(rOrg.token, rFest, 'open')
      const applicant = await createArtist(`${SUFFIX}-rr-applicant`)
      await createProfile(applicant.token, { displayName: `RR Applicant ${SUFFIX}` })
      rApp = (await submitApplication(applicant.token, rFest)).applicationId
      rReviewer = await createArtist(`${SUFFIX}-rr-reviewer`)
      await fetch(`${API}/festivals/${rFest}/reviewers`, {
        method: 'POST', headers: json(rOrg.token), body: JSON.stringify({ email: rReviewer.email }),
      })
    })

    it('reviewer cannot score before the round opens → 409', async () => {
      const res = await fetch(`${API}/festivals/${rFest}/applications/${rApp}/score`, {
        method: 'PUT', headers: json(rReviewer.token), body: JSON.stringify({ score: 4 }),
      })
      expect(res.status).toBe(409)
    })

    it('owner opens the round → 200 and review_status=open', async () => {
      const open = await fetch(`${API}/festivals/${rFest}/review/open`, { method: 'POST', headers: auth(rOrg.token) })
      expect(open.status).toBe(200)
      const fest = await (await fetch(`${API}/festivals/${rFest}`, { headers: auth(rOrg.token) })).json()
      expect(fest.review_status).toBe('open')
    })

    it('reviewer can score while open; owner CANNOT stage a decision → 409', async () => {
      const score = await fetch(`${API}/festivals/${rFest}/applications/${rApp}/score`, {
        method: 'PUT', headers: json(rReviewer.token), body: JSON.stringify({ score: 4 }),
      })
      expect(score.status).toBe(200)
      const stage = await fetch(`${API}/festivals/${rFest}/applications/${rApp}`, {
        method: 'PATCH', headers: json(rOrg.token), body: JSON.stringify({ shortlisted: false, review_flag: false, staged_decision: 'accept' }),
      })
      expect(stage.status).toBe(409)
    })

    it('owner closes the round (force-close ok) → kanban unlocks, reviewer scoring 409', async () => {
      const close = await fetch(`${API}/festivals/${rFest}/review/close`, { method: 'POST', headers: auth(rOrg.token) })
      expect(close.status).toBe(200)
      // Decisions now allowed.
      const stage = await fetch(`${API}/festivals/${rFest}/applications/${rApp}`, {
        method: 'PATCH', headers: json(rOrg.token), body: JSON.stringify({ shortlisted: false, review_flag: false, staged_decision: 'accept' }),
      })
      expect(stage.status).toBe(200)
      // Reviewer can no longer score.
      const score = await fetch(`${API}/festivals/${rFest}/applications/${rApp}/score`, {
        method: 'PUT', headers: json(rReviewer.token), body: JSON.stringify({ score: 5 }),
      })
      expect(score.status).toBe(409)
    })
  })
```

Add `ArtistSetup` to the imports from `../fixtures/helpers.js` if not already present.

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run e2e/api/reviewer-panellist.test.ts -t "review round gating"`
Expected: FAIL — `review/open` returns 404 (route doesn't exist yet) and scoring isn't gated.

- [ ] **Step 4: Commit**

```bash
git add api/internal/festival/review_round.go e2e/api/reviewer-panellist.test.ts
git commit -m "test: review round gating (failing) + round-status helper"
```

---

### Task 4: Open/close handlers + gating

**Files:**
- Modify: `api/internal/festival/review_round.go` (add the two handlers)
- Modify: `api/internal/festival/score.go` (gate: reviewers score only while open)
- Modify: `api/internal/festival/application.go` (gate: PATCH staged_decision locked while open)
- Modify: `api/internal/festival/review.go` (gate accept/decline/waitlist) — see note
- Modify: `api/internal/festival/release.go` (gate release while open)
- Modify: `api/cmd/api/main.go` (register routes)
- Create: `api/internal/auth/review_round_email.go` (reviewer "scoring is open" email)

- [ ] **Step 1: Add the open/close handlers**

Append to `api/internal/festival/review_round.go` (add imports: `encoding/json`, `errors`, `net/http`, `log/slog`, `context`, `time`, chi, pgx, pgxpool, auth, httperr, sqlcdb):

```go
// OpenReviewRoundHandler handles POST /festivals/{festivalID}/review/open. Owner only.
func OpenReviewRoundHandler(pool *pgxpool.Pool, mailer auth.EmailSender, webBase string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := sqlcdb.New(pool)
		festUUID, ok := requireFestivalOwner(r, w, q, chi.URLParam(r, "festivalID"))
		if !ok {
			return
		}
		fest, err := q.OpenReviewRound(r.Context(), festUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.Conflict(w, "review round already closed")
				return
			}
			httperr.InternalServerError(w)
			return
		}
		go notifyReviewersRoundOpen(pool, mailer, webBase, festUUID, fest.Name)

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(toFestivalResponse(fest))
	}
}

// CloseReviewRoundHandler handles POST /festivals/{festivalID}/review/close. Owner only.
// Force-close is allowed regardless of how many reviewers have scored.
func CloseReviewRoundHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := sqlcdb.New(pool)
		festUUID, ok := requireFestivalOwner(r, w, q, chi.URLParam(r, "festivalID"))
		if !ok {
			return
		}
		fest, err := q.CloseReviewRound(r.Context(), festUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.Conflict(w, "review round is not open")
				return
			}
			httperr.InternalServerError(w)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(toFestivalResponse(fest))
	}
}

func notifyReviewersRoundOpen(pool *pgxpool.Pool, mailer auth.EmailSender, webBase string, festID sqlcdb.UUID, festName string) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	q := sqlcdb.New(pool)
	reviewers, err := q.ListFestivalReviewers(ctx, festID)
	if err != nil {
		slog.Error("review-round open: list reviewers failed", "err", err)
		return
	}
	for _, rv := range reviewers {
		auth.ReviewRoundOpenEmail(ctx, mailer, webBase, rv.Email, festName)
	}
}
```

Note: `sqlcdb.UUID` is `pgtype.UUID` — use the actual type the generated code expects for `festID` (match `ListFestivalReviewers`'s parameter type, which is `pgtype.UUID`). Adjust the signature accordingly.

- [ ] **Step 2: Add `httperr.Conflict` if missing**

Run: `grep -n "func Conflict" api/internal/httperr/*.go`
If absent, add to the httperr package (mirror the existing `Forbidden`):

```go
// Conflict writes a 409 with the given message.
func Conflict(w http.ResponseWriter, msg string) {
	writeError(w, http.StatusConflict, msg)
}
```

(Match the existing helper signature/pattern in that file — check how `UnprocessableEntity` is written and copy it exactly.)

- [ ] **Step 3: The reviewer "scoring open" email**

Create `api/internal/auth/review_round_email.go` (mirror `invite.go`'s structure; keep it best-effort):

```go
package auth

import (
	"context"
	"fmt"
	"log/slog"
)

// ReviewRoundOpenEmail tells a reviewer that scoring has opened for a festival.
// Best-effort: logs and returns on failure, never blocks the caller.
func ReviewRoundOpenEmail(ctx context.Context, mailer EmailSender, webBase, email, festivalName string) {
	subject := fmt.Sprintf("Scoring is open for %s", festivalName)
	body := fmt.Sprintf(
		"The organiser has opened reviewer scoring for %s.\n\nSign in to score the applicants: %s/organiser/reviewing\n",
		festivalName, webBase)
	if err := mailer.Send(ctx, email, subject, body); err != nil {
		slog.Error("review-round open email failed", "err", err, "email", email)
	}
}
```

Verify the `EmailSender.Send` signature first: `grep -n "Send(" api/internal/auth/*.go` and match argument order exactly.

- [ ] **Step 4: Gate the score endpoint**

In `score.go`, after the festival access check resolves the caller is a reviewer and before `UpsertApplicationScore`, load the festival and block unless open. The handler already has `q` and `festUUID`. Add, right before the `UpsertApplicationScore` call (~line 125):

```go
		// Reviewers may only score while the round is open. Owners may always score.
		if role == roleReviewer {
			fest, err := q.GetFestivalByID(r.Context(), festUUID)
			if err != nil {
				httperr.InternalServerError(w)
				return
			}
			if reviewRoundStatus(fest) != reviewOpen {
				httperr.Conflict(w, "review round is not open")
				return
			}
		}
```

- [ ] **Step 5: Gate staged decisions in `PatchApplicationHandler`**

Open `api/internal/festival/application.go`, find `PatchApplicationHandler`. After it confirms ownership and loads the festival/application, and specifically when the request sets `staged_decision` or `shortlisted`, block while the round is open. Add near the top of the handler's mutation logic (after the festival is available — load it via `q.GetFestivalByID(r.Context(), festUUID)` if not already loaded):

```go
		fest, err := q.GetFestivalByID(r.Context(), festUUID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}
		if reviewRoundStatus(fest) == reviewOpen {
			httperr.Conflict(w, "review round in progress — close it to make decisions")
			return
		}
```

(If `PatchApplicationHandler` already loads the festival for ownership, reuse that variable instead of re-querying.)

- [ ] **Step 6: Gate accept/decline/waitlist + reorder + release**

Each of these handlers already loads the festival (`AcceptApplicationHandler`, `DeclineApplicationHandler`, `WaitlistApplicationHandler` in `review.go`; `ReorderApplicationsHandler`; `ReleaseDecisionsHandler` in `release.go`). In each, immediately after the `GetFestivalByID` / ownership check, add the same guard:

```go
		if reviewRoundStatus(fest) == reviewOpen {
			httperr.Conflict(w, "review round in progress — close it to make decisions")
			return
		}
```

Use the festival variable each handler already has (named `fest` in `release.go`). For `ReorderApplicationsHandler`, if it doesn't currently load the festival, add `fest, err := q.GetFestivalByID(...)` after the owner check.

- [ ] **Step 7: Register the routes**

In `api/cmd/api/main.go`, in the authenticated group near the other festival routes (~line 226, by the reviewers routes), add:

```go
		r.Post("/festivals/{festivalID}/review/open", festival.OpenReviewRoundHandler(pool, mailer, cfg.WebPublicBase))
		r.Post("/festivals/{festivalID}/review/close", festival.CloseReviewRoundHandler(pool))
```

(`/review/open` and `/review/close` are literal sub-paths with no `{id}` sibling collision — safe. `mailer` and `cfg.WebPublicBase` are already in scope here, used by `InviteReviewerHandler`.)

- [ ] **Step 8: Build**

Run: `go -C api build ./...`
Expected: compiles. Fix any type mismatch on `festID`/`pgtype.UUID` or the `Send` signature flagged here.

- [ ] **Step 9: Run the gating tests**

Run: `npx vitest run e2e/api/reviewer-panellist.test.ts -t "review round gating"`
Expected: all PASS.

- [ ] **Step 10: Full API gate**

Run: `task e2e:api`
Expected: all PASS. If a pre-existing test stages a decision without opening/closing a round, it still passes (gate only triggers while a round is *open*; `not_started` is unaffected).

- [ ] **Step 11: Commit**

```bash
git add api/ e2e/api/reviewer-panellist.test.ts
git commit -m "feat(api): review round open/close + sequential decision/score gating"
```

---

### Task 5: OpenAPI — round fields + endpoints, regen client

**Files:**
- Modify: `openapi/openapi.yaml`
- Regenerated: `openapi/generated/client.ts`, `api/internal/openapi/`

- [ ] **Step 1: Add fields to the `Festival` schema**

In the `Festival` schema (near `decisions_released_at`), add:

```yaml
        review_opened_at:
          type: string
          format: date-time
          nullable: true
        review_closed_at:
          type: string
          format: date-time
          nullable: true
        review_status:
          type: string
          enum: [not_started, open, closed]
```

- [ ] **Step 2: Add the two endpoints**

Add paths (model them on an existing owner-only POST that returns a `Festival`, e.g. the publish/status route):

```yaml
  /festivals/{festivalID}/review/open:
    post:
      summary: Open the reviewer scoring round (owner only)
      security:
        - bearerAuth: []
      parameters:
        - { name: festivalID, in: path, required: true, schema: { type: string, format: uuid } }
      responses:
        '200': { description: Round opened, content: { application/json: { schema: { $ref: '#/components/schemas/Festival' } } } }
        '403': { description: Not the owner }
        '409': { description: Round already closed }
  /festivals/{festivalID}/review/close:
    post:
      summary: Close the reviewer scoring round (owner only)
      security:
        - bearerAuth: []
      parameters:
        - { name: festivalID, in: path, required: true, schema: { type: string, format: uuid } }
      responses:
        '200': { description: Round closed, content: { application/json: { schema: { $ref: '#/components/schemas/Festival' } } } }
        '403': { description: Not the owner }
        '409': { description: Round is not open }
```

Match the exact indentation/style of the surrounding paths in the file.

- [ ] **Step 3: Regen + verify**

Run: `task openapi:gen`
Run: `grep -n "review/open\|review_status" openapi/generated/client.ts`
Expected: both present.

- [ ] **Step 4: Commit**

```bash
git add openapi/openapi.yaml openapi/generated/ api/internal/openapi/
git commit -m "feat(openapi): review round endpoints + status fields"
```

---

### Task 6: Web — organiser controls, kanban lock, reviewer banner

**Files:**
- Modify: `web/src/app/organiser/festivals/[id]/applications/page.tsx`

The page already loads `festivalQuery`. Use its `review_status` to (a) show Open/Close controls + a lock banner for the organiser, (b) disable drag and Decision buttons while open, and (c) pass real `roundOpen` to `ReviewerQueue`.

- [ ] **Step 1: Derive round state**

In `KanbanView`, after `isReleased` is computed (~line 276), add:

```tsx
  const reviewStatus = (festivalData as { review_status?: string } | undefined)?.review_status ?? 'not_started'
  const roundOpen = reviewStatus === 'open'
```

Extend the `festivalData` cast type to include `review_status` (the cast is at ~line 275):

```tsx
  const festivalData = festivalQuery.data as { decisions_released_at?: string | null; review_status?: string } | undefined
```

- [ ] **Step 2: Add open/close mutations**

Alongside the other mutations in `KanbanView`, add:

```tsx
  const openRoundMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.POST('/festivals/{festivalID}/review/open', {
        params: { path: { festivalID: festivalId } },
      })
      if (res.error) throw new Error('Open failed')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['festival', festivalId] }),
  })

  const closeRoundMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.POST('/festivals/{festivalID}/review/close', {
        params: { path: { festivalID: festivalId } },
      })
      if (res.error) throw new Error('Close failed')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['festival', festivalId] }),
  })
```

- [ ] **Step 3: Pass real round state to the reviewer queue**

In the reviewer branch added in Phase 2 Task 4, change `roundOpen={true}` to `roundOpen={roundOpen}`.

- [ ] **Step 4: Organiser banner + controls**

In the organiser layout, just below the `<h1>Applications</h1>` header block (before the kanban grid, ~line 389), add:

```tsx
      {!isReviewer && !isReleased && (
        <div className="mb-6">
          {reviewStatus === 'not_started' && (
            <div className="flex items-center justify-between bg-warm border border-light rounded-lg px-5 py-3">
              <span className="font-sans text-sm text-mid">Optional: run a reviewer scoring round before making decisions.</span>
              <button onClick={() => openRoundMutation.mutate()} disabled={openRoundMutation.isPending}
                className="font-sans text-sm font-bold bg-ink text-offwhite px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50">
                Open review round
              </button>
            </div>
          )}
          {roundOpen && (
            <div className="flex items-center justify-between bg-ink text-offwhite rounded-lg px-5 py-3">
              <span className="font-sans text-sm">⏳ Review round <span className="text-amber font-bold">open</span> — decisions are locked until you close it.</span>
              <button onClick={() => closeRoundMutation.mutate()} disabled={closeRoundMutation.isPending}
                className="font-sans text-sm font-bold bg-amber text-ink px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50">
                Close round
              </button>
            </div>
          )}
          {reviewStatus === 'closed' && (
            <div className="bg-warm border border-light rounded-lg px-5 py-2">
              <span className="font-mono text-xs text-mid uppercase tracking-widest">Review round closed · scores final</span>
            </div>
          )}
        </div>
      )}
```

- [ ] **Step 5: Lock drag + Decision buttons while open**

The page computes `isDraggable={!isReleased && !isReviewer}` on each `ApplicationCard`. Change it to also require the round not be open:

```tsx
                    isDraggable={!isReleased && !isReviewer && !roundOpen}
```

And short-circuit `handleDragEnd` while open — at its top (it already returns early on `isReleased`):

```tsx
    if (isReleased || roundOpen) return
```

Finally, hide the Decision buttons in the slide-over while open by passing `isReleased || roundOpen` is wrong (that changes copy); instead gate the slide-over's Decision section on round state. Simplest: pass a new prop. In the organiser `<ApplicationSlideOver>` usage, the Decision section is gated `!isReviewer && !isReleased`. To also lock during an open round, treat an open round like released for the *decision section only*. Add a prop `decisionsLocked={roundOpen}` to `ApplicationSlideOver` and change its Decision-selector guard from `!isReviewer && !isReleased` to `!isReviewer && !isReleased && !decisionsLocked`. Provide a default `decisionsLocked = false` so the reviewer usage is unaffected.

- [ ] **Step 6: Typecheck**

Run: `npx tsc -p web --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add web/src/app/organiser/festivals/\[id\]/applications/page.tsx web/src/components/ApplicationSlideOver.tsx
git commit -m "feat(web): review round controls + kanban lock while open"
```

---

### Task 7: Browser spec — organiser round flow

**Files:**
- Create: `e2e/browser/review-round.spec.ts`

- [ ] **Step 1: Write the spec**

Create `e2e/browser/review-round.spec.ts`:

```ts
import { test, expect, Browser } from '@playwright/test'
import {
  createArtist, createOrganiser, createProfile,
  createFestival, setFestivalStatus, upsertForm, submitApplication,
} from '../fixtures/helpers'

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

test.describe('review round', () => {
  const suffix = `review-round-${Date.now()}`
  const baseURL = process.env.BASE_URL ?? 'http://localhost:3000'

  test('organiser opens round → decisions locked → closes → unlocked', async ({ browser }) => {
    const org = await createOrganiser(suffix)
    const { festivalId } = await createFestival(org.token, { name: `RR ${suffix}`, slug: `rr-${suffix}` })
    await upsertForm(org.token, festivalId)
    await setFestivalStatus(org.token, festivalId, 'open')
    const applicant = await createArtist(`${suffix}-art`)
    await createProfile(applicant.token, { displayName: `RR Artist ${suffix}` })
    await submitApplication(applicant.token, festivalId)

    const { ctx, page } = await loginAs(browser, org.email, org.password, baseURL)
    try {
      await page.goto(`/organiser/festivals/${festivalId}/applications`)
      await expect(page.getByRole('button', { name: 'Open review round' })).toBeVisible({ timeout: 10_000 })

      await page.getByRole('button', { name: 'Open review round' }).click()
      await expect(page.getByText(/Review round/)).toContainText('open')

      // While open, the decision drag handles are gone.
      await expect(page.getByLabel('Drag to reorder')).toHaveCount(0)

      await page.getByRole('button', { name: 'Close round' }).click()
      await expect(page.getByText('Review round closed · scores final')).toBeVisible()
    } finally {
      await ctx.close()
    }
  })
})
```

- [ ] **Step 2: Run it**

Run: `npx playwright test e2e/browser/review-round.spec.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/browser/review-round.spec.ts
git commit -m "test: organiser review-round open/close browser flow"
```

---

### Task 8: Full verification + spec update

**Files:**
- Modify: `api/internal/festival/festival.spec.md`

- [ ] **Step 1: Full e2e + lint**

Run: `task e2e`
Run: `task lint`
Expected: all PASS, clean.

- [ ] **Step 2: Update the spec**

In `api/internal/festival/festival.spec.md`:
- `## Key Decisions`: add
  `- **Review round (open/close)**: a sequential pre-kanban gate driven by festivals.review_opened_at / review_closed_at. While open, reviewers may score and organiser decisions are locked (409); closing (force-close allowed) finalises averages and unlocks. No reopen in v1.`
- `## Invariants`: add
  `- While reviewRoundStatus(fest) == open: ScoreApplicationHandler rejects owner-staging endpoints (PATCH staged_decision/shortlist, accept/decline/waitlist, reorder, release) with 409; reviewers may only score while open. not_started imposes no gate.`
- `## AI Context`: add `review_round.go owns reviewRoundStatus() + open/close handlers; the gate is duplicated across the decision handlers — grep reviewRoundStatus when adding a new decision endpoint.`
- `## Changelog`: append
  `2026-06-04 — Epic 1 Phase 3: review round lifecycle (open/close) as a sequential decision gate; reviewers notified on open.`

- [ ] **Step 3: Commit**

```bash
git add api/internal/festival/festival.spec.md
git commit -m "docs(spec): festival — review round lifecycle + gate invariant"
```

---

## Self-review notes (author)

- **Spec coverage:** timestamps + queries (T1), response status (T2), helper + gating tests (T3), handlers/email/gates/routes (T4), OpenAPI (T5), web controls + lock (T6), browser flow (T7), spec (T8). ✅
- **Gate is duplicated by design** across decision handlers — T8 records a grep-canary in AI Context so a future decision endpoint doesn't miss it.
- **Force-close:** `CloseReviewRound` has no "all reviewers done" precondition (T1 Step 3) — matches the user's explicit requirement.
- **No-reopen:** `OpenReviewRound` is guarded `review_closed_at IS NULL` (T1) → reopening returns 409 (T4 handler). Documented as v1 limitation.
- **Type caveats flagged:** `pgtype.UUID` for `festID` and the `EmailSender.Send` signature must be verified against generated/existing code (T4 Steps 1, 3, 8) — the only places a fresh worker could guess wrong.
- **Cross-phase dep:** `roundOpen` prop on `ReviewerQueue` (Phase 2 placeholder) is wired to real state here (T6 Step 3).
