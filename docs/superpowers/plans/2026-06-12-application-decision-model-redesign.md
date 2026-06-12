# Application Decision Model Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ambiguous `applications.status` + `staged_decision` + `festivals.decisions_released_at` triple with a single-source-of-truth model: `applications.decision` (the verdict) + `applications.released_at` (published?) + `festival_artists` as the first-class lineup, so the organiser board can resolve every application's column unconditionally.

**Architecture:** One aggressive migration drops `application_status`/`festival_artist_status` enums and the `status`/`staged_decision`/`decisions_released_at` columns, adds `application_decision` enum + `applications.decision`/`released_at` + `festival_artists.source`. The direct `accept`/`decline`/`waitlist` endpoints are deleted (one decision writer remains: PATCH `decision` + batch release, which is wrapped in a transaction). sqlc queries, Go handlers, the OpenAPI client, the web board, the demo seed, and all tests are migrated to the new shape.

**Tech Stack:** Go (chi, pgx, sqlc), golang-migrate, Next.js 16 (App Router, React Query, openapi-fetch), Postgres, Vitest, Playwright, Docker Compose.

**Design doc:** `docs/superpowers/specs/2026-06-12-application-decision-model-redesign-design.md`

**Branch:** `feat/decision-model` (renamed from `fix/seed-staged-decisions`; the interim seed fix lives here and is superseded in Task 5).

---

## Progress (2026-06-12)

- ✅ **Task 1 — Migration** (`b5bfb92`). Applied; up/down/up round-trip clean.
- ✅ **Task 2 — API layer** (`a87b3f4` + review fixes `7e4b0a0`). `task api:test` green. Spec compliance + code-quality reviews done. Review fixes folded in: released-application immutability (PATCH → 409), `CountSubmittedUndecidedByFestival` also requires `released_at IS NULL`, real declined-applicant exclusion test, and `festival.spec.md` updated to the new model (so Task 7's festival.spec.md item is already done — only `db.spec.md` + `.claude/rules/e2e-debugging.md` remain there).
  - **Carry-over for Task 4:** `useApplicationReview.ts` reorder still sends `body: { status: 'submitted', ids }` — the reorder handler now validates against decision values, so the web must send a valid `decision` (or the field be reworked). Web is known-stale (still reads `decisions_released_at`/`staged_decision`) until Task 4.
- ⏳ **Tasks 3–6** not started (OpenAPI, web, seed, e2e). Task 7 partially done (festival.spec.md).

---

## Conventions for every task

- The Docker stack bind-mounts the **main repo** (`/Users/adampowis/workspace/murals`). We are working in the main repo, so edits hot-reload directly. After a Go edit, confirm the rebuild: `docker compose -f infra/docker-compose.yml logs api --tail=15 | grep -E 'building|running|api starting'`.
- Task runner commands (run from repo root): `task db:migrate`, `task db:generate`, `task openapi:gen`, `task api:test`, `task lint` (web, run from `web/`), `task test` (web), `task e2e`, `task demos:seed`.
- Stack must be up for e2e/seed/browser steps: `task up`.
- Go tests: every `Test*` calls `t.Parallel()` first; use `testutil.NewDB(t)`, `testutil.CreateUser`, `testutil.DoRequest`; external test package `festival_test`.

---

## Task 1: Migration — new columns, drop old ones

**Files:**
- Create: `db/migrations/000007_application_decision_model.up.sql`
- Create: `db/migrations/000007_application_decision_model.down.sql`

- [ ] **Step 1: Write the up migration**

Create `db/migrations/000007_application_decision_model.up.sql`:

```sql
-- Single-source-of-truth decision model.
-- decision: the organiser's verdict (replaces status terminal values + staged_decision)
-- released_at: when that verdict became visible to the artist (replaces festivals.decisions_released_at)
-- festival_artists.source: how an artist entered the lineup (application | invite)

CREATE TYPE application_decision AS ENUM ('undecided', 'accept', 'waitlist', 'decline');
CREATE TYPE festival_artist_source AS ENUM ('application', 'invite');

-- applications: add the two new columns
ALTER TABLE applications
    ADD COLUMN decision    application_decision NOT NULL DEFAULT 'undecided',
    ADD COLUMN released_at  timestamptz;

-- Backfill from the old shape.
-- Released/terminal status -> decision + released_at = updated_at (best available timestamp).
UPDATE applications SET decision = 'accept',   released_at = updated_at WHERE status = 'accepted';
UPDATE applications SET decision = 'waitlist', released_at = updated_at WHERE status = 'waitlisted';
UPDATE applications SET decision = 'decline',  released_at = updated_at WHERE status = 'declined';
-- Provisional staged decisions -> decision, still unreleased.
UPDATE applications SET decision = staged_decision::application_decision
    WHERE status = 'submitted' AND staged_decision IS NOT NULL;
-- (everything else keeps the default 'undecided', released_at NULL)

ALTER TABLE applications DROP COLUMN staged_decision;
ALTER TABLE applications DROP COLUMN status;
DROP TYPE application_status;

-- festival_artists: source column, drop the vestigial status (always 'accepted' in practice)
ALTER TABLE festival_artists
    ADD COLUMN source festival_artist_source NOT NULL DEFAULT 'application';
ALTER TABLE festival_artists DROP COLUMN status;
DROP TYPE festival_artist_status;

-- festivals: release state now lives per-application
ALTER TABLE festivals DROP COLUMN decisions_released_at;
```

- [ ] **Step 2: Write the down migration**

Create `db/migrations/000007_application_decision_model.down.sql` (best-effort reverse — see design doc "best-effort" decision):

```sql
-- Reverse: recreate enums/columns and backfill from decision/released_at.

CREATE TYPE application_status AS ENUM ('submitted', 'accepted', 'declined', 'waitlisted');
CREATE TYPE festival_artist_status AS ENUM ('invited', 'accepted', 'declined');

ALTER TABLE festivals ADD COLUMN decisions_released_at timestamptz;
-- Reconstruct the festival-level flag from the earliest released decision.
UPDATE festivals f SET decisions_released_at = sub.first_release
FROM (
    SELECT af.festival_id, MIN(a.released_at) AS first_release
    FROM applications a JOIN application_forms af ON af.id = a.form_id
    WHERE a.released_at IS NOT NULL
    GROUP BY af.festival_id
) sub
WHERE f.id = sub.festival_id;

ALTER TABLE festival_artists ADD COLUMN status festival_artist_status NOT NULL DEFAULT 'accepted';
ALTER TABLE festival_artists DROP COLUMN source;
DROP TYPE festival_artist_source;

ALTER TABLE applications ADD COLUMN status application_status NOT NULL DEFAULT 'submitted';
ALTER TABLE applications ADD COLUMN staged_decision text
    CHECK (staged_decision = ANY (ARRAY['accept','waitlist','decline']));

-- Released decisions -> terminal status; unreleased non-undecided -> staged_decision.
UPDATE applications SET status = 'accepted'   WHERE decision = 'accept'   AND released_at IS NOT NULL;
UPDATE applications SET status = 'waitlisted' WHERE decision = 'waitlist' AND released_at IS NOT NULL;
UPDATE applications SET status = 'declined'   WHERE decision = 'decline'  AND released_at IS NOT NULL;
UPDATE applications SET staged_decision = decision::text
    WHERE decision <> 'undecided' AND released_at IS NULL;

ALTER TABLE applications DROP COLUMN released_at;
ALTER TABLE applications DROP COLUMN decision;
DROP TYPE application_decision;
```

- [ ] **Step 3: Apply the migration**

Run: `task db:migrate`
Expected: applies `000007` with no error (`...applied` / no "dirty" warning).

- [ ] **Step 4: Verify the schema**

Run:
```bash
docker compose -f infra/docker-compose.yml exec -T db psql -U render -d render -c "\d applications" | grep -E 'decision|released_at|status|staged'
docker compose -f infra/docker-compose.yml exec -T db psql -U render -d render -c "\d festival_artists" | grep -E 'source|status'
docker compose -f infra/docker-compose.yml exec -T db psql -U render -d render -c "\d festivals" | grep -E 'decisions_released_at'
```
Expected: `applications` has `decision` + `released_at`, no `status`/`staged_decision`; `festival_artists` has `source`, no `status`; `festivals` shows nothing for `decisions_released_at`.

- [ ] **Step 5: Verify the down migration applies cleanly, then re-up**

Run: `go run -C api ./cmd/migrate down 1 && task db:migrate`
Expected: down removes `000007` then up re-applies it, both without error. (This proves the down is CI-safe.)

- [ ] **Step 6: Commit**

```bash
git add db/migrations/000007_application_decision_model.up.sql db/migrations/000007_application_decision_model.down.sql
git commit -m "feat(db): decision/released_at model migration (E?? decision redesign)"
```

---

## Task 2: API layer — queries, codegen, handlers, Go tests

This is the largest task: the migration just changed the DB out from under the generated code, so the Go build is red until queries, codegen, and handlers are all aligned. It ends green at `task api:test`.

**Files:**
- Modify: `db/queries/applications.sql`, `db/queries/festivals.sql`, `db/queries/festival_artists.sql`
- Regenerate: `api/internal/sqlcdb/*.sql.go`, `api/internal/sqlcdb/models.go`
- Modify: `api/internal/festival/application.go` (DTOs + projections)
- Modify: `api/internal/festival/patch.go` (PATCH `decision`)
- Modify: `api/internal/festival/release.go` (rewrite to released_at + lineup)
- Delete from: `api/internal/festival/review.go` (Accept/Decline handlers), delete `api/internal/festival/waitlist.go`
- Modify: `api/cmd/api/main.go` (remove 3 routes)
- Modify: `api/internal/festival/appearances.go` (lineup read if it used status)
- Modify/rewrite tests: `api/internal/festival/release_test.go`, `spots_test.go`, `roundtrip_test.go`, `appearances_test.go`, `map_test.go`, and delete direct-decision tests in `review_test.go`/`waitlist_test.go`

### 2a. Queries

- [ ] **Step 1: Rewrite `db/queries/applications.sql`**

Replace the affected queries. `CreateApplication` (no `status` to set — it's gone), the enriched list selects (drop `a.status`, drop `a.staged_decision`, add `a.decision`, `a.released_at`), `UpdateApplicationFlags` (`staged_decision` → `decision`), `CountSubmittedUndecidedByFestival` (→ `decision = 'undecided'`), `ListStagedApplicationsByFestival` (→ `decision <> 'undecided' AND released_at IS NULL`), `ReleaseDecisionsForFestival` (set `released_at`), and delete `UpdateApplicationStatus`.

`UpdateApplicationFlags`:
```sql
-- name: UpdateApplicationFlags :one
UPDATE applications
SET shortlisted = $2, review_flag = $3, decision = $4, updated_at = now()
WHERE id = $1
RETURNING *;
```

`CountSubmittedUndecidedByFestival`:
```sql
-- name: CountSubmittedUndecidedByFestival :one
-- Applications still needing a decision (block release while > 0).
SELECT COUNT(*)::int AS count
FROM applications a
JOIN application_forms f ON a.form_id = f.id
WHERE f.festival_id = $1
  AND a.decision = 'undecided';
```

`ReleaseDecisionsForFestival` (set released_at on the newly-released wave; return them for the side-effect loop):
```sql
-- name: ReleaseDecisionsForFestival :many
-- Publish every decided-but-unreleased application in the festival. Returns the
-- rows it just released so the handler can create lineup rows / clear spots / email.
UPDATE applications a
SET released_at = now(), updated_at = now()
FROM application_forms f
WHERE a.form_id = f.id
  AND f.festival_id = $1
  AND a.decision <> 'undecided'
  AND a.released_at IS NULL
RETURNING a.id, a.form_id, a.artist_id, a.decision, a.released_at;
```

Delete `UpdateApplicationStatus` entirely (its only callers — the direct handlers — are deleted in this task).

Update the column lists of `ListApplicationsByFormWithArtist` and `ListApplicationsByFormWithArtistExcludingReviewer`: replace `a.status` with `a.decision` and add `a.released_at` (drop `a.staged_decision`). Update `CreateApplication` if it names `status` (it inserts `(form_id, artist_id, answers)` — no change needed).

- [ ] **Step 2: Rewrite `db/queries/festivals.sql`**

Delete `SetFestivalDecisionsReleasedAt`. Remove `decisions_released_at` from any `SELECT *`-style festival queries that explicitly list columns (if they use `SELECT *`, regen handles it). Grep to confirm: `grep -n decisions_released_at db/queries/festivals.sql` → no matches after.

- [ ] **Step 3: Rewrite `db/queries/festival_artists.sql`**

`AddFestivalArtist` takes `source`, no `status`:
```sql
-- name: AddFestivalArtist :one
INSERT INTO festival_artists (festival_id, artist_id, source)
VALUES ($1, $2, $3)
ON CONFLICT (festival_id, artist_id) DO UPDATE
    SET source = EXCLUDED.source, updated_at = now()
RETURNING *;
```

Update the eligibility/lineup queries to drop `fa.status = 'accepted'` (membership now = row exists) and read `applications.decision`/`released_at` instead of `staged_decision`:

`GetSpotEligibleArtist`:
```sql
-- name: GetSpotEligibleArtist :one
SELECT @artist_id::uuid AS artist_id
WHERE EXISTS (
    SELECT 1 FROM festival_artists fa
    WHERE fa.festival_id = @festival_id AND fa.artist_id = @artist_id
)
OR EXISTS (
    SELECT 1 FROM applications a
    JOIN application_forms af ON af.id = a.form_id
    WHERE af.festival_id = @festival_id AND a.artist_id = @artist_id
      AND a.decision = 'accept' AND a.released_at IS NULL
);
```

`GetUnassignedSpotEligibleArtists` (festival_spots.sql) — union lineup members + provisional accepts:
```sql
-- name: GetUnassignedSpotEligibleArtists :many
SELECT elig.artist_id, elig.name
FROM (
    SELECT fa.artist_id, ap.display_name AS name
    FROM festival_artists fa
    JOIN artist_profiles ap ON ap.id = fa.artist_id
    WHERE fa.festival_id = $1
    UNION
    SELECT a.artist_id, ap.display_name AS name
    FROM applications a
    JOIN application_forms af ON af.id = a.form_id
    JOIN artist_profiles ap ON ap.id = a.artist_id
    WHERE af.festival_id = $1 AND a.decision = 'accept' AND a.released_at IS NULL
) elig
WHERE NOT EXISTS (
    SELECT 1 FROM festival_spots fs
    WHERE fs.festival_id = $1 AND fs.artist_id = elig.artist_id
)
ORDER BY elig.name;
```

Also update `GetUnassignedAcceptedArtists`, `GetAcceptedArtistForFestival`, and `ListPublicFestivalsForArtist` in `festival_artists.sql`/`festival_spots.sql` to drop `fa.status = 'accepted'` (membership = row exists). Grep first: `grep -rn "fa.status\|status = 'accepted'\|FestivalArtistStatus" db/queries/` and fix each.

- [ ] **Step 4: Regenerate sqlc and run the scan checks**

Run: `task db:generate`
Then verify scan counts match column counts (`.claude/rules/sqlc-and-schema.md`):
```bash
grep -c '&i\.' api/internal/sqlcdb/applications.sql.go
docker compose -f infra/docker-compose.yml exec -T db psql -U render -d render -c "\d applications" | grep -cE '^\s+\w+\s+\|'
```
Expected: the `&i.` count for each SELECT equals the applications column count. Confirm `Application` struct in `models.go` now has `Decision` + `ReleasedAt`, no `Status`/`StagedDecision`.

### 2b. Handlers & DTOs

- [ ] **Step 5: Update response DTOs in `api/internal/festival/application.go`**

In `applicationResponse`: replace `Status string` + `StagedDecision *string` with `Decision string \`json:"decision"\`` and `ReleasedAt *string \`json:"released_at"\``. Update `toApplicationResponse`, `toEnrichedResponse`, and the excluding-reviewer projection to set `Decision: string(a.Decision)` and `ReleasedAt: rfc3339Ptr(a.ReleasedAt)` (add a small helper that returns `*string` from a nullable `pgtype.Timestamptz`, or nil when not valid).

`myApplicationResponse` (artist-facing — no early awareness): replace `Status` with a `Decision *string` that is **only populated when released**:
```go
func toMyApplicationResponse(a sqlcdb.Application) myApplicationResponse {
    var decision *string
    if a.ReleasedAt.Valid {
        d := string(a.Decision)
        decision = &d
    }
    return myApplicationResponse{
        ID:        a.ID.String(),
        FormID:    a.FormID.String(),
        ArtistID:  a.ArtistID.String(),
        Decision:  decision, // nil until released → artist sees "pending"
        Answers:   a.Answers,
        CreatedAt: a.CreatedAt.Time.Format(time.RFC3339),
        UpdatedAt: a.UpdatedAt.Time.Format(time.RFC3339),
    }
}
```
`reviewerApplicationResponse` already omits decision fields — no change, but confirm it doesn't reference `Status`.

Add the helper:
```go
func rfc3339Ptr(ts pgtype.Timestamptz) *string {
    if !ts.Valid {
        return nil
    }
    s := ts.Time.Format(time.RFC3339)
    return &s
}
```

- [ ] **Step 6: Update the PATCH handler `api/internal/festival/patch.go`**

Rename the request field `staged_decision` → `decision`; accept `undecided|accept|waitlist|decline`. Pass it to `UpdateApplicationFlags` as the `decision` arg. Update the post-update spot-eligibility logic (line ~98: `if req.StagedDecision == nil || *req.StagedDecision != "accept"` → clear spot) to: clear the spot assignment when the new decision is not `accept`. Update the doc comment.

```go
var req struct {
    Shortlisted bool    `json:"shortlisted"`
    ReviewFlag  bool    `json:"review_flag"`
    Decision    *string `json:"decision"`
}
// ...
decision := "undecided"
if req.Decision != nil {
    valid := map[string]bool{"undecided": true, "accept": true, "waitlist": true, "decline": true}
    if !valid[*req.Decision] {
        httperr.BadRequest(w, "decision must be undecided, accept, waitlist, or decline")
        return
    }
    decision = *req.Decision
}
updated, err := q.UpdateApplicationFlags(r.Context(), sqlcdb.UpdateApplicationFlagsParams{
    ID: appUUID, Shortlisted: req.Shortlisted, ReviewFlag: req.ReviewFlag,
    Decision: sqlcdb.ApplicationDecision(decision),
})
// ... then: if decision != "accept" → ClearSpotAssignmentForArtist
```
(Check the existing review-round gate stays — PATCH is blocked while the round is open.)

- [ ] **Step 7: Rewrite `api/internal/festival/release.go`**

The handler already begins a transaction (from the earlier interim edit). Rewrite the body so the staged→status mapping becomes a released_at stamp, accepts create lineup rows with `source='application'`, and the "nothing to release" case returns 409:

```go
// after owner/round/undecided guards (unchanged) ...
tx, err := pool.Begin(r.Context())
if err != nil { httperr.InternalServerError(w); return }
defer tx.Rollback(r.Context()) //nolint:errcheck
qtx := q.WithTx(tx)

released, err := qtx.ReleaseDecisionsForFestival(r.Context(), festUUID)
if err != nil { httperr.InternalServerError(w); return }
if len(released) == 0 {
    w.WriteHeader(http.StatusConflict) // nothing new to release (already released)
    return
}

type pendingNotification struct{ artistID pgtype.UUID; status string }
notifications := make([]pendingNotification, 0, len(released))
for _, app := range released {
    if app.Decision == sqlcdb.ApplicationDecisionAccept {
        if _, err := qtx.AddFestivalArtist(r.Context(), sqlcdb.AddFestivalArtistParams{
            FestivalID: festUUID, ArtistID: app.ArtistID,
            Source: sqlcdb.FestivalArtistSourceApplication,
        }); err != nil { httperr.InternalServerError(w); return }
    } else {
        if err := qtx.ClearSpotAssignmentForArtist(r.Context(), sqlcdb.ClearSpotAssignmentForArtistParams{
            FestivalID: festUUID, ArtistID: app.ArtistID,
        }); err != nil { httperr.InternalServerError(w); return }
    }
    notifications = append(notifications, pendingNotification{app.ArtistID, decisionToStatus(string(app.Decision))})
}
if err := tx.Commit(r.Context()); err != nil { httperr.InternalServerError(w); return }
for _, n := range notifications {
    sendApplicationNotification(pool, mailer, n.artistID, fest.Name, n.status)
}
w.Header().Set("Content-Type", "application/json")
_ = json.NewEncoder(w).Encode(map[string]int{"released": len(released)})
```

The `ReleaseDecisionsForFestivalRow` now exposes `.Decision` (not `.Status`). Add a tiny mapper for the email status string (the notification template switches on `accepted/declined/waitlisted`):
```go
func decisionToStatus(d string) string {
    switch d {
    case "accept": return "accepted"
    case "waitlist": return "waitlisted"
    case "decline": return "declined"
    default: return d
    }
}
```
Remove the now-unused `SetFestivalDecisionsReleasedAt` call and the `errors`/`pgx.ErrNoRows` 409 path (the 409 is now the empty-release case above). Keep the undecided-count 422 guard and the review-round 409 guard above the transaction.

- [ ] **Step 8: Delete the direct decision handlers and routes**

In `api/internal/festival/review.go` delete `AcceptApplicationHandler` and `DeclineApplicationHandler`. Delete the file `api/internal/festival/waitlist.go` (`WaitlistApplicationHandler`). In `api/cmd/api/main.go` delete the three routes:
```
r.Post("/festivals/{festivalID}/applications/{applicationID}/accept", ...)
r.Post("/festivals/{festivalID}/applications/{applicationID}/decline", ...)
r.Post("/festivals/{festivalID}/applications/{applicationID}/waitlist", ...)
```
Grep for any other references: `grep -rn "AcceptApplicationHandler\|DeclineApplicationHandler\|WaitlistApplicationHandler" api/` → none remain (except deleted-file diffs).

- [ ] **Step 9: Fix remaining compile errors from `.Status`/`FestivalArtistStatus`**

Grep and fix every non-test reference: `grep -rn "\.StagedDecision\|ApplicationStatus\|FestivalArtistStatus\|SetFestivalDecisionsReleasedAt\|\.DecisionsReleasedAt" api/internal api/cmd | grep -v _test`. Notably `appearances.go` and `festival.go` may read `decisions_released_at` from a festival row — remove those fields from their DTOs/usage. Build: `go build -C api ./...` until clean.

### 2c. Go tests

- [ ] **Step 10: Rewrite `release_test.go`**

Replace the staged-status assertions with decision/released_at. Add the consolidated post-release invariant test and a multi-decision test. The PATCH helper now sends `{"decision":"accept"}`.

```go
func TestReleaseDecisions_PostReleaseInvariantHolds(t *testing.T) {
    t.Parallel()
    db := testutil.NewDB(t)
    sc := setupReviewScenario(t, db)
    srv := buildReleaseTestServer(t, db)
    q := sqlcdb.New(db)
    festUUID := pgUUID(t, sc.festID)

    // stage accept
    patch := doRequest(t, srv, "PATCH",
        "/festivals/"+sc.festID+"/applications/"+sc.applicationID,
        `{"shortlisted":false,"review_flag":false,"decision":"accept"}`, sc.orgToken)
    require.Equal(t, http.StatusOK, patch.StatusCode); _ = patch.Body.Close()

    resp := doRequest(t, srv, "POST",
        "/festivals/"+sc.festID+"/applications/release-decisions", "", sc.orgToken)
    require.Equal(t, http.StatusOK, resp.StatusCode); _ = resp.Body.Close()

    app, err := q.GetApplicationByID(context.Background(), pgUUID(t, sc.applicationID))
    require.NoError(t, err)
    assert.Equal(t, sqlcdb.ApplicationDecisionAccept, app.Decision) // verdict unchanged
    assert.True(t, app.ReleasedAt.Valid, "released_at must be set")

    lineup, err := q.GetUnassignedAcceptedArtists(context.Background(), festUUID)
    require.NoError(t, err)
    require.Len(t, lineup, 1, "released accept becomes a lineup member")
}

func TestReleaseDecisions_NothingToRelease_409(t *testing.T) {
    t.Parallel()
    db := testutil.NewDB(t)
    sc := setupReviewScenario(t, db)
    srv := buildReleaseTestServer(t, db)
    // decide + release
    _ = doRequest(t, srv, "PATCH", "/festivals/"+sc.festID+"/applications/"+sc.applicationID,
        `{"shortlisted":false,"review_flag":false,"decision":"decline"}`, sc.orgToken).Body.Close()
    first := doRequest(t, srv, "POST", "/festivals/"+sc.festID+"/applications/release-decisions", "", sc.orgToken)
    require.Equal(t, http.StatusOK, first.StatusCode); _ = first.Body.Close()
    // second release with nothing new -> 409
    second := doRequest(t, srv, "POST", "/festivals/"+sc.festID+"/applications/release-decisions", "", sc.orgToken)
    require.Equal(t, http.StatusConflict, second.StatusCode); _ = second.Body.Close()
}
```
Keep/adapt: `TestReleaseDecisions_RejectsWhenUndecidedAppsExist` (still 422), `TestReleaseDecisions_ForbiddenForNonOwner` (403). Convert `TestReleaseDecisions_AcceptedAppBecomesFestivalArtist` / `_DeclinedAppDoesNotBecome...` to the decision PATCH body (they already assert lineup membership — just change the PATCH JSON to `"decision"`).

- [ ] **Step 11: Fix the other festival tests**

In `spots_test.go`, `roundtrip_test.go`, `appearances_test.go`, `map_test.go`: replace any `staged_decision` PATCH bodies with `decision`, any `AddFestivalArtist` calls to pass `Source: sqlcdb.FestivalArtistSourceApplication` (no `Status`), and any assertions reading `.Status` on an application/festival_artist. Delete `review_test.go`/`waitlist_test.go` tests that exercised the removed direct endpoints (keep any tests for `ListApplicationsHandler` / scoring, adapting field names). Grep: `grep -rn "staged_decision\|FestivalArtistStatus\|\.Status\b\|decisions_released" api/internal/festival/*_test.go` and fix each.

- [ ] **Step 12: Run the API suite green**

Run: `task api:test`
Expected: PASS. If a sqlc-scan mismatch shows as zero-value fields, re-check Step 4.

- [ ] **Step 13: Commit**

```bash
git add db/queries api/internal/sqlcdb api/internal/festival api/cmd/api/main.go
git commit -m "feat(api): decision/released_at model; drop direct decision endpoints; transactional release"
```

---

## Task 3: OpenAPI spec + client regen

**Files:**
- Modify: `openapi/openapi.yaml`
- Regenerate: `openapi/generated/client.ts`, `api/internal/openapi/api.gen.go`

- [ ] **Step 1: Remove the deleted paths**

In `openapi/openapi.yaml` delete the three path items: `/festivals/{festivalID}/applications/{applicationID}/accept`, `/decline`, `/waitlist` (around lines 2751–2850).

- [ ] **Step 2: Update the `Application` schema**

Around line 610: remove `staged_decision`, remove `status` (or repurpose), add:
```yaml
        decision:
          type: string
          enum: [undecided, accept, waitlist, decline]
        released_at:
          type: string
          format: date-time
          nullable: true
```
Update the `PATCH .../applications/{id}` request body (line ~2875): `staged_decision` → `decision` (same enum). In the `Festival` schema remove `decisions_released_at` (line ~488). In `MyApplication` (line ~663) replace `status` with a nullable `decision`.

- [ ] **Step 3: Regenerate and verify no drift**

Run: `task openapi:gen`
Expected: regenerates `openapi/generated/client.ts` and `api/internal/openapi/api.gen.go` with no manual edits needed. `git status` shows both regenerated.

- [ ] **Step 4: Commit**

```bash
git add openapi/openapi.yaml openapi/generated/client.ts api/internal/openapi/api.gen.go
git commit -m "feat(openapi): decision/released_at; drop accept/decline/waitlist paths"
```

---

## Task 4: Web — board, hook, components, tests

**Files:**
- Modify: `web/src/app/organiser/festivals/[id]/applications/page.tsx`
- Modify: `web/src/app/organiser/festivals/[id]/applications/useApplicationReview.ts`
- Modify: `web/src/components/ApplicationSlideOver.tsx`
- Modify: `web/src/app/(artist)/applications/page.tsx` (artist-facing status display)
- Modify: `web/src/app/organiser/festivals/[id]/page.tsx` (if it reads `decisions_released_at`)
- Test: `web/src/__tests__/organiser/applications-page.test.tsx`, `web/src/__tests__/components/ApplicationSlideOver.test.tsx`

- [ ] **Step 1: Write the failing board test**

In `applications-page.test.tsx`, replace the staged/released fixtures with decision-based ones and assert unconditional column placement:
```tsx
it('files a provisional accept (released_at null) in the Accept column', async () => {
  mockGet.mockImplementation(byPath({
    '/festivals/{festivalID}/applications': ok([
      { id: 'a1', decision: 'accept', released_at: null, shortlisted: false, review_flag: false, answers: {}, /* ...artist */ },
    ]),
    '/festivals/{festivalID}': ok({ id: 'f1', name: 'F' }),
    '/festivals/{festivalID}/reviewers': err(403),
    '/festivals/{festivalID}/form': ok({ fields: [] }),
  }))
  renderWithClient(<ApplicationsReviewPage params={Promise.resolve({ id: 'f1' })} />)
  const accept = await screen.findByText('✓ Accept')
  // assert the card appears under Accept (scope per existing test helpers)
})

it('files a released accept (released_at set) in the Accept column too', async () => { /* same, released_at: '2026-06-12T...' */ })

it('shows the released banner when any app has released_at', async () => { /* released_at set → "Decisions released" visible */ })
```

- [ ] **Step 2: Run it red**

Run (from `web/`): `npx vitest run src/__tests__/organiser/applications-page.test.tsx`
Expected: FAIL (board still reads `staged_decision`/`isReleased` from festival).

- [ ] **Step 3: Rewrite `getColumn` unconditional**

In `page.tsx` replace `getColumn`:
```ts
function getColumn(app: Application): ColumnKey {
  if (app.decision === 'accept') return 'accept'
  if (app.decision === 'waitlist') return 'waitlist'
  if (app.decision === 'decline') return 'decline'
  return app.shortlisted ? 'shortlisted' : 'undecided'
}
```
Update every `getColumn(app, isReleased)` call site to `getColumn(app)`. Replace `stagedCount`/`submittedUndecided` derivations to use `decision`:
```ts
const decidedCount = allApps.filter(a => a.decision !== 'undecided').length
const stillUndecided = allApps.filter(a => a.decision === 'undecided').length
```
(Use these in the header copy and the Release-button disabled logic.)

- [ ] **Step 4: Derive `isReleased` in the hook**

In `useApplicationReview.ts`: remove the `festivalData.decisions_released_at` read; compute
```ts
const isReleased = allApps.some(a => a.released_at != null)
const releasedAt = allApps.find(a => a.released_at != null)?.released_at ?? null
```
Change `stageMutation` to send `decision` (not `staged_decision`) in the PATCH body, and its optimistic write to set `a.decision`. Update `patchMutation` likewise (it forwards the existing decision). Update the `Application` type usage (now `decision`/`released_at` from the regenerated client).

- [ ] **Step 5: Update components**

`ApplicationSlideOver.tsx`: the decision buttons set `decision` via `onStage`; any `staged_decision`/`status` reads → `decision`. The "identity revealed after release" / read-only logic keys off `released_at != null`. `(artist)/applications/page.tsx`: render the artist's outcome from `decision` (now nullable — `null` ⇒ show "Pending / under review"; otherwise map accept/waitlist/decline to friendly copy). `organiser/festivals/[id]/page.tsx`: drop any `decisions_released_at` usage.

- [ ] **Step 6: Run board + component tests green**

Run (from `web/`): `npx vitest run src/__tests__/organiser/applications-page.test.tsx src/__tests__/components/ApplicationSlideOver.test.tsx`
Expected: PASS.

- [ ] **Step 7: Lint + full web tests**

Run (from `web/`): `task lint && task test`
Expected: PASS (only the 13 known `no-img-element` warnings). Fix any remaining `staged_decision`/`status`/`decisions_released_at` type errors `tsc` surfaces.

- [ ] **Step 8: Commit**

```bash
git add web/src
git commit -m "feat(web): board reads decision unconditionally; released_at drives release state"
```

---

## Task 5: Demo seed — decision column + invariant

**Files:**
- Modify: `demos/seed/main.go`

- [ ] **Step 1: Set `decision` directly, drop the festival_artists write**

Replace the interim `stagedDecisionFor` insert. Map the seed-yaml status to a `decision`, insert with `released_at` NULL (CPF stays un-released), and remove the `festival_artists` INSERT block (lineup rows now appear only on release/invite):
```go
func decisionFor(status string) string {
    switch status {
    case "accepted": return "accept"
    case "declined": return "decline"
    case "waitlisted": return "waitlist"
    default: return "undecided"
    }
}
// insert:
`INSERT INTO applications (form_id, artist_id, decision, answers)
 VALUES ($1, $2, $3, $4)` // released_at defaults NULL
// args: formID, s.profileID, decisionFor(s.a.Status), string(answers)
```
Delete the `if s.a.Status == "accepted" { INSERT INTO festival_artists ... }` block. Keep the spot-assignment loop (accepted artists are spot-eligible via the provisional `decision='accept'` path).

- [ ] **Step 2: Add the end-of-seed invariant assertion**

After all festivals are seeded, before the success print:
```go
var bad int
if err := conn.QueryRow(ctx, `
    SELECT count(*) FROM applications
    WHERE (decision = 'undecided' AND released_at IS NOT NULL)`).Scan(&bad); err != nil {
    log.Fatalf("invariant check failed: %v", err)
}
if bad > 0 {
    log.Fatalf("seed invariant violated: %d undecided applications have released_at set", bad)
}
```

- [ ] **Step 3: Build the seed**

Run: `go build -C demos/seed ./...`
Expected: success.

- [ ] **Step 4: Re-seed and verify in the browser**

Run: `task demos:seed` (note the new CPF festival id in the output).
Then verify the board: log in as `ladygabe@demo.art` / `demo-password-2027`, open `/organiser/festivals/<new-id>/applications`, confirm Accept=3, Waitlist=1, Decline=1, Undecided=4, and the festival page shows the three spot assignments.

- [ ] **Step 5: Commit**

```bash
git add demos/seed/main.go
git commit -m "feat(demos): seed decision column; lineup rows only on release"
```

---

## Task 6: e2e API gate

**Files:**
- Modify: `e2e/api/application-review.test.ts`
- Check/modify: any e2e spec hitting `/accept`, `/decline`, `/waitlist`, `staged_decision`, or `decisions_released_at`

- [ ] **Step 1: Find every e2e reference to the old shape**

Run:
```bash
grep -rln "staged_decision\|decisions_released_at\|/accept\|/decline\|applications/.*/waitlist\|\.status" e2e/
```
Expected list includes `application-review.test.ts` and possibly `me-applications.test.ts`, `spot-assignment-privacy.test.ts`, `profile-festivals.test.ts`. Fix each: PATCH bodies `staged_decision`→`decision`; assertions on `status`→`decision`/`released_at`; remove any direct-endpoint calls (route deleted → would 404).

- [ ] **Step 2: Rewrite the staged/release block in `application-review.test.ts`**

```ts
it('PATCH sets decision and keeps it provisional (no released_at, hidden from artist)', async () => {
  const patch = await fetch(`${API}/festivals/${festivalId}/applications/${applicationId}`, {
    method: 'PATCH', headers: json(org.token),
    body: JSON.stringify({ shortlisted: false, review_flag: false, decision: 'accept' }),
  })
  expect(patch.status).toBe(200)
  const body = await patch.json()
  expect(body.decision).toBe('accept')
  expect(body.released_at).toBeNull()
  // artist cannot see it yet
  const mine = await (await fetch(`${API}/me/applications`, { headers: auth(artist.token) })).json()
  expect(mine.find((a: {id:string}) => a.id === applicationId)?.decision ?? null).toBeNull()
})

it('release stamps released_at, keeps decision, makes the accept spot-eligible', async () => {
  const rel = await fetch(`${API}/festivals/${festivalId}/applications/release-decisions`,
    { method: 'POST', headers: auth(org.token) })
  expect(rel.status).toBe(200)
  const apps = await (await fetch(`${API}/festivals/${festivalId}/applications`, { headers: auth(org.token) })).json()
  const app = apps.find((a: {id:string}) => a.id === applicationId)
  expect(app.decision).toBe('accept')
  expect(app.released_at).not.toBeNull()
  // now a lineup member → appears in the unassigned-eligible pool
  const spots = await (await fetch(`${API}/festivals/${festivalId}/spots`, { headers: auth(org.token) })).json()
  expect(spots.unassigned_artists.some((u: {artist_id:string}) => u.artist_id === app.artist_id)).toBe(true)
})

it('second release with nothing new returns 409', async () => {
  const res = await fetch(`${API}/festivals/${festivalId}/applications/release-decisions`,
    { method: 'POST', headers: auth(org.token) })
  expect(res.status).toBe(409)
})
```
Keep the 422-undecided and 400-invalid-value cases, updating the field name to `decision`.

- [ ] **Step 3: Run the e2e gate**

Ensure stack is current (`task up`), then run: `task e2e:api`
Expected: PASS. (If a browser spec references the board, run `task e2e` for the full suite.)

- [ ] **Step 4: Commit**

```bash
git add e2e
git commit -m "test(e2e): decision/released_at model; spot-eligibility after release"
```

---

## Task 7: Spec + docs

**Files:**
- Modify: `api/internal/festival/festival.spec.md`
- Modify: `db/db.spec.md` (if it enumerates the applications/festival_artists columns)
- Modify: `.claude/rules/e2e-debugging.md` (the "Festival not found"/release notes mention `staged_decision`/`decisions_released_at`)

- [ ] **Step 1: Update `festival.spec.md`**

Update the Contract/Key Decisions/Invariants: decision is a single column; `released_at` per application is the publish fact; `festival_artists` is the lineup with `source`; direct accept/decline/waitlist endpoints removed. Add a changelog line:
```
2026-06-12 — decision-model redesign: applications.decision + released_at replace status/staged_decision/decisions_released_at; festival_artists.source; direct accept/decline/waitlist endpoints removed; release is transactional and idempotent (409 when nothing new).
```

- [ ] **Step 2: Update `db/db.spec.md` and the e2e-debugging rule**

Reflect the new columns and the removed `decisions_released_at`. In `.claude/rules/e2e-debugging.md`, update any pattern that references `staged_decision`/`decisions_released_at` to the new fields.

- [ ] **Step 3: Commit**

```bash
git add api/internal/festival/festival.spec.md db/db.spec.md .claude/rules/e2e-debugging.md
git commit -m "docs: decision-model redesign in specs and debugging rules"
```

---

## Final verification

- [ ] **Full stack green**

Run: `task lint` (web) · `task api:test` · `task test` (web) · `task e2e`
Expected: all PASS.

- [ ] **Manual board check**

Re-seed (`task demos:seed`), open the organiser applications board for CPF, confirm the three accepts sit in Accept and the festival page's spot assignments match — the original symptom is gone.

- [ ] **Open the PR** (per the user's PR workflow — branch is `fix/seed-staged-decisions`; consider renaming the branch to `feat/decision-model` before opening).

---

## Self-review notes

- **Spec coverage:** migration (T1), queries+handlers+drop-endpoints+transactional-release (T2), openapi (T3), web unconditional board (T4), seed (T5), tests api/web/e2e (T2/T4/T6), docs (T7) — every design section maps to a task.
- **Type consistency:** generated names assumed — `sqlcdb.ApplicationDecisionAccept`, `sqlcdb.FestivalArtistSourceApplication`, `Application.Decision`, `Application.ReleasedAt`, `AddFestivalArtistParams.Source`. Verify the exact generated identifiers after `task db:generate` in T2 Step 4 and adjust call sites if sqlc names them differently (e.g. `ApplicationDecisionAccept` vs `ApplicationDecisionTypeAccept`).
- **Known follow-up (out of scope):** the `POST /festivals/{id}/artists` invite endpoint (schema is ready via `source`).
