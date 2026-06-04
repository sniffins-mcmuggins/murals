# Epic — Reviewer Scoring Round (optional pre-kanban stage)

**Date:** 2026-06-04
**Status:** Design approved, ready for implementation planning
**Related:** `2026-06-04-kanban-card-visuals-design.md` (Epic 2 — built on top of Phase 1 here)

## Summary

Turn reviewer scoring into an explicit, **optional pre-kanban stage** that an organiser
runs *before* making decisions. Reviewers get a dedicated scoring queue — never the kanban.
While a review round is open, the organiser's decision-making is locked; closing the round
finalises the averages and unlocks the kanban.

This also retires **anonymous review** entirely, which the product no longer wants: for
visual art you cannot judge an artist without seeing their work, and the work identifies
them anyway. Reviewers will always see full identity and the artist's full profile.

## Why

Two problems with today's implementation:

1. **Reviewers see the kanban.** `web/.../applications/page.tsx` renders the *same* 5-column
   board (Undecided · Shortlisted · Accept · Waitlist · Decline) for reviewers, merely
   disabling drag. The shared `ListApplicationsHandler` (`api/internal/festival/review.go`)
   serves reviewers the full `applicationResponse`, which includes `staged_decision`,
   `shortlisted`, and `review_flag`. **A reviewer can infer the organiser's provisional
   decisions.** That is a privacy leak and the opposite of an unbiased "pre-kanban" stage.

2. **Scoring has no lifecycle.** There is no notion of a review round opening or closing.
   Scores trickle in whenever; there is no "scores are final, now decide" moment, and nothing
   stops an organiser anchoring on half-collected scores.

## Current state (what exists)

- **Reviewers**: invite / list / remove (`reviewers.go`), COI guard so a reviewer can't score
  their own application (`score.go`).
- **Scoring**: per-criterion rubric with configurable min/max plus a legacy "overall" 1–5
  (`score.go`); averages computed in `review.go` (`avg_score`, `score_count`, `my_score`,
  per-criterion `criterion_scores`).
- **Reviewer's festival list**: `GET /me/reviewing` (`me_reviewing.go`) already returns the
  festivals a reviewer is assigned to.
- **Anonymous review** (to be removed): `application_forms.anonymous_review` column
  (migration `000012`); `shouldAnonymise()` + the stripping block in `review.go`;
  `IdentityHidden` field on the response; "score blind → reveal on score" mechanic;
  `e2e/browser/anonymous-review.spec.ts`.
- **Decision flow**: staged decisions + bulk release (E22). `staged_decision` on applications,
  `decisions_released_at` on festivals.

## Scope — three phases

### Phase 1 — Rip out anonymous review

Remove the feature completely; reviewers always see full identity.

- **DB**: migration to drop `application_forms.anonymous_review` (with a `.down.sql` that
  re-adds it defaulting `false`).
- **API**:
  - Delete `shouldAnonymise()` and the anonymise/stripping block in `review.go`.
  - Remove `IdentityHidden` from the application response struct (`application.go`) and any
    `identity_hidden` JSON.
  - Remove `AnonymousReview` from the form response + PATCH body (`form.go`).
  - Regenerate sqlc; grep-verify scan counts per `sqlc-and-schema.md`.
- **Web**: remove the "Anonymous review" toggle from the form builder; drop the
  `identity_hidden`/`Anonymous artist`/`?`-avatar branches in `ApplicationCard.tsx` and
  `ApplicationSlideOver.tsx`.
- **Tests**: delete `anonymous-review.spec.ts`; remove anon assertions from API tests.
- **Spec**: update `festival.spec.md` — drop "Reviewer anonymity" Key Decision and the
  anonymity language in Invariants/AI Context.

### Phase 2 — Reviewer-only scoring queue (seal the leak)

Reviewers get a flat to-do list, never the kanban.

- **API — trim the reviewer response.** `ListApplicationsHandler` must serialise a dedicated
  `reviewerApplicationResponse` when `role == roleReviewer`: artist summary (full identity),
  application `answers`, the rubric `criteria` context, and the caller's own `my_score` /
  `criterion_scores`. It must **omit** `staged_decision`, `shortlisted`, `review_flag`,
  `rank`, and `notes`. This mirrors how `/me/applications` is already trimmed for artists —
  do **not** unify the two response shapes.
  - Decision: keep the single endpoint but branch the response by role (least churn). The
    invariant is the *shape*, not the route.
- **Web — `ReviewerQueue` component.** When `isReviewer`, `applications/page.tsx` renders
  `<ReviewerQueue>` instead of the `DndContext`/kanban entirely. Layout (approved mockup):
  - Round-status banner, festival name, **progress bar** ("scored N of M").
  - Two groups: **To score** (unscored, top) and **Scored** (with each row's ★ rating + edit).
  - Row = avatar · name · medium tags · `Score →` (or rating + edit).
  - `Score →` opens the **existing** `ApplicationSlideOver` in reviewer mode: answers +
    "View full profile ↗" (Epic 2) + rubric stars; **no** Decision buttons, **no** notes.
- The organiser kanban keeps the `isReviewer` prop only where it still distinguishes the
  reviewer's slide-over; the column-hiding hacks in the page go away.

### Phase 3 — Review round lifecycle (the sequential gate)

State machine, festival-level:

```
not started  → (organiser opens) → open → (organiser closes, anytime) → closed
opened_at=∅                         opened_at set                       closed_at set
closed_at=∅                         closed_at=∅
```

- **DB**: add `review_opened_at timestamptz` and `review_closed_at timestamptz` to
  `festivals` (mirror the `decisions_released_at` pattern). Status is derived, not stored.
- **API — new owner endpoints:**
  - `POST /festivals/{festivalID}/review/open` — owner only; sets `review_opened_at`;
    rejects if already closed. On success, fire a detached goroutine to email all reviewers
    "scoring is open" (per `background-work.md`: bounded ctx, logged errors, no request ctx).
  - `POST /festivals/{festivalID}/review/close` — owner only; sets `review_closed_at`.
    **Force-close is allowed** — the organiser ends the round whenever satisfied, even with
    reviewers still outstanding. No "all reviewers done" precondition.
  - Expose `review_opened_at` / `review_closed_at` (or a derived `review_status`) on the
    owner festival GET so the UI can render state.
- **API — gating:**
  - **Reviewers can only score while the round is `open`.** `ScoreApplicationHandler` returns
    `409 Conflict` if the round is not open (not started or closed). Reviewers may still GET
    their queue when closed (read-only).
  - **Organiser decisions are locked while the round is `open`.** These return `409` until the
    round is closed (or never opened): `PatchApplicationHandler` (when it sets
    `staged_decision`/`shortlisted`), `accept` / `decline` / `waitlist`, `reorder`, and
    `release-decisions`. Viewing applications and scores is always allowed.
- **Web — organiser controls + lock:**
  - Review-round banner on the applications page with **Open round** / **Close round**
    (plus a "force close — N of M reviewers done" confirmation).
  - While `open`: disable drag and the Decision buttons in the slide-over; show "Review round
    in progress — close it to make decisions." Scores stream in live (progress count visible).
  - While `closed` (or never opened): kanban behaves exactly as today.

**Optionality:** opening a round is the opt-in. A festival that never opens a round skips the
stage entirely — the kanban is available immediately and cards simply show no average. This is
"separate from invitations": you can invite reviewers and still not have opened the round, and
the round gate does not depend on how many reviewers exist.

## Data flow

```
organiser opens round ──► reviewers emailed ──► reviewers score via queue (kanban locked)
        │                                                      │
        └────────────── organiser closes round ◄──────────────┘ (force-close OK)
                              │
                  averages final ──► kanban unlocks ──► organiser stages decisions ──► release (E22)
```

## Edge cases & decisions

- **No reopen in v1.** Closing is terminal. If an organiser closes too early, rebuilding a
  reopen path is a later increment (YAGNI). Document it as a known limitation.
- **Reviewer invited mid-round**: they see the queue and can score immediately while open.
- **Reviewer removed**: their existing scores remain in the averages (no cascade) — matches
  current behaviour; out of scope to change here.
- **COI** (reviewer is the applicant) stays enforced in `score.go`.
- **Releasing decisions** still requires the round to be closed (it's a decision action, so
  the Phase-3 gate already covers it).
- **Festival status interaction**: a round can be opened while the festival is `open` or
  `live`; no new festival-status transitions are introduced.

## Testing

- **Remove**: `anonymous-review.spec.ts`; anon assertions in API tests.
- **API gate (Vitest)** — new/updated:
  - Reviewer response shape: assert `staged_decision`, `shortlisted`, `review_flag`, `notes`
    are **absent** from the reviewer's `GET applications` (the leak-seal canary).
  - Scoring blocked with `409` when round not open / closed.
  - Decision endpoints (`PATCH` staged, accept/decline/waitlist, reorder, release) blocked
    with `409` while round open; allowed once closed.
  - `review/open` notifies reviewers; `review/close` force-closes with reviewers outstanding.
- **Browser (Playwright)** — new:
  - Reviewer sees the queue (no kanban columns), scores via slide-over, progress updates.
  - Organiser opens round → kanban locked → closes → kanban unlocks and shows averages.

## Spec maintenance

Update `api/internal/festival/festival.spec.md`:
- **Key Decisions**: remove "Reviewer anonymity"; add "Review round (open/close) is a
  sequential pre-kanban gate; reviewers get a trimmed response and a dedicated queue".
- **Invariants**: add the reviewer-response-shape invariant (no decision fields) and the
  round-gate invariants (scoring only while open; decisions only while not-open/closed).
- **AI Context**: note the new `review.go` open/close handlers and the gate locations.
```
