# Application Decision Model Redesign

**Date:** 2026-06-12
**Status:** Approved (design) — pending implementation plan
**Area:** `db/`, `api/internal/festival/`, `web/src/app/organiser/.../applications/`, `openapi/`, `demos/seed/`, `e2e/`

## Problem

An application's outcome is currently spread across four places that must stay
mutually consistent, with no single source of truth:

| Place | Encodes |
|---|---|
| `applications.status` (`submitted/accepted/declined/waitlisted`) | the *final* decision |
| `applications.staged_decision` (`accept/waitlist/decline/null`) | the *provisional* decision |
| `festivals.decisions_released_at` | whether decisions are *published* to artists |
| `festival_artists` (row exists) | derived: "is an accepted artist" |

Two distinct facts are tangled together: **what the decision is**
(undecided/accept/waitlist/decline) and **whether the artist can see it yet**
(provisional vs released). The decision is stored in *two* columns depending on
visibility, and there are **two write paths** with different invariants:

- **Direct** (`POST .../accept|decline|waitlist`): writes a terminal `status`
  immediately, never sets `decisions_released_at`.
- **Staged** (`PATCH staged_decision` → `POST release-decisions`): writes
  `staged_decision`, then on release flips `status` and sets
  `decisions_released_at`.

So `status='accepted'` is **ambiguous** — it means either "released accept" or
"directly accepted, not published." The organiser applications board
(`getColumn`) resolves the column by branching on
`festivals.decisions_released_at`: when not released it reads `staged_decision`,
when released it reads `status`. A directly-accepted application (terminal
`status`, no `staged_decision`, festival not released) is therefore mis-filed
into **Undecided**. The demo seed reproduced exactly this shape (it wrote
terminal `status` + `festival_artists` + spot assignments without setting
`decisions_released_at`), which is how the bug surfaced: three spot-assigned
artists showing as assigned on the festival page but absent from the Accept
column on the board.

No amount of seed-patching removes the ambiguity. The fix is to give each fact a
single source of truth.

## Goals

- One column means one thing. No two columns can represent the same fact and
  drift into conflict.
- The board can determine an application's column **unconditionally**, without
  consulting festival-level release state.
- Support artists added to a festival **without** an application (invites),
  which the product will need.
- Preserve existing product invariants: "no artist hears an outcome before
  release," "everyone is notified together," reviewer round gating, spot
  eligibility (provisional accepts can be placed pre-release), auto-clear of
  spots when eligibility is revoked.

## Non-goals / Out of scope

- Multi-round / wave release (issue #159). The model is designed not to *block*
  it (per-application `released_at` can express waves), but the release guard and
  UI keep today's single-wave behaviour.
- The artist-withdrawal feature. `applications.status` is dropped; if withdrawal
  is built later it becomes a `withdrawn_at timestamptz`.
- The invite **endpoint/UI**. The schema (`festival_artists.source`) is made
  ready for it; the handler ships in its own later PR.

## Decisions (locked with the user)

1. **Lineup row on release.** Releasing an `accept` writes a `festival_artists`
   row (`source='application'`); invites write one (`source='invite'`). The
   `festival_artists` table is the single place to read the festival lineup. The
   application's `decision` is an immutable audit of the verdict; the lineup row
   is mutable membership (a dropped-out artist loses the lineup row, the decision
   record stays).
2. **Drop the direct decision endpoints.** `accept`/`decline`/`waitlist` are
   removed (routes, handlers, OpenAPI paths, tests). Decisions flow only through
   `PATCH .../applications/{id}` (set `decision`) and `POST release-decisions`.
   One writer ⇒ the bug class is structurally gone.
3. **Schema-ready invites, defer the endpoint.** Add `festival_artists.source`
   and make lineup reads handle both sources now; build
   `POST /festivals/{id}/artists` in a later PR.
4. **Drop `applications.status` entirely.** A row existing means the application
   was submitted (there is no draft state). The `application_status` enum is
   dropped.

## Target schema

### `applications`

| Column | Type | Notes |
|---|---|---|
| `decision` | enum `application_decision` (`undecided · accept · waitlist · decline`), `NOT NULL DEFAULT 'undecided'` | **single** decision SoT — replaces both `status`-terminal-values and `staged_decision` |
| `released_at` | `timestamptz NULL` | when this decision became visible to the artist; `NULL` = provisional / organiser-only |
| ~~`status`~~ | — | **dropped** (with the `application_status` enum) |
| ~~`staged_decision`~~ | — | **dropped** (and its CHECK constraint) |

Unchanged: `id, form_id, artist_id, answers, rank, shortlisted, review_flag,
created_at, updated_at`.

### `festivals`

- **Drop `decisions_released_at`.** "Released?" is derived from
  `applications.released_at` (the board derives it from the apps it already
  fetches: `apps.some(a => a.released_at != null)`).

### `festival_artists` (the lineup)

| Column | Type | Notes |
|---|---|---|
| `source` | enum `festival_artist_source` (`application · invite`), `NOT NULL` | how the artist entered the lineup; existing rows backfill to `application` |
| ~~`status`~~ | — | **dropped** (always `'accepted'` today; membership = being in the table). Drop the `festival_artist_status` enum if unused elsewhere. |

Unchanged: `festival_id, artist_id` (PK), `created_at, updated_at`.

## Semantics

- **Stage a decision:** `PATCH .../applications/{id}` sets `decision`
  (`undecided/accept/waitlist/decline`). `released_at` stays `NULL`. Allowed only
  when the review round is not open (existing gate).
- **Release:** `POST .../applications/release-decisions`, in **one transaction**:
  1. Guard: every application with `decision = 'undecided'` blocks release (422)
     — "all submitted applications must have a decision before releasing."
  2. Set `released_at = now()` on every application in the festival where
     `decision != 'undecided' AND released_at IS NULL`. If that set is empty →
     409 ("nothing to release").
  3. For each newly-released `accept`: upsert a `festival_artists` row
     (`source='application'`). For each newly-released `decline`/`waitlist`:
     `ClearSpotAssignmentForArtist` (a downgraded artist must not keep a spot).
  4. Commit, then send notification emails (detached goroutines) — never email
     about a decision that could roll back.
- **Board column** (`getColumn`): unconditional —
  `accept→Accept`, `waitlist→Waitlist`, `decline→Decline`,
  `undecided→ (shortlisted ? Shortlisted : Undecided)`. No `isReleased` branch.
- **Released indicator / read-only board:** derived from
  `apps.some(a => a.released_at != null)`.
- **Spot eligibility** (`GetSpotEligibleArtist`, `GetUnassignedSpotEligibleArtists`):
  a `festival_artists` member **OR** a provisional accept
  (`applications.decision = 'accept' AND released_at IS NULL`). Post-release
  accepts are members (first clause); pre-release accepts match the second.
- **No early awareness:** `/me/applications` (`toMyApplicationResponse`) exposes
  the decision **only** when `released_at IS NOT NULL`; otherwise the application
  reads as pending. Reviewer response shape continues to omit decision fields.

## API surface changes

- **Removed:** `POST /festivals/{id}/applications/{id}/accept`,
  `/decline`, `/waitlist` (handlers, routes in `cmd/api/main.go`, OpenAPI paths,
  and their tests).
- **Changed:** `PATCH /festivals/{id}/applications/{id}` body field
  `staged_decision` → `decision` (values `undecided/accept/waitlist/decline`).
  Response DTO: `status`+`staged_decision` → `decision`+`released_at`.
- **Unchanged endpoints, new internals:** `release-decisions` (rewritten per
  above), the list/reorder/score endpoints (status→decision in projections).
- **OpenAPI:** regenerate the TS client and Go `api.gen.go`
  (`task openapi:gen`); update `Application`, `MyApplication` schemas.

## Query changes (sqlc)

Rewrite in `db/queries/`:

- `applications.sql`: `CreateApplication` (drop `status`),
  `ListApplicationsByFormWithArtist[...]` (`status`/`staged_decision` →
  `decision`/`released_at`), `UpdateApplicationFlags` (`staged_decision` →
  `decision`), `CountSubmittedUndecidedByFestival` (→ `decision = 'undecided'`),
  `ListStagedApplicationsByFestival` (→ `decision != 'undecided' AND released_at
  IS NULL`), and the new `ReleaseDecisionsForFestival` (set `released_at`, return
  the newly-released rows for the side-effect loop). Remove the now-unused direct
  status writer if no longer referenced after the handlers are deleted (verify —
  `UpdateApplicationStatus` is currently used by `review.go`/`waitlist.go`, which
  are being removed).
- `festivals.sql`: drop `SetFestivalDecisionsReleasedAt`; remove
  `decisions_released_at` from festival selects.
- `festival_artists.sql`: `AddFestivalArtist` takes `source`; drop `status`;
  lineup/eligibility reads updated.

Run `task db:generate` and apply the sqlc-scan grep checks
(`.claude/rules/sqlc-and-schema.md`).

## Migration & backfill

A single new migration pair (aggressive — touches enums and columns):

**Up:**
1. `CREATE TYPE application_decision AS ENUM ('undecided','accept','waitlist','decline');`
2. `CREATE TYPE festival_artist_source AS ENUM ('application','invite');`
3. `ALTER TABLE applications ADD COLUMN decision application_decision NOT NULL DEFAULT 'undecided', ADD COLUMN released_at timestamptz;`
4. Backfill `decision` / `released_at`:
   - `status IN ('accepted','declined','waitlisted')` → `decision` = the matching
     value, `released_at = updated_at` (these were finalised/published).
   - `status='submitted' AND staged_decision IS NOT NULL` → `decision =
     staged_decision`, `released_at = NULL` (provisional).
   - otherwise → `decision='undecided'`, `released_at=NULL`.
5. `ALTER TABLE applications DROP COLUMN staged_decision, DROP COLUMN status;`
   (drops `applications_staged_decision_check` with the column).
6. `DROP TYPE application_status;`
7. `ALTER TABLE festival_artists ADD COLUMN source festival_artist_source NOT NULL DEFAULT 'application';`
   (existing rows backfill to `application`; the default stays — the future
   invite endpoint sets `'invite'` explicitly). Then
   `ALTER TABLE festival_artists DROP COLUMN status;` and
   `DROP TYPE festival_artist_status;` (verify no other consumer first).
8. `ALTER TABLE festivals DROP COLUMN decisions_released_at;`

**Down:** reverse exactly — recreate `application_status`,
`festivals.decisions_released_at`, `festival_artists.status`,
`applications.status`/`staged_decision`, backfill from `decision`/`released_at`
(best-effort: `released_at IS NOT NULL` → terminal status; else `staged_decision`
from a non-undecided decision), drop the new columns/types.

Dev data is seed-only and will be regenerated, so backfill correctness matters
mainly for safety and the down-migration test in CI.

## Seed changes (`demos/seed/main.go`)

Supersede the interim `staged_decision` fix: insert applications with `decision`
set directly from the seed-yaml status (`accepted→accept`, `declined→decline`,
`waitlisted→waitlist`, else `undecided`) and `released_at = NULL` (CPF stays
un-released so the organiser release/map/review demo clips still drive release
themselves). Do **not** write `festival_artists` rows (those now appear only on
release or invite); accepted artists remain spot-eligible via the provisional
`decision='accept'` path, so the live-map pins and spot summary still render.
Keep the end-of-seed invariant assertion, retargeted to the new model: assert
(a) no `decision='undecided'` row has a non-null `released_at`, and (b) every
released `accept` (`decision='accept' AND released_at IS NOT NULL`) has a
matching `festival_artists` lineup row. Since the seed leaves CPF un-released,
(a) holds trivially and (b) is vacuous — the assertion exists to catch a future
seed regression, not today's data.

## Web changes

- `getColumn` → unconditional on `decision`; delete the `isReleased` branch.
- `useApplicationReview`: `stageMutation` sends `decision`; derive `isReleased`
  from `apps.some(a => a.released_at != null)`; release/score/reorder unchanged.
- Types: regenerate `@render/api-client`; replace `status`/`staged_decision`
  reads with `decision`/`released_at` across the board, slide-over, triage,
  reviewer queue, and `me/applications` views.
- Keep the existing visual columns and the "Decisions released" banner (now
  driven by the derived flag).

## Testing strategy

**API (Go, `api/internal/festival/`):**
- Rewrite `release_test.go`: post-release invariant in one assertion — every
  decided app has `released_at` set, `decision` unchanged, each accept has a
  `festival_artists(source='application')` row, declines/waitlists have none;
  re-release with nothing new → 409; undecided present → 422; non-owner → 403;
  round-open → 409. Add a multi-decision release (accept+decline+waitlist) and
  assert full consistency (exercises the transactional loop).
- Remove the direct accept/decline/waitlist tests (`review.go` handlers gone).
- Update `spots_test.go` eligibility tests to the `decision`/`released_at` model.

**e2e API gate (`e2e/api/application-review.test.ts`):**
- Rename "staged decisions" coverage to `decision`; assert `PATCH decision`
  leaves `released_at` null and the artist-facing `/me/applications` hides it;
  after release assert `decision` persists, `released_at` set, and the accepted
  artist is spot-eligible (appears in the unassigned-eligible list) — the
  cross-surface consistency the bug violated.

**Web (Vitest, `__tests__/organiser/applications-page.test.tsx`):**
- Assert column placement is driven by `decision` alone: an `accept` with
  `released_at = null` (provisional) AND an `accept` with `released_at` set both
  render in Accept; the released banner appears when any app has `released_at`.

## Risks

- **Enum churn.** Dropping `application_status` and `festival_artist_status`
  requires the columns to be gone first; the migration ordering above handles it.
  Verify no other table/query references those types before dropping.
- **Wide blast radius.** `status`/`staged_decision` are read in many projections;
  the sqlc-scan grep checks and a full `task e2e` run are the safety net.
- **Down-migration** is best-effort (released accepts → terminal status). CI
  tests migrate-down, so the reverse must at least apply cleanly.

## Changelog

2026-06-12 — initial design (supersedes the interim seed `staged_decision` fix on
branch `fix/seed-staged-decisions`).
