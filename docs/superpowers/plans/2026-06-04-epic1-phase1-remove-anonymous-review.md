# Epic 1 · Phase 1 — Remove Anonymous Review — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Completely remove the `anonymous_review` feature so reviewers always see full artist identity, clearing the way for Epic 1 Phases 2–3 and Epic 2.

**Architecture:** Drop the `application_forms.anonymous_review` column, delete the `shouldAnonymise` identity-stripping logic and the `identity_hidden` response field across DB → sqlc → Go handlers → OpenAPI → generated client → web UI → e2e tests. This is a removal: one keystone behavioural test proves anonymisation is gone, the rest is mechanical deletion verified by build + the existing suite.

**Tech Stack:** Go (chi, pgx, sqlc), golang-migrate, OpenAPI + openapi-typescript, Next.js + React Query, Vitest (API gate) + Playwright (browser), Taskfile.

**Preconditions:**
- On branch `epics/reviewer-scoring-and-card-visuals` (already created).
- Docker stack runs the **main repo** via bind mount. If you execute this in a git worktree, every API/web edit must also be applied to `/Users/adampowis/workspace/murals/<path>` so the container picks it up (see `.claude/rules/e2e-debugging.md`). If you execute directly in the main checkout, no dual-edit is needed.
- Stack up: `task up`. Confirm health: `curl -sf http://localhost:8080/healthz`.

**Design reference:** `docs/superpowers/specs/2026-06-04-reviewer-scoring-round-design.md` (Phase 1 section).

---

### Task 1: Keystone behavioural test — reviewer always sees identity

This test enables the legacy `anonymous_review` flag and asserts the reviewer **still** sees the real `display_name` before scoring. It FAILS today (anonymisation blanks the name) and PASSES once the stripping is removed. It stays as a permanent regression guard ("even a legacy flag never hides identity").

**Files:**
- Modify: `e2e/api/reviewer-panellist.test.ts` (add one `it` block inside the existing `describe`)

- [ ] **Step 1: Add the failing test**

Add this block immediately after the existing `it('owner invites a reviewer (existing user) → 201', …)` block (around line 58), so the reviewer is already invited:

```ts
  // Phase 1 keystone: anonymisation is gone. Even if a legacy anonymous_review
  // flag is set, reviewers see the real identity before scoring.
  it('reviewer sees real artist identity before scoring (no anonymisation)', async () => {
    // Attempt to turn on the legacy flag — after Phase 1 this field is ignored.
    await fetch(`${API}/festivals/${festivalId}/form`, {
      method: 'PATCH', headers: json(orgToken),
      body: JSON.stringify({ anonymous_review: true }),
    })

    const list = await fetch(`${API}/festivals/${festivalId}/applications`, { headers: auth(reviewerToken) })
    expect(list.status).toBe(200)
    const apps = await list.json()
    const app = apps.find((a: { id: string }) => a.id === appId)
    expect(app).toBeDefined()
    // Real name visible pre-score (this reviewer has not scored appId yet at this point).
    expect(app.artist?.display_name).toBe(`Applicant ${SUFFIX}`)
    // The identity_hidden field is removed entirely.
    expect(app.identity_hidden).toBeUndefined()
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run e2e/api/reviewer-panellist.test.ts -t "real artist identity"`
Expected: FAIL — `display_name` is `""` (anonymised) and/or `identity_hidden` is `true`.

- [ ] **Step 3: Commit the failing test**

```bash
git add e2e/api/reviewer-panellist.test.ts
git commit -m "test: reviewer always sees identity (failing pre-removal)"
```

---

### Task 2: Drop the `anonymous_review` column (migration + sqlc query)

**Files:**
- Create: `db/migrations/000023_drop_anonymous_review.up.sql`
- Create: `db/migrations/000023_drop_anonymous_review.down.sql`
- Modify: `db/queries/application_forms.sql` (delete the `PatchFormAnonymousReview` query)

- [ ] **Step 1: Write the up migration**

`db/migrations/000023_drop_anonymous_review.up.sql`:

```sql
ALTER TABLE application_forms
  DROP COLUMN anonymous_review;
```

- [ ] **Step 2: Write the down migration**

`db/migrations/000023_drop_anonymous_review.down.sql` (mirrors `000012` up):

```sql
ALTER TABLE application_forms
  ADD COLUMN anonymous_review bool NOT NULL DEFAULT false;
```

- [ ] **Step 3: Delete the now-orphaned query**

In `db/queries/application_forms.sql`, delete this entire block:

```sql
-- name: PatchFormAnonymousReview :one
UPDATE application_forms
SET anonymous_review = $2, updated_at = now()
WHERE festival_id = $1
RETURNING *;
```

Leave `UpsertApplicationForm`, `GetApplicationFormByFestivalID`, and `PatchFormCriteria` untouched.

- [ ] **Step 4: Apply the migration**

Run: `task db:migrate`
Expected: migration `000023` applies cleanly (no error). If it reports a dirty/partial state, see `.claude/rules/e2e-debugging.md` → "dirty migration state".

- [ ] **Step 5: Regenerate sqlc**

Run: `task db:generate`
Expected: success. `api/internal/sqlcdb/application_forms.sql.go` no longer contains `PatchFormAnonymousReview`, and the `ApplicationForm` struct in `models.go` no longer has an `AnonymousReview` field.

- [ ] **Step 6: Verify the field is gone from generated code**

Run: `grep -rn "AnonymousReview" api/internal/sqlcdb/`
Expected: no matches.

- [ ] **Step 7: Commit**

```bash
git add db/migrations/000023_drop_anonymous_review.up.sql db/migrations/000023_drop_anonymous_review.down.sql db/queries/application_forms.sql api/internal/sqlcdb/
git commit -m "feat(db): drop application_forms.anonymous_review column"
```

---

### Task 3: Remove anonymisation from the application list handler

The Go code will not compile until the generated `AnonymousReview` references are gone. Do Tasks 3–4 together before building.

**Files:**
- Modify: `api/internal/festival/review.go` (delete the stripping block; remove now-unused `isReviewer`)
- Modify: `api/internal/festival/application.go` (delete `shouldAnonymise`; remove `IdentityHidden` field)

- [ ] **Step 1: Delete the anonymise stripping block in `review.go`**

Remove this block (currently ~lines 259–268), including its comment:

```go
			// Anonymous review stripping (uses a.MyScore which is now set).
			if shouldAnonymise(isReviewer, form.AnonymousReview, a.MyScore) {
				a.Artist = &artistSummary{
					DisplayName:   "",
					AvatarS3Key:   nil,
					MediumTags:    a.Artist.MediumTags,
					LocationLabel: nil,
				}
				a.IdentityHidden = true
			}
```

- [ ] **Step 2: Remove the now-unused `isReviewer` local**

In `review.go`, find `isReviewer := role == roleReviewer` (~line 182). After Step 1 it is unused. If no other reference remains in the function, delete that line. (The `role == roleReviewer` branch that selects the excluding-reviewer query stays — that is COI, not anonymity.)

Verify nothing else uses it: `grep -n "isReviewer" api/internal/festival/review.go` — expect no matches after deletion.

- [ ] **Step 3: Delete `shouldAnonymise` in `application.go`**

Remove this function (currently ~lines 171–176) and its doc comment:

```go
// shouldAnonymise returns true when the caller is a reviewer,
// the form has anonymous_review enabled, and they haven't scored this application yet.
// Owner view is never anonymised; reveal happens automatically once my_score is set.
func shouldAnonymise(isReviewer, anonymousReview bool, myScore *int32) bool {
	return isReviewer && anonymousReview && myScore == nil
}
```

- [ ] **Step 4: Remove the `IdentityHidden` field from `applicationResponse`**

In `application.go`, delete this line from the `applicationResponse` struct (~line 66):

```go
	IdentityHidden  bool             `json:"identity_hidden"`
```

Verify no remaining references: `grep -rn "IdentityHidden" api/internal/festival/` — expect no matches.

- [ ] **Step 5: (no commit yet — build happens after Task 4)**

---

### Task 4: Remove `anonymous_review` from the form handlers

**Files:**
- Modify: `api/internal/festival/form.go` (response field, mapper, PATCH branch, GetForm comment)

- [ ] **Step 1: Remove the field from `formResponse`**

In `form.go`, delete this line from the `formResponse` struct (~line 117):

```go
	AnonymousReview bool            `json:"anonymous_review"`
```

- [ ] **Step 2: Remove the assignment in `toFormResponse`**

Delete this line (~line 133):

```go
		AnonymousReview: f.AnonymousReview,
```

- [ ] **Step 3: Remove the PATCH request field and its branch**

In `PatchFormHandler`, change the request struct (~lines 305–308) from:

```go
		var req struct {
			AnonymousReview *bool             `json:"anonymous_review"`
			ReviewCriteria  *[]criterionInput `json:"review_criteria"`
		}
```

to:

```go
		var req struct {
			ReviewCriteria *[]criterionInput `json:"review_criteria"`
		}
```

Then delete the entire `if req.AnonymousReview != nil { … }` block (~lines 325–338), including its call to `q.PatchFormAnonymousReview`.

- [ ] **Step 4: Fix the stale comment in `GetFormHandler`**

Change the comment (~lines 259–260) from:

```go
		// Owners and invited reviewers see panel-internal fields (review_criteria,
		// anonymous_review). The public/artists get the stripped response.
```

to:

```go
		// Owners and invited reviewers see panel-internal fields (review_criteria).
		// The public/artists get the stripped response.
```

Also update the `PatchFormHandler` doc comment (~line 274) from `Accepts any subset of { anonymous_review, review_criteria }` to `Accepts { review_criteria }`.

- [ ] **Step 5: Build the API**

Run: `go -C api build ./...`
Expected: compiles with no errors. If you see `undefined: AnonymousReview` or `declared and not used: isReviewer`, you missed a reference in Task 3/4 — fix it.

- [ ] **Step 6: Run the API unit tests**

Run: `task api:test`
Expected: PASS. (If a Go unit test references `anonymous_review`/`shouldAnonymise`, update it to the new behaviour.)

- [ ] **Step 7: Commit**

```bash
git add api/internal/festival/review.go api/internal/festival/application.go api/internal/festival/form.go
git commit -m "feat(api): remove anonymous-review stripping and form field"
```

---

### Task 5: Remove `anonymous_review` / `identity_hidden` from OpenAPI + regen client

**Files:**
- Modify: `openapi/openapi.yaml` (3 spots)
- Regenerated: `openapi/generated/client.ts`, `api/internal/openapi/` (via `task openapi:gen`)

- [ ] **Step 1: Remove the form-schema property**

In `openapi/openapi.yaml`, in the application-form response schema (~lines 521–523), delete:

```yaml
        anonymous_review:
          type: boolean
          description: When true, reviewer-scoped responses strip artist identity until the reviewer has scored.
```

- [ ] **Step 2: Remove the `identity_hidden` property**

In the `Application` schema (~lines 598–600), delete:

```yaml
        identity_hidden:
          type: boolean
          description: True when anonymous_review is on and this reviewer has not yet scored. Always false for owners.
```

- [ ] **Step 3: Remove it from the PATCH form requestBody**

In the `PATCH /festivals/{festivalID}/form` requestBody schema (~line 2333), delete:

```yaml
                anonymous_review:
                  type: boolean
```

Leave the `review_criteria` property intact.

- [ ] **Step 4: Regenerate the client + server types**

Run: `task openapi:gen`
Expected: success. Then verify the field is gone:
Run: `grep -rn "anonymous_review\|identity_hidden" openapi/generated/ api/internal/openapi/`
Expected: no matches.

- [ ] **Step 5: Commit**

```bash
git add openapi/openapi.yaml openapi/generated/ api/internal/openapi/
git commit -m "feat(openapi): drop anonymous_review and identity_hidden"
```

---

### Task 6: Remove the Anonymous-review toggle from the organiser form builder

**Files:**
- Modify: `web/src/app/organiser/festivals/[id]/page.tsx` (delete `AnonymousReviewSection` + its render)

- [ ] **Step 1: Delete the component**

In `page.tsx`, delete the entire `AnonymousReviewSection` function (currently ~lines 16–67, from `function AnonymousReviewSection({ festivalId }: { festivalId: string }) {` through its closing `}`).

- [ ] **Step 2: Delete its render and the comment**

Remove these lines (~lines 405–406):

```tsx
      {/* Anonymous review */}
      <AnonymousReviewSection festivalId={festivalId} />
```

- [ ] **Step 3: Verify no dangling references**

Run: `grep -rn "anonymous\|Anonymous" web/src/app/organiser/festivals/`
Expected: no matches.

- [ ] **Step 4: Typecheck**

Run: `npx tsc -p web --noEmit`
Expected: no errors. (`useQueryClient` may now be unused in this file if it was only used by the deleted section — if tsc flags it, remove it from the import on line 4.)

- [ ] **Step 5: Commit**

```bash
git add web/src/app/organiser/festivals/\[id\]/page.tsx
git commit -m "feat(web): remove anonymous-review toggle from form builder"
```

---

### Task 7: Remove anon branches from the card and slide-over

**Files:**
- Modify: `web/src/components/ApplicationCard.tsx`
- Modify: `web/src/components/ApplicationSlideOver.tsx`
- Modify: `web/src/__tests__/components/ApplicationCard.test.tsx`
- Modify: `web/src/__tests__/components/ApplicationSlideOver.test.tsx`

- [ ] **Step 1: Simplify `ApplicationCard.tsx`**

Replace the anon lines (~43–44):

```tsx
  const isAnonymous = application.identity_hidden === true
  const name = isAnonymous ? 'Anonymous artist' : (artist?.display_name ?? 'Unknown Artist')
```

with:

```tsx
  const name = artist?.display_name ?? 'Unknown Artist'
```

Then replace the avatar content (~line 82):

```tsx
        {isAnonymous ? '?' : initials(name)}
```

with:

```tsx
        {initials(name)}
```

- [ ] **Step 2: Simplify `ApplicationSlideOver.tsx`**

Apply the identical two edits: replace `isAnonymous`/`name` (~57–58) with `const name = artist?.display_name ?? 'Unknown Artist'`, and `{isAnonymous ? '?' : initials(name)}` (~85) with `{initials(name)}`.

- [ ] **Step 3: Update the component tests**

Run: `grep -rn "identity_hidden\|Anonymous\|isAnonymous" web/src/__tests__/`
For every match in `ApplicationCard.test.tsx` and `ApplicationSlideOver.test.tsx`, delete the test case that asserts anonymised rendering (any `it`/`test` block that sets `identity_hidden: true` and expects `'Anonymous artist'` or `'?'`). Do not weaken other assertions.

- [ ] **Step 4: Run the web component tests**

Run: `task web:test`
Expected: PASS, with no remaining references to `identity_hidden`.

- [ ] **Step 5: Typecheck**

Run: `npx tsc -p web --noEmit`
Expected: no errors (the `identity_hidden` property no longer exists on the generated `Application` type, so any leftover usage fails here).

- [ ] **Step 6: Commit**

```bash
git add web/src/components/ApplicationCard.tsx web/src/components/ApplicationSlideOver.tsx web/src/__tests__/components/
git commit -m "feat(web): drop anonymous rendering from card and slide-over"
```

---

### Task 8: Delete the anonymous-review e2e suites

**Files:**
- Delete: `e2e/api/anonymous-review.test.ts`
- Delete: `e2e/browser/anonymous-review.spec.ts`

- [ ] **Step 1: Delete both files**

```bash
git rm e2e/api/anonymous-review.test.ts e2e/browser/anonymous-review.spec.ts
```

- [ ] **Step 2: Check for stragglers**

Run: `grep -rn "anonymous\|identity_hidden" e2e/`
Expected: no matches. If `e2e/browser/reviewer-board.spec.ts` references anonymity, update only the offending assertion to expect visible identity — do not delete that spec (it is about the reviewer board, relevant to Phase 2).

- [ ] **Step 3: Commit**

```bash
git commit -m "test: remove anonymous-review e2e suites"
```

---

### Task 9: Full verification

- [ ] **Step 1: Confirm the keystone test now passes**

Run: `npx vitest run e2e/api/reviewer-panellist.test.ts -t "real artist identity"`
Expected: PASS (`display_name` is the real name; `identity_hidden` is `undefined`).

- [ ] **Step 2: Run the full API gate**

Run: `task e2e:api`
Expected: all PASS. No file references a removed symbol.

- [ ] **Step 3: Run the browser suite**

Run: `task e2e` (API gate then Playwright). Expected: all PASS. If `reviewer-board.spec.ts` fails on an identity assertion, fix that assertion (identity is now always visible) and re-run.

- [ ] **Step 4: Lint**

Run: `task lint`
Expected: clean (catches any unused import like `useQueryClient` from Task 6).

---

### Task 10: Update the festival spec

**Files:**
- Modify: `api/internal/festival/festival.spec.md`

- [ ] **Step 1: Remove the anonymity Key Decision**

Delete the "Reviewer anonymity" bullet under `## Key Decisions` (the line beginning `**Reviewer anonymity**: panellist usernames…`).

- [ ] **Step 2: Scrub Invariants / AI Context**

Search the spec for "anonym" and remove or rewrite any sentence that describes identity masking. In `## AI Context`, change the `review.go, score.go` line to drop "anonymous review" (leave "reviewer scoring and rubric logic").

- [ ] **Step 3: Add a changelog entry**

Under `## Changelog`, append:

```
2026-06-04 — Epic 1 Phase 1: removed anonymous review entirely (column, stripping, identity_hidden, toggle, e2e). Reviewers always see full identity.
```

- [ ] **Step 4: Commit**

```bash
git add api/internal/festival/festival.spec.md
git commit -m "docs(spec): festival — anonymous review removed"
```

---

## Self-review notes (author)

- **Spec coverage:** every Phase-1 bullet in the design doc maps to a task — DB drop (T2), API stripping + IdentityHidden (T3), form field (T4), OpenAPI + client (T5), web toggle (T6), card/slide-over branches (T7), e2e deletion (T8), spec update (T10). ✅
- **Compile ordering:** Tasks 3–4 must land before any Go build; Step 5 of Task 4 is the first build. ✅
- **Naming consistency:** `anonymous_review` (DB/JSON/OpenAPI), `AnonymousReview` (Go struct field — removed everywhere), `identity_hidden`/`IdentityHidden` (response — removed), `shouldAnonymise` (removed). ✅
- **Out of scope (Phase 2/3):** reviewer response trimming, the reviewer queue, and the review-round lifecycle are NOT in this plan. COI exclusion (`ListApplicationsByFormWithArtistExcludingReviewer`) is intentionally kept.
