# Festival Reviewer / Panellist Accounts — Design Spec

**Date:** 2026-05-29
**Status:** Approved
**Scope:** Let a festival owner invite advisory reviewers (panellists) who can score (1–5) and comment on applications, without the power to decide. Surfaces per-reviewer signal (average score + note count) on the existing review board, which stays owner-only. Foundational prerequisite for the configurable rubric, anonymous review, and multi-round selection (each a separate issue).

---

## Overview

Today every review handler in `api/internal/festival/` gates on `fest.OrganiserID == principal.UserID` — **only the festival owner can review applications.** This blocks the selection-panel workflow real festivals use and is the prerequisite the README's organiser-review roadmap items #2 (rubric), #3 (anonymous review) and #4 (multi-round) all depend on.

This spec adds a **festival reviewer** relationship: an invited user who can read applications, leave a single 1–5 score, and add author-attributed notes — but **cannot** accept/decline/waitlist, change flags, reorder, or manage reviewers. The owner alone makes decisions, now informed by the panel's average score shown on each board card.

Reviewers are not a global role. Consistent with the ownership-of-entity model (`db/migrations/000005_drop_user_role.up.sql`: artist = has an `artist_profiles` row, organiser = owns a festival, admin = `is_admin`), a reviewer simply **has a row in `festival_reviewers`** for that festival.

---

## 1. Database

**Migration:** `db/migrations/000011_festival_reviewers.up.sql`

```sql
-- Festival reviewers: invited advisory panellists. Access = row exists.
-- accepted_at is informational (set when the user first authenticates against
-- the festival's review endpoints); it does not gate access.
CREATE TABLE festival_reviewers (
    festival_id uuid        NOT NULL REFERENCES festivals(id) ON DELETE CASCADE,
    user_id     uuid        NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
    accepted_at timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (festival_id, user_id)
);

CREATE INDEX idx_festival_reviewers_user_id ON festival_reviewers (user_id);

-- Per-reviewer score on an application. PK on (application_id, reviewer_id)
-- means each reviewer owns exactly one score per application — no clobbering
-- between reviewers; a re-score updates that reviewer's own row.
CREATE TABLE application_scores (
    application_id uuid        NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    reviewer_id    uuid        NOT NULL REFERENCES users(id)        ON DELETE CASCADE,
    score          int         NOT NULL CHECK (score BETWEEN 1 AND 5),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (application_id, reviewer_id)
);

CREATE INDEX idx_application_scores_application_id ON application_scores (application_id);

-- Attribute notes to their author. Nullable: pre-existing rows and
-- owner-authored notes may have a NULL author. Anticipated by the
-- application-review spec (2026-05-27), which left notes attribution as a
-- deliberate follow-up.
ALTER TABLE application_notes ADD COLUMN author_id uuid REFERENCES users(id) ON DELETE SET NULL;
```

**Down migration** (`000011_festival_reviewers.down.sql`) reverses in reverse order:

```sql
ALTER TABLE application_notes DROP COLUMN author_id;
DROP TABLE application_scores;
DROP TABLE festival_reviewers;
```

Per `sqlc-and-schema.md`: adding `author_id` to `application_notes` means **every** `row.Scan(&i.…)` in `api/internal/sqlcdb/application_notes.sql.go` must list the new field. Grep-verify after `task db:generate`:

```bash
grep -c '&i\.' api/internal/sqlcdb/application_notes.sql.go   # must equal column count (now 5)
```

---

## 2. SQL Queries

New file `db/queries/festival_reviewers.sql`:

```sql
-- name: AddFestivalReviewer :one
INSERT INTO festival_reviewers (festival_id, user_id)
VALUES ($1, $2)
ON CONFLICT (festival_id, user_id) DO UPDATE SET festival_id = EXCLUDED.festival_id
RETURNING *;

-- name: GetFestivalReviewer :one
SELECT * FROM festival_reviewers WHERE festival_id = $1 AND user_id = $2;

-- name: ListFestivalReviewers :many
-- Joined to users for the owner's management list.
SELECT fr.*, u.email
FROM festival_reviewers fr
JOIN users u ON u.id = fr.user_id
WHERE fr.festival_id = $1
ORDER BY fr.created_at ASC;

-- name: RemoveFestivalReviewer :exec
DELETE FROM festival_reviewers WHERE festival_id = $1 AND user_id = $2;

-- name: MarkReviewerAccepted :exec
UPDATE festival_reviewers SET accepted_at = now()
WHERE festival_id = $1 AND user_id = $2 AND accepted_at IS NULL;
```

The `ON CONFLICT … DO UPDATE` (no-op write) makes re-inviting an existing reviewer idempotent and still `RETURNING *` (per `sqlc-and-schema.md` — `DO NOTHING` would return no row).

New file `db/queries/application_scores.sql`:

```sql
-- name: UpsertApplicationScore :one
INSERT INTO application_scores (application_id, reviewer_id, score)
VALUES ($1, $2, $3)
ON CONFLICT (application_id, reviewer_id)
DO UPDATE SET score = EXCLUDED.score, updated_at = now()
RETURNING *;

-- name: DeleteApplicationScore :exec
DELETE FROM application_scores WHERE application_id = $1 AND reviewer_id = $2;

-- name: ScoreSummaryByApplications :many
-- Batch aggregate for the list endpoint. avg is NULL when no scores yet.
SELECT application_id, AVG(score)::float8 AS avg_score, COUNT(*)::int AS score_count
FROM application_scores
WHERE application_id = ANY($1::uuid[])
GROUP BY application_id;

-- name: GetMyScore :one
SELECT score FROM application_scores WHERE application_id = $1 AND reviewer_id = $2;
```

Modified queries in `db/queries/`:

```sql
-- application_notes.sql — CreateApplicationNote now takes author_id;
-- selects return author_id (regenerate Scans).
-- name: CreateApplicationNote :one
INSERT INTO application_notes (application_id, content, author_id)
VALUES ($1, $2, $3) RETURNING *;

-- applications.sql — a reviewer-scoped list that excludes the reviewer's own
-- application (conflict of interest). artist_profiles.user_id links a reviewer
-- to the application they must not see.
-- name: ListApplicationsByFormWithArtistExcludingReviewer :many
SELECT a.*, ap.display_name, ap.avatar_s3_key, ap.medium_tags, ap.location_label
FROM applications a
JOIN artist_profiles ap ON ap.id = a.artist_id
WHERE a.form_id = $1
  AND ap.user_id IS DISTINCT FROM $2   -- $2 = reviewer's user_id
ORDER BY a.rank ASC, a.created_at ASC;
```

(The existing `ListApplicationsByFormWithArtist` is unchanged and still used for the owner.)

---

## 3. API

Base path: `/festivals/{festivalID}`. All endpoints require auth. Access is resolved by a new helper rather than a middleware group (matching the existing inline-ownership style in the `festival` package):

```go
// resolveFestivalAccess returns owner | reviewer | none for the caller.
// owner  = fest.OrganiserID == userID
// reviewer = row in festival_reviewers
func resolveFestivalAccess(ctx, q, festUUID, userID) (festivalRole, error)
```

### Permission matrix

| Method | Path | Owner | Reviewer | Notes |
|--------|------|:---:|:---:|-------|
| `POST` | `/reviewers` | ✅ | ❌ | Invite by email |
| `GET` | `/reviewers` | ✅ | ❌ | List + accepted status |
| `DELETE` | `/reviewers/{userID}` | ✅ | ❌ | Remove |
| `GET` | `/applications` | ✅ | ✅ | Reviewer: own application filtered out; response adds score fields |
| `PUT` | `/applications/{applicationID}/score` | ✅ | ✅ | Upsert caller's 1–5 score; 403 on own application |
| `POST` | `/applications/{applicationID}/notes` | ✅ | ✅ | Sets `author_id` from principal |
| `POST` | `/applications/{applicationID}/accept` | ✅ | ❌ | **Unchanged** owner gate |
| `POST` | `/applications/{applicationID}/decline` | ✅ | ❌ | **Unchanged** |
| `POST` | `/applications/{applicationID}/waitlist` | ✅ | ❌ | **Unchanged** |
| `PATCH` | `/applications/{applicationID}` | ✅ | ❌ | **Unchanged** (flags) |
| `POST` | `/applications/reorder` | ✅ | ❌ | **Unchanged** |

Decision endpoints keep their existing `fest.OrganiserID == principal.UserID` check verbatim — that is the advisory boundary. Reviewer access is additive only on read/score/note.

**Route order** (`api-handler-checklist.md`): `/applications/reorder` stays registered before `/applications/{applicationID}/…`. `/reviewers/{userID}` is a separate sub-tree; register `/reviewers` collection routes before the `{userID}` param within it.

### Invite flow — `POST /festivals/{festivalID}/reviewers`

Body: `{ "email": "judge@example.com" }`. Owner only. Steps:

1. Upsert the user by email — `INSERT … ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING *` (per the race rule). New users are created **passwordless** (already a valid state for OAuth-only accounts).
2. `AddFestivalReviewer(festivalID, user.ID)`.
3. Send the invite email in a **detached goroutine** mirroring `ForgotPasswordWork` in `api/internal/auth/reset.go` (bounded `context.WithTimeout(context.Background(), 30*time.Second)`, `defer cancel()`, `slog` error levels, **does not capture `r.Context()`** — per `background-work.md`):
   - **New user (no `password_hash`)** → create a `password_reset_token` and send *"You've been invited to review {festival} — set your password"* with the reset link. Setting the password via the existing `ResetPasswordHandler` is their de-facto acceptance.
   - **Existing user** → send *"You've been added as a reviewer for {festival}"* with a log-in link. **No token is minted and the password/session is never touched** — inviting an email that already belongs to a real artist must not become a password-reset oracle (`auth-changes.md`).
4. Respond `201` with the reviewer summary. The email outcome never affects the HTTP status.

Returns `200`/idempotent on re-invite of an existing reviewer.

### Score endpoint — `PUT /festivals/{festivalID}/applications/{applicationID}/score`

Body: `{ "score": 4 }`. Owner or reviewer. Validates `1 ≤ score ≤ 5` (400 otherwise). If the caller is a reviewer whose `artist_profiles.user_id` owns this application → `403` (COI, defense-in-depth beyond the list filter). Upserts via `UpsertApplicationScore`. Returns the updated score row.

### Enriched list response (additions)

The existing `applicationResponse` gains three fields:

```jsonc
{
  // …existing fields…
  "avg_score":   3.5,    // null when no scores yet
  "score_count": 2,
  "my_score":    4       // the calling user's own score, null if none
}
```

For the owner the list uses `ListApplicationsByFormWithArtist`; for a reviewer it uses `…ExcludingReviewer` (COI). In both cases the handler batch-fetches `ScoreSummaryByApplications` over the returned IDs (one round-trip, no N+1, same pattern as notes) and looks up `my_score` for the caller.

Notes in the response gain `author_id` (and `author_email` for the owner's view, resolved from the same join).

---

## 4. Frontend (web)

Scope here is deliberately thin — the board redesign is out of scope (separate issue). Two surfaces:

### Reviewer management

New section on the organiser festival settings page (`web/src/app/organiser/festivals/[id]/…`): an email input to invite, and a list of current reviewers with their accepted/pending state and a remove button. Owner-only (the page already requires ownership).

### Score + author signal on the existing board

- Each `ApplicationCard` gains a compact **average-score badge** (e.g. `★ 3.5 · 2`) when `score_count > 0`; hidden otherwise.
- The slide-over (`ApplicationSlideOver`) shows a **1–5 score control** bound to `my_score` (visible to reviewers and the owner), and renders note authorship (`author_email` or "You").
- The board's decision controls (accept/decline/waitlist/reorder/flags) render **only for the owner**. A reviewer opening the board sees a read-only board with scoring + notes, minus their own application.

### Reviewer entry point

A reviewer with no festival of their own still needs to reach the board. Add a "Festivals I'm reviewing" list to the organiser/dashboard area, sourced from a new `GET /me/reviewing` (lists festivals where the caller is in `festival_reviewers`). Small addition; keeps reviewers from needing a deep link every time.

---

## 5. Testing

Per `api-handler-checklist.md`, `auth-changes.md`, `e2e-debugging.md`. The tests that catch the real failure modes (unit tests using `WithUserForTest` bypass the gate and would not):

- **Auth probes:** unauthenticated request to each new endpoint → `401`; authenticated non-owner/non-reviewer → `403`.
- **Advisory-boundary canary (the key test):** a reviewer calling `accept` / `decline` / `waitlist` / `PATCH` flags / `reorder` → **`403`**. This single set proves the permission model.
- **COI:** a reviewer who also applied to the festival cannot see their own application in `GET /applications`, and `PUT …/score` against it → `403`.
- **No-clobber + sqlc Scan canary:** two different reviewers score the same application; assert both `application_scores` rows persist and `avg_score` appears **non-zero** in the `GET /applications` JSON (a zero-asserting unit test would not catch a missing Scan).
- **Concurrent upsert:** two rapid `PUT …/score` from one reviewer via `Promise.all` → exactly one row, `ON CONFLICT` path holds.
- **Invite safety:** inviting an email that already belongs to a user does **not** mint a reset token, change their `password_hash`, or bump `session_version`.
- **Notes attribution:** a note created by a reviewer returns that reviewer's `author_id`; an owner note resolves correctly.

E2E lives under `e2e/api/` (a new `reviewer-panellist.test.ts`, using `signupAndMint` to avoid the login rate-limit per `e2e-debugging.md`) and a browser spec for the management UI + read-only reviewer board.

**Docker dual-edit discipline** (`e2e-debugging.md`): API edits must be applied to both the worktree and the main-repo bind-mount path, and the `task up` rebuild line watched, before e2e runs.

---

## 6. Constraints

- Reviewers are **advisory only**. The owner's decision endpoints are never opened to reviewers — verified by the boundary canary, not just code review.
- A reviewer's own application is hidden at the **API** layer (query filter + score-endpoint guard), not merely the UI.
- Inviting an email never resets or reveals anything about an existing account — invites only mint a set-password token for **brand-new passwordless** users.
- Invite-email failures are logged (`slog`) and never propagate to the HTTP response; the reviewer row is created regardless.
- Scores and notes are organiser/panel-internal — **never surfaced to artists** (consistent with `shortlisted`/`review_flag`).
- `accepted_at` is informational; access is governed solely by row existence in `festival_reviewers`.

---

## Open questions (resolved)

- **Reviewer powers:** Score & comment only; owner decides.
- **Invite mechanism:** Email + accept link, reusing the password-reset token machinery (no dedicated invites table).
- **Conflict of interest:** Auto-hide the reviewer's own application (API-enforced). Manual recuse for *other* conflicts deferred.
- **Scoring scope:** One 1–5 score per reviewer per application; full configurable multi-criteria rubric is a separate issue.
- **Board modelling:** "In Review" remains `submitted + shortlisted=true` (no new status); board stays owner-only; reviewer signal shown as a card badge.

---

## Out of scope (tracked separately)

- Configurable multi-criteria scoring rubric (README organiser-review item #2).
- Reviewer-facing anonymised applications — hide artist identity until scores locked (item #3).
- Multi-round selection — screening → shortlist → final with per-round panels/criteria (item #4).
- Board UI redesign beyond surfacing the score/notes badge.
