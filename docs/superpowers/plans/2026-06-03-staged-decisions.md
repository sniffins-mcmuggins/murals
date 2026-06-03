# Staged Decisions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the instant accept/decline/waitlist buttons with a 5-column drag kanban where decisions are staged server-side and released in one bulk action that emails all artists simultaneously.

**Architecture:** Add `staged_decision` (nullable text) to `applications` and `decisions_released_at` (nullable timestamptz) to `festivals`. Extend the existing PATCH endpoint to write `staged_decision`. Add a new `POST .../release-decisions` endpoint that bulk-commits all staged decisions, sends emails, and sets `decisions_released_at`. The web page is fully rewritten as a dnd-kit kanban; the existing tab/list UI is removed.

**Tech Stack:** Go + sqlc + pgx (API), Next.js App Router + @tanstack/react-query + @dnd-kit/core (web), golang-migrate (schema), openapi-typescript (TS types).

---

### Task 1: DB migration

**Files:**
- Create: `db/migrations/000022_staged_decisions.up.sql`
- Create: `db/migrations/000022_staged_decisions.down.sql`

- [ ] **Step 1: Create the up migration**

```sql
-- db/migrations/000022_staged_decisions.up.sql
ALTER TABLE applications
  ADD COLUMN staged_decision TEXT CHECK (staged_decision IN ('accept', 'waitlist', 'decline'));

ALTER TABLE festivals
  ADD COLUMN decisions_released_at TIMESTAMPTZ;
```

- [ ] **Step 2: Create the down migration**

```sql
-- db/migrations/000022_staged_decisions.down.sql
ALTER TABLE festivals DROP COLUMN decisions_released_at;
ALTER TABLE applications DROP COLUMN staged_decision;
```

- [ ] **Step 3: Apply the migration**

```bash
task db:migrate
```

Expected: `migrate: 1 migration(s) applied`

- [ ] **Step 4: Verify schema**

```bash
docker compose -f infra/docker-compose.yml exec db psql -U render -d render \
  -c "\d applications" | grep staged_decision
docker compose -f infra/docker-compose.yml exec db psql -U render -d render \
  -c "\d festivals" | grep decisions_released_at
```

Expected: both columns listed with correct types.

- [ ] **Step 5: Commit**

```bash
git add db/migrations/000022_staged_decisions.up.sql db/migrations/000022_staged_decisions.down.sql
git commit -m "feat(db): add staged_decision to applications and decisions_released_at to festivals"
```

---

### Task 2: sqlc queries + regenerate

**Files:**
- Modify: `db/queries/applications.sql`
- Modify: `db/queries/festivals.sql`
- Regenerated: `api/internal/sqlcdb/applications.sql.go`
- Regenerated: `api/internal/sqlcdb/festivals.sql.go`
- Regenerated: `api/internal/sqlcdb/models.go`

- [ ] **Step 1: Extend UpdateApplicationFlags to include staged_decision**

In `db/queries/applications.sql`, replace the existing `UpdateApplicationFlags` query:

```sql
-- name: UpdateApplicationFlags :one
UPDATE applications
SET shortlisted = $2, review_flag = $3, staged_decision = $4, updated_at = now()
WHERE id = $1
RETURNING *;
```

- [ ] **Step 2: Add query to list staged applications by festival**

Append to `db/queries/applications.sql`:

```sql
-- name: ListStagedApplicationsByFestival :many
SELECT a.*
FROM applications a
JOIN application_forms f ON a.form_id = f.id
WHERE f.festival_id = $1
  AND a.staged_decision IS NOT NULL;
```

- [ ] **Step 3: Add bulk-release query**

Append to `db/queries/applications.sql`:

```sql
-- name: ReleaseDecisionsForFestival :many
UPDATE applications a
SET
  status = CASE a.staged_decision
    WHEN 'accept'   THEN 'accepted'::application_status
    WHEN 'waitlist' THEN 'waitlisted'::application_status
    WHEN 'decline'  THEN 'declined'::application_status
  END,
  staged_decision = NULL,
  updated_at = now()
FROM application_forms f
WHERE a.form_id = f.id
  AND f.festival_id = $1
  AND a.staged_decision IS NOT NULL
RETURNING a.*;
```

- [ ] **Step 4: Add festival decisions_released_at setter**

Append to `db/queries/festivals.sql`:

```sql
-- name: SetFestivalDecisionsReleasedAt :one
UPDATE festivals
SET decisions_released_at = now(), updated_at = now()
WHERE id = $1
  AND decisions_released_at IS NULL
  AND deleted_at IS NULL
RETURNING *;
```

- [ ] **Step 5: Run code generation**

```bash
task db:generate
```

Expected: `Done. No errors.` (sqlc regenerates `api/internal/sqlcdb/`)

- [ ] **Step 6: Verify new fields appeared in models.go**

```bash
grep "StagedDecision\|DecisionsReleasedAt" api/internal/sqlcdb/models.go
```

Expected:
```
StagedDecision     pgtype.Text        `db:"staged_decision" json:"staged_decision"`
DecisionsReleasedAt pgtype.Timestamptz `db:"decisions_released_at" json:"decisions_released_at"`
```

- [ ] **Step 7: Check Scan counts are consistent (sqlc-and-schema.md checklist)**

```bash
grep -c '&i\.' api/internal/sqlcdb/applications.sql.go
```

Note the count — every SELECT and RETURNING block in that file should scan the same number of fields as columns in the `applications` table. The regenerated file handles this automatically via `task db:generate`, but verify no hand-edits were needed.

- [ ] **Step 8: Run API unit tests**

```bash
task api:test
```

Expected: all pass (compilation confirms new field is wired).

- [ ] **Step 9: Commit**

```bash
git add db/queries/applications.sql db/queries/festivals.sql api/internal/sqlcdb/
git commit -m "feat(db): add staged_decision queries and regenerate sqlc"
```

---

### Task 3: Go — extend response structs and PATCH handler

**Files:**
- Modify: `api/internal/festival/application.go` (response struct + mapping)
- Modify: `api/internal/festival/festival.go` (response struct + mapping)
- Modify: `api/internal/festival/patch.go` (handler body)
- Modify: `api/internal/festival/patch_test.go` (new test)

- [ ] **Step 1: Write failing test for staged_decision in PATCH**

Append to `api/internal/festival/patch_test.go`:

```go
func TestPatchApplicationStagedDecision(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupReviewScenario(t, db)

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Patch("/festivals/{festivalID}/applications/{applicationID}",
		festival.PatchApplicationHandler(db))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	// Stage as accept
	body := `{"shortlisted":false,"review_flag":false,"staged_decision":"accept"}`
	resp := doRequest(t, srv, "PATCH",
		"/festivals/"+sc.festID+"/applications/"+sc.applicationID,
		body, sc.orgToken)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var app map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&app))
	_ = resp.Body.Close()
	assert.Equal(t, "accept", app["staged_decision"])

	// Clear staged decision
	body = `{"shortlisted":false,"review_flag":false,"staged_decision":null}`
	resp = doRequest(t, srv, "PATCH",
		"/festivals/"+sc.festID+"/applications/"+sc.applicationID,
		body, sc.orgToken)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var app2 map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&app2))
	_ = resp.Body.Close()
	assert.Nil(t, app2["staged_decision"])
}
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
task api:test -- -run TestPatchApplicationStagedDecision
```

Expected: FAIL (compilation error — `staged_decision` not yet in request struct or response)

- [ ] **Step 3: Add StagedDecision to applicationResponse struct**

In `api/internal/festival/application.go`, find `type applicationResponse struct` (line ~49) and add `StagedDecision` after `ReviewFlag`:

```go
type applicationResponse struct {
	ID              string           `json:"id"`
	FormID          string           `json:"form_id"`
	ArtistID        string           `json:"artist_id"`
	Status          string           `json:"status"`
	Rank            int32            `json:"rank"`
	Shortlisted     bool             `json:"shortlisted"`
	ReviewFlag      bool             `json:"review_flag"`
	StagedDecision  *string          `json:"staged_decision"`
	Answers         json.RawMessage  `json:"answers"`
	CreatedAt       string           `json:"created_at"`
	UpdatedAt       string           `json:"updated_at"`
	AvgScore        *float64         `json:"avg_score"`
	ScoreCount      int32            `json:"score_count"`
	MyScore         *int32           `json:"my_score"`
	Artist          *artistSummary   `json:"artist,omitempty"`
	Notes           []noteResponse   `json:"notes"`
	IdentityHidden  bool             `json:"identity_hidden"`
	CriterionScores []criterionScore `json:"criterion_scores"`
}
```

- [ ] **Step 4: Add stagedDecisionPtr helper and update toApplicationResponse**

Add a small helper above `toApplicationResponse` in `api/internal/festival/application.go`:

```go
func stagedDecisionPtr(t pgtype.Text) *string {
	if !t.Valid {
		return nil
	}
	s := t.String
	return &s
}
```

Update `toApplicationResponse` to include the new field:

```go
func toApplicationResponse(a sqlcdb.Application) applicationResponse {
	return applicationResponse{
		ID:             a.ID.String(),
		FormID:         a.FormID.String(),
		ArtistID:       a.ArtistID.String(),
		Status:         string(a.Status),
		Rank:           a.Rank,
		Shortlisted:    a.Shortlisted,
		ReviewFlag:     a.ReviewFlag,
		StagedDecision: stagedDecisionPtr(a.StagedDecision),
		Answers:        a.Answers,
		CreatedAt:      a.CreatedAt.Time.Format(time.RFC3339),
		UpdatedAt:      a.UpdatedAt.Time.Format(time.RFC3339),
		Notes:          []noteResponse{},
		CriterionScores: []criterionScore{},
	}
}
```

- [ ] **Step 5: Update toEnrichedResponse and toEnrichedReviewerRow**

In `api/internal/festival/application.go`, find `toEnrichedResponse` (line ~86). Replace the `return applicationResponse{` block to add `StagedDecision`:

```go
func toEnrichedResponse(
	row sqlcdb.ListApplicationsByFormWithArtistRow,
) applicationResponse {
	mediumTags := row.MediumTags
	if mediumTags == nil {
		mediumTags = []string{}
	}
	return applicationResponse{
		ID:             row.ID.String(),
		FormID:         row.FormID.String(),
		ArtistID:       row.ArtistID.String(),
		Status:         string(row.Status),
		Rank:           row.Rank,
		Shortlisted:    row.Shortlisted,
		ReviewFlag:     row.ReviewFlag,
		StagedDecision: stagedDecisionPtr(row.StagedDecision),
		Answers:        row.Answers,
		CreatedAt:      row.CreatedAt.Time.Format(time.RFC3339),
		UpdatedAt:      row.UpdatedAt.Time.Format(time.RFC3339),
		Artist: &artistSummary{
			DisplayName:   row.DisplayName,
			AvatarS3Key:   row.AvatarS3Key,
			MediumTags:    mediumTags,
			LocationLabel: row.LocationLabel,
		},
		Notes:           []noteResponse{},
		CriterionScores: []criterionScore{},
	}
}
```

Find `toEnrichedReviewerRow` (line ~115) and apply the same change — add `StagedDecision: stagedDecisionPtr(row.StagedDecision)` after `ReviewFlag`:

```go
func toEnrichedReviewerRow(row sqlcdb.ListApplicationsByFormWithArtistExcludingReviewerRow) applicationResponse {
	mediumTags := row.MediumTags
	if mediumTags == nil {
		mediumTags = []string{}
	}
	return applicationResponse{
		ID:             row.ID.String(),
		FormID:         row.FormID.String(),
		ArtistID:       row.ArtistID.String(),
		Status:         string(row.Status),
		Rank:           row.Rank,
		Shortlisted:    row.Shortlisted,
		ReviewFlag:     row.ReviewFlag,
		StagedDecision: stagedDecisionPtr(row.StagedDecision),
		Answers:        row.Answers,
		CreatedAt:      row.CreatedAt.Time.Format(time.RFC3339),
		UpdatedAt:      row.UpdatedAt.Time.Format(time.RFC3339),
		Artist: &artistSummary{
			DisplayName:   row.DisplayName,
			AvatarS3Key:   row.AvatarS3Key,
			MediumTags:    mediumTags,
			LocationLabel: row.LocationLabel,
		},
		Notes:           []noteResponse{},
		CriterionScores: []criterionScore{},
	}
}
```

- [ ] **Step 6: Update PATCH handler to accept staged_decision**

In `api/internal/festival/patch.go`, replace the `req` struct and the `UpdateApplicationFlags` call:

```go
var req struct {
	Shortlisted    bool    `json:"shortlisted"`
	ReviewFlag     bool    `json:"review_flag"`
	StagedDecision *string `json:"staged_decision"`
}
if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
	httperr.BadRequest(w, "invalid request body")
	return
}

// Validate staged_decision value if provided
if req.StagedDecision != nil {
	valid := map[string]bool{"accept": true, "waitlist": true, "decline": true}
	if !valid[*req.StagedDecision] {
		httperr.BadRequest(w, "staged_decision must be accept, waitlist, or decline")
		return
	}
}

var sd pgtype.Text
if req.StagedDecision != nil {
	sd = pgtype.Text{String: *req.StagedDecision, Valid: true}
}

updated, err := q.UpdateApplicationFlags(r.Context(), sqlcdb.UpdateApplicationFlagsParams{
	ID:             appUUID,
	Shortlisted:    req.Shortlisted,
	ReviewFlag:     req.ReviewFlag,
	StagedDecision: sd,
})
```

Also add the `pgtype` import to `patch.go`:
```go
import (
	// ... existing imports ...
	"github.com/jackc/pgx/v5/pgtype"
)
```

- [ ] **Step 7: Add DecisionsReleasedAt to festivalResponse**

In `api/internal/festival/festival.go`, add the field to `festivalResponse`:

```go
type festivalResponse struct {
	ID                   string  `json:"id"`
	OrganiserID          string  `json:"organiser_id"`
	Name                 string  `json:"name"`
	Slug                 string  `json:"slug"`
	Description          string  `json:"description"`
	LocationLabel        string  `json:"location_label"`
	StartDate            *string `json:"start_date,omitempty"`
	EndDate              *string `json:"end_date,omitempty"`
	Status               string  `json:"status"`
	CreatedAt            string  `json:"created_at"`
	UpdatedAt            string  `json:"updated_at"`
	DecisionsReleasedAt  *string `json:"decisions_released_at,omitempty"`
}
```

Update `toFestivalResponse` to populate the new field (after the existing `StartDate`/`EndDate` block):

```go
if f.DecisionsReleasedAt.Valid {
	s := f.DecisionsReleasedAt.Time.Format(time.RFC3339)
	resp.DecisionsReleasedAt = &s
}
```

- [ ] **Step 8: Run the test to confirm it passes**

```bash
task api:test -- -run TestPatchApplicationStagedDecision
```

Expected: PASS

- [ ] **Step 9: Run full API test suite**

```bash
task api:test
```

Expected: all pass

- [ ] **Step 10: Commit**

```bash
git add api/internal/festival/
git commit -m "feat(api): expose staged_decision and decisions_released_at in responses; extend PATCH handler"
```

---

### Task 4: Go — ReleaseDecisionsHandler

**Files:**
- Create: `api/internal/festival/release.go`
- Create: `api/internal/festival/release_test.go`
- Modify: `api/cmd/api/main.go` (register route)

- [ ] **Step 1: Write failing tests**

Note: `doRequest` is defined in `api/internal/festival/festival_test.go` and is available to all `package festival_test` files. Use `auth.NoopMailer{}` (defined in `api/internal/auth/reset.go`) for the mailer.

Create `api/internal/festival/release_test.go`:

```go
package festival_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/festival"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

func TestReleaseDecisions_BulkUpdatesStatusAndPreventsRerelease(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupReviewScenario(t, db)

	srv := buildReleaseTestServer(t, db)

	// Stage the application as accept via PATCH
	patchBody := `{"shortlisted":false,"review_flag":false,"staged_decision":"accept"}`
	patchResp := doRequest(t, srv, "PATCH",
		"/festivals/"+sc.festID+"/applications/"+sc.applicationID,
		patchBody, sc.orgToken)
	require.Equal(t, http.StatusOK, patchResp.StatusCode)
	_ = patchResp.Body.Close()

	// Release decisions
	resp := doRequest(t, srv, "POST",
		"/festivals/"+sc.festID+"/applications/release-decisions",
		"", sc.orgToken)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var result map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&result))
	_ = resp.Body.Close()
	assert.Equal(t, float64(1), result["released"])

	// Second release attempt → 409
	resp2 := doRequest(t, srv, "POST",
		"/festivals/"+sc.festID+"/applications/release-decisions",
		"", sc.orgToken)
	require.Equal(t, http.StatusConflict, resp2.StatusCode)
	_ = resp2.Body.Close()
}

func TestReleaseDecisions_ForbiddenForNonOwner(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupReviewScenario(t, db)
	_, otherToken, _ := createTestUser(t, db)

	srv := buildReleaseTestServer(t, db)

	resp := doRequest(t, srv, "POST",
		"/festivals/"+sc.festID+"/applications/release-decisions",
		"", otherToken)
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	_ = resp.Body.Close()
}

func buildReleaseTestServer(t *testing.T, db *pgxpool.Pool) *httptest.Server {
	t.Helper()
	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	// literal route BEFORE parameterised — chi matches top-to-bottom
	r.Post("/festivals/{festivalID}/applications/release-decisions",
		festival.ReleaseDecisionsHandler(db, auth.NoopMailer{}))
	r.Patch("/festivals/{festivalID}/applications/{applicationID}",
		festival.PatchApplicationHandler(db))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return srv
}
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
task api:test -- -run TestReleaseDecisions
```

Expected: FAIL (ReleaseDecisionsHandler undefined)

- [ ] **Step 3: Implement ReleaseDecisionsHandler**

Create `api/internal/festival/release.go`:

```go
package festival

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

// ReleaseDecisionsHandler handles POST /festivals/{festivalID}/applications/release-decisions.
// Bulk-updates all staged decisions to final statuses, sends notification emails, and
// sets decisions_released_at. Returns 409 if already released.
func ReleaseDecisionsHandler(pool *pgxpool.Pool, mailer auth.EmailSender) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, err := auth.User(r.Context())
		if err != nil {
			httperr.Unauthorized(w)
			return
		}

		festUUID, err := pgUUIDFromString(chi.URLParam(r, "festivalID"))
		if err != nil {
			httperr.BadRequest(w, "invalid festivalID")
			return
		}

		q := sqlcdb.New(pool)
		fest, err := q.GetFestivalByID(r.Context(), festUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}
		if fest.OrganiserID.String() != principal.UserID {
			httperr.Forbidden(w)
			return
		}

		// Bulk-update staged decisions → final statuses
		released, err := q.ReleaseDecisionsForFestival(r.Context(), festUUID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		// Mark festival as released (returns no rows if already released → 409)
		_, err = q.SetFestivalDecisionsReleasedAt(r.Context(), festUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				// decisions_released_at was already set
				w.WriteHeader(http.StatusConflict)
				return
			}
			httperr.InternalServerError(w)
			return
		}

		// Send notification emails to all affected artists
		for _, app := range released {
			status := string(app.Status)
			sendApplicationNotification(pool, mailer, app.ArtistID, fest.Name, status)
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]int{"released": len(released)})
	}
}
```

- [ ] **Step 4: Register the route in main.go**

In `api/cmd/api/main.go`, find the block with the applications routes. Add the release route **before** the `{applicationID}` route:

```go
r.Post("/festivals/{festivalID}/applications/release-decisions", festival.ReleaseDecisionsHandler(pool, mailer))
r.Post("/festivals/{festivalID}/applications/reorder", festival.ReorderApplicationsHandler(pool))
r.Get("/festivals/{festivalID}/applications", festival.ListApplicationsHandler(pool, mailer))
// ... existing {applicationID} routes below ...
```

- [ ] **Step 5: Run the tests**

```bash
task api:test -- -run TestReleaseDecisions
```

Expected: PASS

- [ ] **Step 6: Run full suite**

```bash
task api:test
```

Expected: all pass

- [ ] **Step 7: Commit**

```bash
git add api/internal/festival/release.go api/internal/festival/release_test.go api/cmd/api/main.go
git commit -m "feat(api): ReleaseDecisionsHandler — bulk-commit staged decisions and notify artists"
```

---

### Task 5: OpenAPI spec + TS codegen

**Files:**
- Modify: `openapi/openapi.yaml`
- Regenerated: `openapi/client/` (via `task openapi:gen`)

- [ ] **Step 1: Add staged_decision to Application schema**

In `openapi/openapi.yaml`, find the `Application:` schema (line ~543). Add `staged_decision` after `review_flag`:

```yaml
        staged_decision:
          type: string
          nullable: true
          enum: [accept, waitlist, decline]
          description: Organiser's staged decision — null until dragged to a column
```

- [ ] **Step 2: Add decisions_released_at to Festival schema**

In `openapi/openapi.yaml`, find the `Festival:` schema (line ~409). Add after `updated_at`:

```yaml
        decisions_released_at:
          type: string
          format: date-time
          nullable: true
          description: Set once when Release Decisions is triggered; null until then
```

- [ ] **Step 3: Update PATCH requestBody to include staged_decision**

In `openapi/openapi.yaml`, find the PATCH `/festivals/{festivalID}/applications/{applicationID}` requestBody (line ~2468). Replace the schema:

```yaml
            schema:
              type: object
              required: [shortlisted, review_flag]
              properties:
                shortlisted:
                  type: boolean
                review_flag:
                  type: boolean
                staged_decision:
                  type: string
                  nullable: true
                  enum: [accept, waitlist, decline]
```

- [ ] **Step 4: Add release-decisions endpoint**

In `openapi/openapi.yaml`, after the `/festivals/{festivalID}/applications/reorder` block, add:

```yaml
  /festivals/{festivalID}/applications/release-decisions:
    post:
      tags: [festival]
      summary: Release all staged decisions and notify artists
      security:
        - bearerAuth: []
      parameters:
        - name: festivalID
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        "200":
          description: Decisions released
          content:
            application/json:
              schema:
                type: object
                properties:
                  released:
                    type: integer
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
        "404":
          $ref: "#/components/responses/NotFound"
        "409":
          description: Decisions already released
```

- [ ] **Step 5: Run codegen**

```bash
task openapi:gen
```

Expected: exits 0, updated files in `openapi/client/`

- [ ] **Step 6: Verify new types appear**

```bash
grep "staged_decision\|decisions_released_at\|release-decisions" openapi/client/types.gen.ts | head -10
```

Expected: all three appear in the generated types.

- [ ] **Step 7: Run openapi tests**

```bash
task openapi:test
```

Expected: pass

- [ ] **Step 8: Commit**

```bash
git add openapi/openapi.yaml openapi/client/
git commit -m "feat(openapi): add staged_decision, decisions_released_at, release-decisions endpoint"
```

---

### Task 6: Web — kanban page shell + compact card

**Files:**
- Create: `web/src/components/KanbanColumn.tsx`
- Rewrite: `web/src/app/organiser/festivals/[id]/applications/page.tsx`
- Modify: `web/src/components/ApplicationCard.tsx`

- [ ] **Step 1: Create KanbanColumn component**

Create `web/src/components/KanbanColumn.tsx`:

```tsx
'use client'

import { useDroppable } from '@dnd-kit/core'

interface Props {
  id: string
  label: string
  count: number
  headerClass: string
  borderColor: string
  children: React.ReactNode
  isReleased?: boolean
}

export function KanbanColumn({ id, label, count, headerClass, borderColor, children, isReleased }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id })

  return (
    <div
      ref={isReleased ? undefined : setNodeRef}
      className={`flex flex-col gap-1 transition-colors ${isOver ? 'bg-warm/60 rounded-lg' : ''}`}
    >
      <div className={`font-mono text-xs font-bold uppercase tracking-widest mb-2 pb-1 border-b-2 ${headerClass} ${borderColor}`}>
        {label} <span className="text-light font-normal">({count})</span>
      </div>
      <div className="flex flex-col gap-2">
        {children}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Rewrite the applications page**

Replace all contents of `web/src/app/organiser/festivals/[id]/applications/page.tsx` with:

```tsx
'use client'

import { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { DndContext, DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import Link from 'next/link'
import { apiClient } from '@/lib/api'
import { ApplicationCard } from '@/components/ApplicationCard'
import { ApplicationSlideOver } from '@/components/ApplicationSlideOver'
import { KanbanColumn } from '@/components/KanbanColumn'
import type { components } from '@render/api-client'

type Application = components['schemas']['Application']

interface FormField { id: string; label: string; type: string; required: boolean }
interface ReviewCriterion { id: string; label: string; min: number; max: number }

type ColumnKey = 'undecided' | 'shortlisted' | 'accept' | 'waitlist' | 'decline'

const COLUMN_META: Record<ColumnKey, { label: string; headerClass: string; borderColor: string }> = {
  undecided:  { label: 'Undecided',   headerClass: 'text-mid',    borderColor: 'border-light' },
  shortlisted:{ label: '⭐ Shortlisted',headerClass: 'text-amber',  borderColor: 'border-amber' },
  accept:     { label: '✓ Accept',    headerClass: 'text-green-700',borderColor: 'border-green-500' },
  waitlist:   { label: '~ Waitlist',  headerClass: 'text-amber',  borderColor: 'border-amber' },
  decline:    { label: '✗ Decline',   headerClass: 'text-clay',   borderColor: 'border-clay' },
}

function getColumn(app: Application, isReleased: boolean): ColumnKey {
  if (isReleased) {
    if (app.status === 'accepted') return 'accept'
    if (app.status === 'waitlisted') return 'waitlist'
    if (app.status === 'declined') return 'decline'
    return app.shortlisted ? 'shortlisted' : 'undecided'
  }
  if (app.staged_decision === 'accept') return 'accept'
  if (app.staged_decision === 'waitlist') return 'waitlist'
  if (app.staged_decision === 'decline') return 'decline'
  if (app.shortlisted) return 'shortlisted'
  return 'undecided'
}

const REVIEWER_SENTINEL = 'REVIEWER' as const

type Props = { params: Promise<{ id: string }> }

export default function ApplicationsReviewPage({ params }: Props) {
  const [festivalId, setFestivalId] = useState<string | null>(null)
  if (!festivalId) {
    params.then(p => setFestivalId(p.id))
    return <div className="font-sans text-mid text-sm p-8">Loading…</div>
  }
  return <KanbanView festivalId={festivalId} />
}

function KanbanView({ festivalId }: { festivalId: string }) {
  const [selectedApp, setSelectedApp] = useState<Application | null>(null)
  const [localApps, setLocalApps] = useState<Application[] | null>(null)
  const [showReleaseModal, setShowReleaseModal] = useState(false)
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

  const festivalQuery = useQuery({
    queryKey: ['festival', festivalId],
    queryFn: async () => {
      const res = await apiClient.GET('/festivals/{festivalID}', {
        params: { path: { festivalID: festivalId } },
      })
      if (res.error) throw new Error('Failed to load festival')
      return res.data
    },
  })

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

  useEffect(() => {
    if (applicationsQuery.data) setLocalApps(applicationsQuery.data)
  }, [applicationsQuery.data])

  useEffect(() => {
    if (!applicationsQuery.data) return
    setSelectedApp(prev => {
      if (!prev) return prev
      const fresh = applicationsQuery.data.find((a: Application) => a.id === prev.id)
      return fresh ?? prev
    })
  }, [applicationsQuery.data])

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['festival-applications', festivalId] })

  const stageMutation = useMutation({
    mutationFn: async ({ appId, stagedDecision, shortlisted, reviewFlag }: {
      appId: string
      stagedDecision: string | null
      shortlisted: boolean
      reviewFlag: boolean
    }) => {
      const res = await apiClient.PATCH('/festivals/{festivalID}/applications/{applicationID}', {
        params: { path: { festivalID: festivalId, applicationID: appId } },
        body: { shortlisted, review_flag: reviewFlag, staged_decision: stagedDecision as never },
      })
      if (res.error) throw new Error('Stage failed')
    },
    onMutate: ({ appId, stagedDecision, shortlisted }) => {
      const snapshot = localApps
      setLocalApps(prev => prev?.map(a =>
        a.id === appId ? { ...a, staged_decision: stagedDecision, shortlisted } : a
      ) ?? null)
      return { snapshot }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.snapshot !== undefined) setLocalApps(ctx.snapshot)
    },
    onSuccess: invalidate,
  })

  const releaseMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.POST('/festivals/{festivalID}/applications/release-decisions', {
        params: { path: { festivalID: festivalId } },
      })
      if (res.error) throw new Error('Release failed')
      return res.data
    },
    onSuccess: () => {
      setShowReleaseModal(false)
      queryClient.invalidateQueries({ queryKey: ['festival-applications', festivalId] })
      queryClient.invalidateQueries({ queryKey: ['festival', festivalId] })
    },
  })

  const patchMutation = useMutation({
    mutationFn: async ({ id, shortlisted, reviewFlag }: { id: string; shortlisted: boolean; reviewFlag: boolean }) => {
      const app = (localApps ?? []).find(a => a.id === id)
      const res = await apiClient.PATCH('/festivals/{festivalID}/applications/{applicationID}', {
        params: { path: { festivalID: festivalId, applicationID: id } },
        body: {
          shortlisted,
          review_flag: reviewFlag,
          staged_decision: (app?.staged_decision ?? null) as never,
        },
      })
      if (res.error) throw new Error('Patch failed')
    },
    onMutate: ({ id, shortlisted }) => {
      const snapshot = localApps
      setLocalApps(prev => prev?.map(a => a.id === id ? { ...a, shortlisted } : a) ?? null)
      return { snapshot }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.snapshot !== undefined) setLocalApps(ctx.snapshot)
    },
    onSuccess: invalidate,
  })

  const scoreMutation = useMutation({
    mutationFn: async ({ applicationId, score, criterionId }: {
      applicationId: string; score: number; criterionId: string
    }) => {
      const res = await apiClient.PUT('/festivals/{festivalID}/applications/{applicationID}/score', {
        params: { path: { festivalID: festivalId, applicationID: applicationId } },
        body: criterionId === 'overall' ? { score } : { score, criterion_id: criterionId },
      })
      if (res.error) throw new Error('Score failed')
    },
    onMutate: ({ applicationId, score, criterionId }) => {
      const snapshot = localApps
      setLocalApps(prev => prev?.map(a => {
        if (a.id !== applicationId) return a
        if (criterionId === 'overall') return { ...a, my_score: score }
        const criterionScores = (a.criterion_scores ?? []).map(
          (cs: NonNullable<Application['criterion_scores']>[number]) =>
            cs.criterion_id === criterionId ? { ...cs, my_score: score } : cs
        )
        const scored = criterionScores.filter(
          (cs: NonNullable<Application['criterion_scores']>[number]) => cs.my_score != null
        )
        const mean = scored.length > 0
          ? Math.round(scored.reduce((s: number, cs: NonNullable<Application['criterion_scores']>[number]) => s + (cs.my_score ?? 0), 0) / scored.length)
          : a.my_score
        return { ...a, criterion_scores: criterionScores, my_score: mean }
      }) ?? null)
      return { snapshot }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.snapshot !== undefined) setLocalApps(ctx.snapshot)
    },
    onSuccess: invalidate,
  })

  const handleScore = (applicationId: string, score: number, criterionId = 'overall') => {
    scoreMutation.mutate({ applicationId, score, criterionId })
    if (selectedApp?.id === applicationId) {
      if (criterionId === 'overall') {
        setSelectedApp(prev => prev ? { ...prev, my_score: score } : null)
      } else {
        setSelectedApp(prev => {
          if (!prev) return null
          const criterionScores = (prev.criterion_scores ?? []).map(
            (cs: NonNullable<Application['criterion_scores']>[number]) =>
              cs.criterion_id === criterionId ? { ...cs, my_score: score } : cs
          )
          const scored = criterionScores.filter(
            (cs: NonNullable<Application['criterion_scores']>[number]) => cs.my_score != null
          )
          const mean = scored.length > 0
            ? Math.round(scored.reduce((s: number, cs: NonNullable<Application['criterion_scores']>[number]) => s + (cs.my_score ?? 0), 0) / scored.length)
            : prev.my_score
          return { ...prev, criterion_scores: criterionScores, my_score: mean }
        })
      }
    }
  }

  const allApps = localApps ?? applicationsQuery.data ?? []
  const isReleased = !!(festivalQuery.data as { decisions_released_at?: string | null })?.decisions_released_at

  const columns = useMemo<Record<ColumnKey, Application[]>>(() => {
    const result: Record<ColumnKey, Application[]> = {
      undecided: [], shortlisted: [], accept: [], waitlist: [], decline: [],
    }
    for (const app of allApps) {
      result[getColumn(app, isReleased)].push(app)
    }
    return result
  }, [allApps, isReleased])

  const stagedCount = allApps.filter(a => a.staged_decision != null).length

  const sensors = useSensors(useSensor(PointerSensor))

  const handleDragEnd = (event: DragEndEvent) => {
    if (isReleased) return
    const { active, over } = event
    if (!over || active.id === over.id) return

    const appId = active.id as string
    const targetColumn = over.id as ColumnKey
    const app = allApps.find(a => a.id === appId)
    if (!app) return

    const decisionMap: Record<string, string | null> = {
      accept: 'accept', waitlist: 'waitlist', decline: 'decline',
      undecided: null, shortlisted: null,
    }
    if (!(targetColumn in decisionMap)) return

    stageMutation.mutate({
      appId,
      stagedDecision: decisionMap[targetColumn],
      shortlisted: targetColumn === 'shortlisted',
      reviewFlag: app.review_flag ?? false,
    })
  }

  const formFields: FormField[] = (formQuery.data as { fields?: FormField[] })?.fields ?? []
  const criteria: ReviewCriterion[] = (formQuery.data as { review_criteria?: ReviewCriterion[] })?.review_criteria ?? []
  const isPending = stageMutation.isPending || patchMutation.isPending || scoreMutation.isPending

  const releasedAt = (festivalQuery.data as { decisions_released_at?: string | null })?.decisions_released_at

  return (
    <div>
      <div className="mb-6">
        <Link href={`/organiser/festivals/${festivalId}`}
          className="font-mono text-xs text-mid uppercase tracking-widest hover:text-ink transition-colors">
          ← Festival
        </Link>
      </div>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="font-serif text-4xl text-ink">Applications</h1>
          {!isReleased && (
            <p className="font-mono text-xs text-mid mt-1 uppercase tracking-widest">
              {allApps.length} total · {stagedCount} staged
            </p>
          )}
        </div>
        {!isReviewer && !isReleased && (
          <button
            onClick={() => setShowReleaseModal(true)}
            disabled={stagedCount === 0}
            className="font-sans text-sm font-bold bg-amber text-ink px-5 py-2.5 rounded-lg hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Release {stagedCount > 0 ? `${stagedCount} ` : ''}decisions →
          </button>
        )}
      </div>

      {/* Released banner */}
      {isReleased && releasedAt && (
        <div className="bg-ink text-offwhite rounded-lg px-5 py-3 mb-6 flex justify-between items-center">
          <div>
            <span className="font-sans text-sm font-bold text-amber">Decisions released</span>
            <span className="font-mono text-xs text-mid ml-3">
              {new Date(releasedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
              {' · '}artists notified by email
            </span>
          </div>
          <span className="font-mono text-xs text-mid uppercase tracking-widest">read-only</span>
        </div>
      )}

      {applicationsQuery.isError && (
        <p role="alert" className="font-sans text-sm text-clay mb-4">Failed to load applications.</p>
      )}

      {applicationsQuery.isLoading ? (
        <p className="font-sans text-mid text-sm">Loading…</p>
      ) : (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <div className="grid grid-cols-5 gap-4">
            {(Object.keys(COLUMN_META) as ColumnKey[]).map(col => (
              <KanbanColumn
                key={col}
                id={col}
                label={COLUMN_META[col].label}
                count={columns[col].length}
                headerClass={COLUMN_META[col].headerClass}
                borderColor={COLUMN_META[col].borderColor}
                isReleased={isReleased}
              >
                {columns[col].map(app => (
                  <ApplicationCard
                    key={app.id}
                    application={app}
                    onSelect={setSelectedApp}
                    onToggleShortlist={(id, shortlisted, reviewFlag) =>
                      patchMutation.mutate({ id, shortlisted: !shortlisted, reviewFlag })
                    }
                    onScore={handleScore}
                    isReviewer={isReviewer}
                    isPending={isPending}
                    criteria={criteria}
                    isDraggable={!isReleased && !isReviewer}
                    columnKey={col}
                    isReleased={isReleased}
                  />
                ))}
                {columns[col].length === 0 && (
                  <div className="border border-dashed border-light rounded-lg p-3 text-center">
                    <span className="font-mono text-xs text-light">empty</span>
                  </div>
                )}
              </KanbanColumn>
            ))}
          </div>
        </DndContext>
      )}

      {/* Release confirmation modal */}
      {showReleaseModal && (
        <div className="fixed inset-0 bg-ink/40 z-50 flex items-center justify-center">
          <div className="bg-offwhite rounded-xl p-8 max-w-sm w-full mx-4 shadow-xl">
            <h2 className="font-serif text-2xl text-ink mb-2">Release decisions?</h2>
            <p className="font-sans text-sm text-mid mb-6">
              Send decisions to {stagedCount} {stagedCount === 1 ? 'artist' : 'artists'}? This can&apos;t be undone — all artists will be notified by email at the same time.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowReleaseModal(false)}
                className="font-sans text-sm text-mid border border-light px-4 py-2 rounded-lg hover:opacity-80"
              >
                Cancel
              </button>
              <button
                onClick={() => releaseMutation.mutate()}
                disabled={releaseMutation.isPending}
                className="font-sans text-sm font-bold bg-amber text-ink px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50"
              >
                {releaseMutation.isPending ? 'Sending…' : 'Yes, release'}
              </button>
            </div>
            {releaseMutation.isError && (
              <p className="font-sans text-xs text-clay mt-3">Failed to release. Please try again.</p>
            )}
          </div>
        </div>
      )}

      <ApplicationSlideOver
        application={selectedApp}
        formFields={formFields}
        festivalId={festivalId}
        onClose={() => setSelectedApp(null)}
        onStage={(id, decision) => {
          const app = allApps.find(a => a.id === id)
          if (!app) return
          stageMutation.mutate({
            appId: id,
            stagedDecision: decision,
            shortlisted: app.shortlisted ?? false,
            reviewFlag: app.review_flag ?? false,
          })
        }}
        onScore={handleScore}
        isReviewer={isReviewer}
        isPending={isPending}
        criteria={criteria}
        isReleased={isReleased}
      />
    </div>
  )
}
```

- [ ] **Step 3: Update ApplicationCard to kanban-compact mode**

Replace all contents of `web/src/components/ApplicationCard.tsx` with:

```tsx
'use client'

import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import type { components } from '@render/api-client'

type Application = components['schemas']['Application']
type ApplicationArtist = components['schemas']['ApplicationArtist']

interface ReviewCriterion { id: string; label: string; min: number; max: number }

interface Props {
  application: Application
  onSelect: (app: Application) => void
  onToggleShortlist: (id: string, current: boolean, reviewFlag: boolean) => void
  onScore: (id: string, score: number, criterionId?: string) => void
  isReviewer: boolean
  isPending: boolean
  criteria: ReviewCriterion[]
  isDraggable: boolean
  columnKey: string
  isReleased: boolean
}

function initials(name: string): string {
  return name.split(' ').slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('')
}

export function ApplicationCard({
  application, onSelect, onToggleShortlist, onScore,
  isReviewer, isPending, criteria, isDraggable, columnKey, isReleased,
}: Props) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: application.id ?? '', disabled: !isDraggable })

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
  }

  const artist = application.artist as ApplicationArtist | undefined
  const isAnonymous = application.identity_hidden === true
  const name = isAnonymous ? 'Anonymous artist' : (artist?.display_name ?? 'Unknown Artist')
  const tags = artist?.medium_tags ?? []
  const id = application.id ?? ''
  const myScore = application.my_score
  const avgScore = application.avg_score
  const scoreCount = application.score_count ?? 0
  const showAvg = avgScore != null && scoreCount > 0

  const decisionColorMap: Record<string, string> = {
    accept:   'bg-green-50 border-green-200',
    waitlist: 'bg-amber/10 border-amber/30',
    decline:  'bg-red-50 border-red-200',
  }
  const isDecisionColumn = ['accept', 'waitlist', 'decline'].includes(columnKey)
  const cardBg = isDecisionColumn
    ? (decisionColorMap[columnKey] ?? 'bg-warm border-light')
    : 'bg-warm border-light'

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-start gap-2 p-3 ${cardBg} border rounded-lg cursor-pointer ${isReleased && isDecisionColumn ? 'opacity-100' : ''} ${!isDecisionColumn && isReleased ? 'opacity-60' : ''}`}
      onClick={() => onSelect(application)}
    >
      {/* Drag handle */}
      {isDraggable && (
        <button
          {...attributes}
          {...listeners}
          className="mt-0.5 cursor-grab text-light hover:text-mid touch-none flex-shrink-0 text-sm"
          aria-label="Drag to reorder"
          tabIndex={-1}
          onClick={e => e.stopPropagation()}
        >
          ⠿
        </button>
      )}

      {/* Avatar */}
      <div className="w-8 h-8 rounded-full bg-clay flex items-center justify-center text-offwhite font-bold text-xs flex-shrink-0">
        {isAnonymous ? '?' : initials(name)}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="font-sans font-semibold text-ink text-xs truncate">{name}</div>
        {tags.length > 0 && (
          <div className="flex gap-1 flex-wrap mt-0.5">
            {tags.slice(0, 2).map(tag => (
              <span key={tag} className="font-mono text-xs text-mid bg-white border border-light rounded px-1 py-0.5 uppercase tracking-wider" style={{ fontSize: '9px' }}>
                {tag}
              </span>
            ))}
          </div>
        )}
        {isReleased && isDecisionColumn && (
          <div className="font-mono text-xs text-mid mt-0.5" style={{ fontSize: '9px' }}>
            Notified ✓
          </div>
        )}
      </div>

      {/* Right slot */}
      <div className="flex flex-col items-end gap-1 flex-shrink-0">
        {showAvg && (
          <span className="font-mono text-mid" style={{ fontSize: '9px' }}>★ {avgScore?.toFixed(1)}</span>
        )}
        {!isReviewer && !isReleased && (
          <button
            onClick={e => {
              e.stopPropagation()
              onToggleShortlist(id, application.shortlisted ?? false, application.review_flag ?? false)
            }}
            disabled={isPending}
            className={`text-sm leading-none ${application.shortlisted ? 'text-amber' : 'text-light hover:text-mid'} disabled:opacity-50`}
            title={application.shortlisted ? 'Remove shortlist' : 'Shortlist'}
          >
            ⭐
          </button>
        )}
        {isReviewer && !isAnonymous && (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onSelect(application) }}
            className="font-sans border border-light rounded px-1.5 py-0.5 hover:border-amber hover:text-ink transition-colors text-mid"
            style={{ fontSize: '9px' }}
          >
            {myScore != null ? 'Edit score' : 'Score'}
          </button>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run web type-check**

```bash
task web:typecheck
```

Fix any type errors before proceeding. Common ones: `useDraggable` vs `useSortable` import path; `staged_decision` type mismatch (the generated type may be `string | null | undefined`).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/KanbanColumn.tsx web/src/components/ApplicationCard.tsx web/src/app/organiser/festivals/
git commit -m "feat(web): 5-column kanban application page with compact cards"
```

---

### Task 7: Web — ApplicationSlideOver decision selector

**Files:**
- Modify: `web/src/components/ApplicationSlideOver.tsx`

- [ ] **Step 1: Replace action buttons with staged-decision pills**

In `web/src/components/ApplicationSlideOver.tsx`:

1. Update the `Props` interface — remove `onAccept`, `onDecline`, `onWaitlist`, add `onStage` and `isReleased`:

```tsx
interface Props {
  application: Application | null
  formFields: FormField[]
  festivalId: string
  onClose: () => void
  onStage: (id: string, decision: string | null) => void
  onScore: (id: string, score: number, criterionId?: string) => void
  isReviewer: boolean
  isPending: boolean
  criteria: ReviewCriterion[]
  isReleased: boolean
}
```

2. Update the function signature to match.

3. Replace the `ACTION_TRANSITIONS` block and the `{/* Actions — owner only */}` section with:

```tsx
{/* Staged decision — owner only, pre-release */}
{!isReviewer && !isReleased && (
  <div>
    <h3 className="font-mono text-xs text-mid uppercase tracking-widest mb-2">Decision</h3>
    <div className="flex gap-2 flex-wrap">
      {(['accept', 'waitlist', 'decline'] as const).map(decision => {
        const isActive = application.staged_decision === decision
        const styles = {
          accept:  isActive ? 'bg-green-100 border-green-400 text-green-800' : 'border-light text-mid hover:border-green-300',
          waitlist:isActive ? 'bg-amber/20 border-amber text-ink' : 'border-light text-mid hover:border-amber',
          decline: isActive ? 'bg-red-100 border-red-400 text-clay' : 'border-light text-mid hover:border-red-300',
        }
        return (
          <button
            key={decision}
            onClick={() => onStage(id, isActive ? null : decision)}
            disabled={isPending}
            className={`font-sans text-xs border px-3 py-1.5 rounded-lg capitalize transition-colors disabled:opacity-50 ${styles[decision]}`}
          >
            {decision === 'accept' ? '✓ Accept' : decision === 'waitlist' ? '~ Waitlist' : '✗ Decline'}
          </button>
        )
      })}
    </div>
    {application.staged_decision && (
      <button
        onClick={() => onStage(id, null)}
        disabled={isPending}
        className="font-mono text-xs text-mid hover:text-ink mt-1 disabled:opacity-50"
      >
        Unstage
      </button>
    )}
  </div>
)}

{/* Post-release status badge */}
{!isReviewer && isReleased && (
  <div>
    <h3 className="font-mono text-xs text-mid uppercase tracking-widest mb-2">Decision</h3>
    <span className={`font-mono text-xs uppercase tracking-widest px-2 py-1 rounded ${
      application.status === 'accepted' ? 'bg-green-100 text-green-800' :
      application.status === 'waitlisted' ? 'bg-amber/20 text-ink' :
      application.status === 'declined' ? 'bg-red-100 text-clay' :
      'bg-warm text-mid'
    }`}>
      {application.status}
    </span>
  </div>
)}
```

- [ ] **Step 2: Run web type-check**

```bash
task web:typecheck
```

Expected: pass (or fix remaining type errors from `staged_decision` nullability)

- [ ] **Step 3: Commit**

```bash
git add web/src/components/ApplicationSlideOver.tsx
git commit -m "feat(web): replace accept/decline/waitlist buttons with staged-decision selector in slide-over"
```

---

### Task 8: E2E tests

**Files:**
- Modify: `e2e/api/application-review.test.ts` (create if doesn't exist, or add to `golden-path.test.ts`)
- Modify: `e2e/browser/application-flow.spec.ts`

- [ ] **Step 1: Check if a dedicated review test file exists**

```bash
ls e2e/api/
```

If `application-review.test.ts` exists, add to it. Otherwise add a new describe block to `e2e/api/golden-path.test.ts`.

- [ ] **Step 2: Add API e2e tests for stage + release flow**

Add to the appropriate e2e API test file:

```typescript
import { createOrganiser, createArtist, API } from './helpers'

describe('Staged decisions', () => {
  const suffix = Date.now()

  let orgToken: string
  let festivalId: string
  let applicationId: string

  beforeAll(async () => {
    // Create organiser + festival
    const org = await createOrganiser(`org-stage-${suffix}@e2e.test`)
    orgToken = org.token

    const festRes = await fetch(`${API}/festivals`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${orgToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `Stage Test ${suffix}`, slug: `stage-${suffix}`, description: '', status: 'open' }),
    })
    const fest = await festRes.json()
    festivalId = fest.id

    // Create form
    const formRes = await fetch(`${API}/festivals/${festivalId}/form`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${orgToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: [] }),
    })
    expect(formRes.status).toBe(200)

    // Create artist + submit application
    const artist = await createArtist(`artist-stage-${suffix}@e2e.test`)
    const appRes = await fetch(`${API}/festivals/${festivalId}/applications`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${artist.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: {} }),
    })
    const app = await appRes.json()
    applicationId = app.id
  })

  it('stages a decision via PATCH', async () => {
    const res = await fetch(`${API}/festivals/${festivalId}/applications/${applicationId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${orgToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ shortlisted: false, review_flag: false, staged_decision: 'accept' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.staged_decision).toBe('accept')
    expect(body.status).toBe('submitted') // status unchanged — not yet released
  })

  it('releases decisions and notifies artists', async () => {
    const res = await fetch(`${API}/festivals/${festivalId}/applications/release-decisions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${orgToken}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.released).toBe(1)

    // Verify application status is now accepted
    const listRes = await fetch(`${API}/festivals/${festivalId}/applications`, {
      headers: { Authorization: `Bearer ${orgToken}` },
    })
    const apps = await listRes.json()
    const app = apps.find((a: { id: string }) => a.id === applicationId)
    expect(app.status).toBe('accepted')
    expect(app.staged_decision).toBeNull()
  })

  it('returns 409 on second release attempt', async () => {
    const res = await fetch(`${API}/festivals/${festivalId}/applications/release-decisions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${orgToken}` },
    })
    expect(res.status).toBe(409)
  })

  it('festival response includes decisions_released_at after release', async () => {
    const res = await fetch(`${API}/festivals/${festivalId}`, {
      headers: { Authorization: `Bearer ${orgToken}` },
    })
    const fest = await res.json()
    expect(fest.decisions_released_at).not.toBeNull()
  })
})
```

- [ ] **Step 3: Ensure the stack is running**

```bash
curl -sf http://localhost:8080/healthz
```

If not running: `task up` then wait for health check.

- [ ] **Step 4: Run the e2e API tests**

```bash
task e2e:api
```

Expected: all tests pass including the new `Staged decisions` suite.

- [ ] **Step 5: Commit**

```bash
git add e2e/
git commit -m "test(e2e): staged decisions — stage, release, 409 guard, festival timestamp"
```

---

## Self-Review Checklist

Run through this after completing all tasks:

- [ ] `task api:test` passes
- [ ] `task web:typecheck` passes
- [ ] `task e2e:api` passes
- [ ] Manually drag a card to Accept on the running app and confirm it persists after page refresh
- [ ] Manually click Release and confirm the banner appears and dragging is disabled
- [ ] Confirm the slide-over shows the correct staged-decision pills (active/inactive) on a pre-release card
- [ ] Confirm the slide-over shows the status badge (not pills) on a post-release card
