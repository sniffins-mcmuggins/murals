# Phase 10: Multi-Criteria Scoring Rubric — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend reviewer scoring from a single 1–5 value to a configurable per-criterion rubric that organisers define per festival; when no criteria are configured behaviour is identical to today.

**Architecture:** `criterion_id text NOT NULL DEFAULT 'overall'` added to `application_scores` (PK becomes 3-column); `review_criteria jsonb DEFAULT '[]'` on `application_forms`. The score endpoint accepts an optional `criterion_id` (defaults to `'overall'`); the list endpoint assembles `criterion_scores []` per application. All existing single-star behaviour is unchanged when criteria array is empty.

**Tech Stack:** Go 1.22 (chi, pgx, sqlc), Postgres, Next.js 14 (app router), React, TanStack Query v5, TypeScript, Tailwind, Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-05-30-rubric-scoring-design.md`

---

## File map

| File | Change |
|---|---|
| `db/migrations/000013_rubric_scoring.up.sql` | **New** — schema changes |
| `db/migrations/000013_rubric_scoring.down.sql` | **New** — reverse |
| `db/queries/application_scores.sql` | Replace all queries (add criterion_id) |
| `db/queries/application_forms.sql` | Add `PatchFormCriteria` query |
| `api/internal/sqlcdb/` | Regenerated |
| `api/internal/festival/score.go` | Accept optional `criterion_id`; validate range |
| `api/internal/festival/score_test.go` | 3 new tests |
| `api/internal/festival/form.go` | Add criteria PATCH; `slugifyCriterion`; `reviewCriterion`/`criterionInput` types; `review_criteria` in formResponse |
| `api/internal/festival/form_test.go` | 3 new tests |
| `api/internal/festival/application.go` | Add `criterionScore` struct; `CriterionScores` field on `applicationResponse` |
| `api/internal/festival/review.go` | Criterion summary batch-fetch; updated `my_score` + `criterion_scores` assembly |
| `api/internal/festival/review_test.go` | 3 new tests (incl. sqlc Scan canary) |
| `api/cmd/api/main.go` | No change (route already registered) |
| `openapi/openapi.yaml` | `CriterionScore` schema; `criterion_scores` on Application; `review_criteria` on ApplicationForm; PATCH /form body |
| `openapi/generated/client.ts` | Regenerated |
| `api/internal/openapi/` | Regenerated |
| `web/src/app/organiser/festivals/[id]/applications/page.tsx` | `ReviewCriterion` type; extended `handleScore`; extended `scoreMutation`; derive `criteria`; pass to Card + SlideOver |
| `web/src/components/ApplicationCard.tsx` | Add `criteria` prop; rubric mode shows "Score →" button |
| `web/src/__tests__/components/ApplicationCard.test.tsx` | Add `criteria={[]}` to existing renders; 2 new rubric mode tests |
| `web/src/components/ApplicationSlideOver.tsx` | Add `criteria` prop; extended `onScore`; per-criterion star rows; per-criterion panel avg |
| `web/src/__tests__/components/ApplicationSlideOver.test.tsx` | Add `criteria={[]}` to existing renders; 4 new rubric mode tests |
| `web/src/app/organiser/festivals/[id]/page.tsx` | Add `CriteriaSection` inline component |
| `e2e/api/rubric-scoring.test.ts` | **New** — 7 e2e cases |
| `e2e/browser/rubric-scoring.spec.ts` | **New** — 3 browser cases |

---

## Task 1: DB migration + sqlc regeneration

**Files:**
- Create: `db/migrations/000013_rubric_scoring.up.sql`
- Create: `db/migrations/000013_rubric_scoring.down.sql`
- Modify: `db/queries/application_scores.sql`
- Modify: `db/queries/application_forms.sql`

- [ ] **Step 1: Write up migration**

Create `db/migrations/000013_rubric_scoring.up.sql`:

```sql
-- Add per-criterion support to application_scores.
-- All existing rows get criterion_id = 'overall' via the DEFAULT.
ALTER TABLE application_scores
  DROP CONSTRAINT application_scores_pkey,
  DROP CONSTRAINT application_scores_score_check,
  ADD COLUMN criterion_id text NOT NULL DEFAULT 'overall',
  ADD CONSTRAINT application_scores_pkey
    PRIMARY KEY (application_id, reviewer_id, criterion_id),
  ADD CONSTRAINT application_scores_score_check
    CHECK (score >= 1);

-- Criteria config lives on the form so it's scoped per festival.
ALTER TABLE application_forms
  ADD COLUMN review_criteria jsonb NOT NULL DEFAULT '[]';
```

- [ ] **Step 2: Write down migration**

Create `db/migrations/000013_rubric_scoring.down.sql`:

```sql
ALTER TABLE application_forms DROP COLUMN review_criteria;

ALTER TABLE application_scores
  DROP CONSTRAINT application_scores_pkey,
  DROP CONSTRAINT application_scores_score_check,
  DROP COLUMN criterion_id,
  ADD CONSTRAINT application_scores_pkey
    PRIMARY KEY (application_id, reviewer_id),
  ADD CONSTRAINT application_scores_score_check
    CHECK (score BETWEEN 1 AND 5);
```

- [ ] **Step 3: Replace `db/queries/application_scores.sql`**

```sql
-- name: UpsertApplicationScore :one
INSERT INTO application_scores (application_id, reviewer_id, criterion_id, score)
VALUES ($1, $2, $3, $4)
ON CONFLICT (application_id, reviewer_id, criterion_id)
DO UPDATE SET score = EXCLUDED.score, updated_at = now()
RETURNING *;

-- name: ScoreSummaryByApplications :many
-- Overall: count is distinct reviewers who scored at least one criterion.
SELECT
  application_id,
  AVG(score)::float8 AS avg_score,
  COUNT(DISTINCT reviewer_id)::int AS score_count
FROM application_scores
WHERE application_id = ANY($1::uuid[])
GROUP BY application_id;

-- name: CriterionSummaryByApplications :many
SELECT
  application_id,
  criterion_id,
  AVG(score)::float8 AS avg_score,
  COUNT(*)::int AS score_count
FROM application_scores
WHERE application_id = ANY($1::uuid[])
GROUP BY application_id, criterion_id;

-- name: GetMyScoresByApplications :many
SELECT application_id, criterion_id, score
FROM application_scores
WHERE application_id = ANY($1::uuid[]) AND reviewer_id = $2;
```

- [ ] **Step 4: Add `PatchFormCriteria` to `db/queries/application_forms.sql`**

Append to the existing file:

```sql
-- name: PatchFormCriteria :one
UPDATE application_forms
SET review_criteria = $2, updated_at = now()
WHERE festival_id = $1
RETURNING *;
```

- [ ] **Step 5: Apply migration**

```bash
task db:migrate
```

Expected: `000013` applied, no errors.

- [ ] **Step 6: Regenerate sqlc**

```bash
task db:generate
```

Expected: `api/internal/sqlcdb/application_scores.sql.go` and `application_forms.sql.go` updated.

- [ ] **Step 7: Verify scan counts**

```bash
grep -c '&i\.' api/internal/sqlcdb/application_scores.sql.go
grep -c '&i\.' api/internal/sqlcdb/application_forms.sql.go
```

Expected: `application_scores.sql.go` → `4` (was 3, now has criterion_id); `application_forms.sql.go` → `10` (was 9, now has review_criteria).

- [ ] **Step 8: Run API tests to confirm nothing broken**

```bash
task api:test
```

Expected: all pass (existing score tests use `{"score":4}` body — Go handler still compiles; existing `UpsertApplicationScore` call site will be updated in Task 2).

- [ ] **Step 9: Commit**

```bash
git add db/migrations/000013_rubric_scoring.up.sql \
        db/migrations/000013_rubric_scoring.down.sql \
        db/queries/application_scores.sql \
        db/queries/application_forms.sql \
        api/internal/sqlcdb/
git commit -m "feat(db): rubric scoring — criterion_id on application_scores, review_criteria on forms"
```

---

## Task 2: Score handler — optional criterion_id

**Files:**
- Modify: `api/internal/festival/score.go`
- Modify: `api/internal/festival/score_test.go`

- [ ] **Step 1: Write failing tests**

Add to `api/internal/festival/score_test.go` (after existing tests):

```go
func TestScore_WithCriterionID_StoresNamedCriterion(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	ownerID, ownerTok := createTestUser(t, db, "rub-owner-1@test")
	artistID, _ := createTestUser(t, db, "rub-art-1@test")
	createTestArtistProfile(t, db, artistID, "Rub Artist 1")
	festID := createTestFestival(t, db, ownerID, "rub-fest-1", "open")
	createTestApplicationForm(t, db, festID)
	appID := createTestApplicationInFestival(t, db, festID, artistID)
	srv := newScoreServer(db)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "PUT", "/festivals/"+festID+"/applications/"+appID+"/score",
		`{"score":3,"criterion_id":"artistic-quality"}`, ownerTok)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var body map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	_ = resp.Body.Close()
	assert.Equal(t, "artistic-quality", body["criterion_id"])
	assert.Equal(t, float64(3), body["score"])
}

func TestScore_NoCriterionDefaultsToOverall(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	ownerID, ownerTok := createTestUser(t, db, "rub-owner-2@test")
	artistID, _ := createTestUser(t, db, "rub-art-2@test")
	createTestArtistProfile(t, db, artistID, "Rub Artist 2")
	festID := createTestFestival(t, db, ownerID, "rub-fest-2", "open")
	createTestApplicationForm(t, db, festID)
	appID := createTestApplicationInFestival(t, db, festID, artistID)
	srv := newScoreServer(db)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "PUT", "/festivals/"+festID+"/applications/"+appID+"/score",
		`{"score":4}`, ownerTok)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var body map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	_ = resp.Body.Close()
	assert.Equal(t, "overall", body["criterion_id"])
}

func TestScore_InvalidRange_Rejected(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	ownerID, ownerTok := createTestUser(t, db, "rub-owner-3@test")
	artistID, _ := createTestUser(t, db, "rub-art-3@test")
	createTestArtistProfile(t, db, artistID, "Rub Artist 3")
	festID := createTestFestival(t, db, ownerID, "rub-fest-3", "open")
	createTestApplicationForm(t, db, festID)
	appID := createTestApplicationInFestival(t, db, festID, artistID)
	srv := newScoreServer(db)
	t.Cleanup(srv.Close)

	// score 0 is always invalid (overall range is 1–5)
	resp := doRequest(t, srv, "PUT", "/festivals/"+festID+"/applications/"+appID+"/score",
		`{"score":0}`, ownerTok)
	require.Equal(t, http.StatusUnprocessableEntity, resp.StatusCode)
	_ = resp.Body.Close()
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd api && go test ./internal/festival/... -run TestScore_WithCriterion -v 2>&1 | tail -5
cd api && go test ./internal/festival/... -run TestScore_NoCriterion -v 2>&1 | tail -5
```

Expected: compile error — `UpsertApplicationScoreParams` now requires `CriterionID` field.

- [ ] **Step 3: Replace `api/internal/festival/score.go`**

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

// ScoreApplicationHandler handles PUT /festivals/{festivalID}/applications/{applicationID}/score.
// Owner or reviewer. Reviewers cannot score their own application (COI).
// Body: { "score": int, "criterion_id": string (optional, defaults to "overall") }
func ScoreApplicationHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, err := auth.User(r.Context())
		if err != nil {
			httperr.Unauthorized(w)
			return
		}
		uid, err := pgUUIDFromString(principal.UserID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		festUUID, err := pgUUIDFromString(chi.URLParam(r, "festivalID"))
		if err != nil {
			httperr.BadRequest(w, "invalid festivalID")
			return
		}
		appUUID, err := pgUUIDFromString(chi.URLParam(r, "applicationID"))
		if err != nil {
			httperr.BadRequest(w, "invalid applicationID")
			return
		}

		q := sqlcdb.New(pool)
		role, err := resolveFestivalAccess(r.Context(), q, festUUID, principal.UserID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}
		if role == roleNone {
			httperr.Forbidden(w)
			return
		}

		app, ok := getApplicationForFestival(r.Context(), q, w, festUUID, appUUID)
		if !ok {
			return
		}

		// COI: reviewer cannot score their own application.
		if role == roleReviewer {
			profile, err := q.GetArtistProfileByUserID(r.Context(), uid)
			if err == nil && profile.ID == app.ArtistID {
				httperr.Forbidden(w)
				return
			} else if err != nil && !errors.Is(err, pgx.ErrNoRows) {
				httperr.InternalServerError(w)
				return
			}
		}

		var req struct {
			Score       int32  `json:"score"`
			CriterionID string `json:"criterion_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.BadRequest(w, "invalid request body")
			return
		}
		if req.CriterionID == "" {
			req.CriterionID = "overall"
		}

		// Validate score range.
		// For "overall" criterion the historic range is 1–5.
		// For named criteria, look them up in the form config.
		min, max := int32(1), int32(5)
		if req.CriterionID != "overall" {
			form, err := q.GetApplicationFormByFestivalID(r.Context(), festUUID)
			if err != nil {
				httperr.InternalServerError(w)
				return
			}
			criteria, parseErr := parseCriteria(form.ReviewCriteria)
			if parseErr != nil {
				httperr.InternalServerError(w)
				return
			}
			found := false
			for _, c := range criteria {
				if c.ID == req.CriterionID {
					min, max = int32(c.Min), int32(c.Max)
					found = true
					break
				}
			}
			if !found {
				httperr.UnprocessableEntity(w, "unknown criterion_id")
				return
			}
		}
		if req.Score < min || req.Score > max {
			httperr.UnprocessableEntity(w, "score out of range for this criterion")
			return
		}

		score, err := q.UpsertApplicationScore(r.Context(), sqlcdb.UpsertApplicationScoreParams{
			ApplicationID: appUUID,
			ReviewerID:    uid,
			CriterionID:   req.CriterionID,
			Score:         req.Score,
		})
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		type scoreResponse struct {
			ApplicationID string `json:"application_id"`
			CriterionID   string `json:"criterion_id"`
			Score         int32  `json:"score"`
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(scoreResponse{
			ApplicationID: score.ApplicationID.String(),
			CriterionID:   score.CriterionID,
			Score:         score.Score,
		})
	}
}
```

Note: `parseCriteria` is defined in `form.go` (Task 3). Add a forward reference comment if needed; Go compiles the whole package so order doesn't matter.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd api && go test ./internal/festival/... -run TestScore -v 2>&1 | tail -20
```

Expected: all 7 score tests PASS (4 existing + 3 new).

- [ ] **Step 5: Run full API tests**

```bash
task api:test
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add api/internal/festival/score.go \
        api/internal/festival/score_test.go
git commit -m "feat(api): score handler — optional criterion_id, defaults to 'overall'"
```

---

## Task 3: Form handler — criteria PATCH + review_criteria in response

**Files:**
- Modify: `api/internal/festival/form.go`
- Modify: `api/internal/festival/form_test.go`

- [ ] **Step 1: Write failing tests**

Add to `api/internal/festival/form_test.go`:

```go
func TestPatchForm_Criteria_AddAndList(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	orgID, orgTok := createTestUser(t, db, "crit-org-1@test")
	festID := createTestFestival(t, db, orgID, "crit-fest-1", "draft")
	createTestApplicationForm(t, db, festID)

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Patch("/festivals/{festivalID}/form", festival.PatchFormHandler(db))
	r.Get("/festivals/{festivalID}/form", festival.GetFormHandler(db))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	body := `{"review_criteria":[{"label":"Artistic Quality","min":1,"max":5},{"label":"Feasibility","min":1,"max":5}]}`
	resp := doRequest(t, srv, "PATCH", "/festivals/"+festID+"/form", body, orgTok)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var form map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&form))
	_ = resp.Body.Close()

	criteria, ok := form["review_criteria"].([]any)
	require.True(t, ok)
	require.Len(t, criteria, 2)
	c0 := criteria[0].(map[string]any)
	assert.Equal(t, "Artistic Quality", c0["label"])
	assert.NotEmpty(t, c0["id"], "API must assign an id")
	assert.Equal(t, float64(5), c0["max"])
}

func TestPatchForm_Criteria_LabelCollisionGetsUniqueID(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	orgID, orgTok := createTestUser(t, db, "crit-org-2@test")
	festID := createTestFestival(t, db, orgID, "crit-fest-2", "draft")
	createTestApplicationForm(t, db, festID)

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Patch("/festivals/{festivalID}/form", festival.PatchFormHandler(db))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	body := `{"review_criteria":[{"label":"Quality","min":1,"max":5},{"label":"Quality","min":1,"max":7}]}`
	resp := doRequest(t, srv, "PATCH", "/festivals/"+festID+"/form", body, orgTok)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var form map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&form))
	_ = resp.Body.Close()

	criteria := form["review_criteria"].([]any)
	id0 := criteria[0].(map[string]any)["id"].(string)
	id1 := criteria[1].(map[string]any)["id"].(string)
	assert.NotEqual(t, id0, id1, "duplicate labels must produce distinct IDs")
}

func TestPatchForm_Criteria_Validation_MaxTooLarge(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	orgID, orgTok := createTestUser(t, db, "crit-org-3@test")
	festID := createTestFestival(t, db, orgID, "crit-fest-3", "draft")
	createTestApplicationForm(t, db, festID)

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Patch("/festivals/{festivalID}/form", festival.PatchFormHandler(db))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	body := `{"review_criteria":[{"label":"Quality","min":1,"max":99}]}`
	resp := doRequest(t, srv, "PATCH", "/festivals/"+festID+"/form", body, orgTok)
	require.Equal(t, http.StatusUnprocessableEntity, resp.StatusCode)
	_ = resp.Body.Close()
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd api && go test ./internal/festival/... -run TestPatchForm_Criteria -v 2>&1 | tail -10
```

Expected: FAIL — `review_criteria` field not yet handled in `PatchFormHandler`.

- [ ] **Step 3: Update `api/internal/festival/form.go`**

Add the following to `form.go`. Insert after the existing imports (add `encoding/json`, `fmt`, `regexp`, `strings` if not already present):

**Types and helpers** (add after package declaration, before existing `formResponse`):

```go
import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

// reviewCriterion is a single scoring dimension stored in application_forms.review_criteria.
type reviewCriterion struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Min   int    `json:"min"`
	Max   int    `json:"max"`
}

// criterionInput is what the organiser sends when creating/updating criteria.
// ID is optional: if non-empty the caller is preserving a known ID; if empty
// the API generates one from the label.
type criterionInput struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Min   int    `json:"min"`
	Max   int    `json:"max"`
}

var nonAlphanumRe = regexp.MustCompile(`[^a-z0-9]+`)

func slugifyCriterion(label string) string {
	s := strings.ToLower(strings.TrimSpace(label))
	s = nonAlphanumRe.ReplaceAllString(s, "-")
	return strings.Trim(s, "-")
}

// parseCriteria unmarshals review_criteria JSON from the DB model.
// Returns nil slice (not error) when the column is the empty-array default.
func parseCriteria(raw json.RawMessage) ([]reviewCriterion, error) {
	if len(raw) == 0 || string(raw) == "[]" || string(raw) == "null" {
		return nil, nil
	}
	var out []reviewCriterion
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// buildCriteria validates and assigns stable IDs to a submitted criteria list.
func buildCriteria(inputs []criterionInput) ([]reviewCriterion, error) {
	if len(inputs) > 10 {
		return nil, fmt.Errorf("max 10 criteria allowed")
	}
	result := make([]reviewCriterion, len(inputs))
	usedIDs := map[string]int{}
	for i, inp := range inputs {
		label := strings.TrimSpace(inp.Label)
		if label == "" {
			return nil, fmt.Errorf("criterion label must not be empty")
		}
		if len(label) > 80 {
			return nil, fmt.Errorf("criterion label too long (max 80 chars)")
		}
		min, max := inp.Min, inp.Max
		if min < 1 {
			min = 1
		}
		if max < min || max > 10 {
			return nil, fmt.Errorf("criterion max must be between min and 10")
		}
		// Preserve caller-supplied ID (non-empty, valid slug) to keep existing scores valid.
		id := inp.ID
		if id == "" {
			base := slugifyCriterion(label)
			if base == "" {
				base = fmt.Sprintf("criterion-%d", i+1)
			}
			n := usedIDs[base]
			usedIDs[base]++
			if n == 0 {
				id = base
			} else {
				id = fmt.Sprintf("%s-%d", base, n+1)
			}
		}
		usedIDs[id]++
		result[i] = reviewCriterion{ID: id, Label: label, Min: min, Max: max}
	}
	return result, nil
}
```

**Update `formResponse`** — add `ReviewCriteria json.RawMessage` field:

```go
type formResponse struct {
	ID              string          `json:"id"`
	FestivalID      string          `json:"festival_id"`
	Fields          json.RawMessage `json:"fields"`
	OpenAt          *string         `json:"open_at,omitempty"`
	CloseAt         *string         `json:"close_at,omitempty"`
	MaxApplications *int32          `json:"max_applications,omitempty"`
	AnonymousReview bool            `json:"anonymous_review"`
	ReviewCriteria  json.RawMessage `json:"review_criteria"`
	CreatedAt       string          `json:"created_at"`
	UpdatedAt       string          `json:"updated_at"`
}

func toFormResponse(f sqlcdb.ApplicationForm) formResponse {
	criteria := f.ReviewCriteria
	if len(criteria) == 0 {
		criteria = json.RawMessage(`[]`)
	}
	resp := formResponse{
		ID:              f.ID.String(),
		FestivalID:      f.FestivalID.String(),
		Fields:          f.Fields,
		MaxApplications: f.MaxApplications,
		AnonymousReview: f.AnonymousReview,
		ReviewCriteria:  criteria,
		CreatedAt:       f.CreatedAt.Time.Format(time.RFC3339),
		UpdatedAt:       f.UpdatedAt.Time.Format(time.RFC3339),
	}
	if f.OpenAt.Valid {
		s := f.OpenAt.Time.Format(time.RFC3339)
		resp.OpenAt = &s
	}
	if f.CloseAt.Valid {
		s := f.CloseAt.Time.Format(time.RFC3339)
		resp.CloseAt = &s
	}
	return resp
}
```

**Update `PatchFormHandler`** — extend the request struct to handle `review_criteria`:

In the handler, change the request struct from:
```go
var req struct {
    AnonymousReview *bool `json:"anonymous_review"`
}
```
to:
```go
var req struct {
    AnonymousReview *bool            `json:"anonymous_review"`
    ReviewCriteria  *[]criterionInput `json:"review_criteria"`
}
```

After the existing `AnonymousReview` nil check and patch, add:

```go
		// Patch review_criteria if provided.
		if req.ReviewCriteria != nil {
			criteria, err := buildCriteria(*req.ReviewCriteria)
			if err != nil {
				httperr.UnprocessableEntity(w, err.Error())
				return
			}
			criteriaJSON, err := json.Marshal(criteria)
			if err != nil {
				httperr.InternalServerError(w)
				return
			}
			form, err = q.PatchFormCriteria(r.Context(), sqlcdb.PatchFormCriteriaParams{
				FestivalID:     festUUID,
				ReviewCriteria: criteriaJSON,
			})
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					httperr.NotFound(w)
					return
				}
				httperr.InternalServerError(w)
				return
			}
		}
```

The full `PatchFormHandler` flow becomes: decode body → if `AnonymousReview` non-nil → patch it → if `ReviewCriteria` non-nil → validate + patch → return current form state. Both can be patched in a single request.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd api && go test ./internal/festival/... -run TestPatchForm -v 2>&1 | tail -20
```

Expected: all 6 `TestPatchForm_*` tests PASS.

- [ ] **Step 5: Run full API tests**

```bash
task api:test
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add api/internal/festival/form.go \
        api/internal/festival/form_test.go
git commit -m "feat(api): form PATCH accepts review_criteria; slugify + validate; review_criteria in response"
```

---

## Task 4: List handler — criterion_scores in application response

**Files:**
- Modify: `api/internal/festival/application.go`
- Modify: `api/internal/festival/review.go`
- Modify: `api/internal/festival/review_test.go`

- [ ] **Step 1: Write failing tests**

Add to `api/internal/festival/review_test.go`:

```go
// setCriteria is a test helper that patches review_criteria directly via DB.
func setCriteria(t *testing.T, pool *pgxpool.Pool, festivalID string, criteriaJSON string) {
	t.Helper()
	_, err := sqlcdb.New(pool).PatchFormCriteria(context.Background(), sqlcdb.PatchFormCriteriaParams{
		FestivalID:     pgUUID(t, festivalID),
		ReviewCriteria: []byte(criteriaJSON),
	})
	require.NoError(t, err)
}

// scoreWithCriterion submits a score for a named criterion directly via the HTTP server.
func scoreWithCriterion(t *testing.T, srv *httptest.Server, festID, appID, criterionID string, score int, token string) {
	t.Helper()
	body := fmt.Sprintf(`{"score":%d,"criterion_id":%q}`, score, criterionID)
	resp := doRequest(t, srv, "PUT", "/festivals/"+festID+"/applications/"+appID+"/score", body, token)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	_ = resp.Body.Close()
}

func TestListApplications_CriterionScores_PopulatedAfterScoring(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)

	ownerID, ownerTok := createTestUser(t, db, "cs-owner-1@test")
	revID, revTok := createTestUser(t, db, "cs-rev-1@test")
	artistID, _ := createTestUser(t, db, "cs-art-1@test")
	createTestArtistProfile(t, db, artistID, "CS Artist 1")

	festID := createTestFestival(t, db, ownerID, "cs-fest-1", "open")
	createTestApplicationFormWithFields(t, db, festID, `[]`)
	setCriteria(t, db, festID, `[{"id":"art","label":"Artistic Quality","min":1,"max":5},{"id":"feas","label":"Feasibility","min":1,"max":5}]`)
	appID := createTestApplicationInFestival(t, db, festID, artistID)
	addReviewer(t, db, festID, revID)

	srv := newReviewListServer(db)
	t.Cleanup(srv.Close)

	// Reviewer scores both criteria.
	scoreWithCriterion(t, srv, festID, appID, "art", 4, revTok)
	scoreWithCriterion(t, srv, festID, appID, "feas", 2, revTok)

	// List as owner — criterion_scores populated (sqlc Scan canary: asserts non-zero).
	resp := doRequest(t, srv, "GET", "/festivals/"+festID+"/applications", "", ownerTok)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var list []map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&list))
	_ = resp.Body.Close()
	require.Len(t, list, 1)

	app := list[0]
	csRaw, ok := app["criterion_scores"].([]any)
	require.True(t, ok, "criterion_scores must be an array")
	require.Len(t, csRaw, 2)

	// Map by criterion_id for easy lookup.
	csMap := map[string]map[string]any{}
	for _, raw := range csRaw {
		cs := raw.(map[string]any)
		csMap[cs["criterion_id"].(string)] = cs
	}
	assert.InDelta(t, 4.0, csMap["art"]["avg_score"], 0.001, "art avg must be non-zero (sqlc canary)")
	assert.InDelta(t, 2.0, csMap["feas"]["avg_score"], 0.001, "feas avg must be non-zero (sqlc canary)")
	assert.Equal(t, "Artistic Quality", csMap["art"]["label"])

	// my_score at top level = mean of criteria scores = (4+2)/2 = 3, rounded.
	assert.Equal(t, float64(3), app["my_score"], "my_score must be mean of criteria scores")
}

func TestListApplications_CriterionScores_EmptyWhenNoCriteria(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)

	ownerID, ownerTok := createTestUser(t, db, "cs-owner-2@test")
	artistID, _ := createTestUser(t, db, "cs-art-2@test")
	createTestArtistProfile(t, db, artistID, "CS Artist 2")

	festID := createTestFestival(t, db, ownerID, "cs-fest-2", "open")
	createTestApplicationFormWithFields(t, db, festID, `[]`)
	// No criteria set.
	createTestApplicationInFestival(t, db, festID, artistID)

	srv := newReviewListServer(db)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "GET", "/festivals/"+festID+"/applications", "", ownerTok)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var list []map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&list))
	_ = resp.Body.Close()
	require.Len(t, list, 1)

	csRaw := list[0]["criterion_scores"].([]any)
	assert.Empty(t, csRaw, "criterion_scores must be empty when no criteria configured")
}

func TestListApplications_OrphanedCriterionScores_Omitted(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)

	ownerID, ownerTok := createTestUser(t, db, "cs-owner-3@test")
	revID, revTok := createTestUser(t, db, "cs-rev-3@test")
	artistID, _ := createTestUser(t, db, "cs-art-3@test")
	createTestArtistProfile(t, db, artistID, "CS Artist 3")

	festID := createTestFestival(t, db, ownerID, "cs-fest-3", "open")
	createTestApplicationFormWithFields(t, db, festID, `[]`)
	setCriteria(t, db, festID, `[{"id":"temp","label":"Temp","min":1,"max":5}]`)
	appID := createTestApplicationInFestival(t, db, festID, artistID)
	addReviewer(t, db, festID, revID)

	srv := newReviewListServer(db)
	t.Cleanup(srv.Close)

	scoreWithCriterion(t, srv, festID, appID, "temp", 3, revTok)

	// Now remove the criterion from the form.
	setCriteria(t, db, festID, `[]`)

	// The orphaned score row must not appear in criterion_scores.
	resp := doRequest(t, srv, "GET", "/festivals/"+festID+"/applications", "", ownerTok)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var list []map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&list))
	_ = resp.Body.Close()
	assert.Empty(t, list[0]["criterion_scores"].([]any))
}
```

Also add `"fmt"` to imports if needed.

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd api && go test ./internal/festival/... -run TestListApplications_Criterion -v 2>&1 | tail -10
```

Expected: FAIL — `criterion_scores` field not yet present.

- [ ] **Step 3: Add `criterionScore` and `CriterionScores` to `application.go`**

Add this struct after `noteResponse`:

```go
type criterionScore struct {
	CriterionID string   `json:"criterion_id"`
	Label       string   `json:"label"`
	Min         int      `json:"min"`
	Max         int      `json:"max"`
	AvgScore    *float64 `json:"avg_score"`
	ScoreCount  int      `json:"score_count"`
	MyScore     *int32   `json:"my_score"`
}
```

Add `CriterionScores []criterionScore` to `applicationResponse` (after `IdentityHidden`):

```go
type applicationResponse struct {
	// ...existing fields...
	IdentityHidden  bool             `json:"identity_hidden"`
	CriterionScores []criterionScore `json:"criterion_scores"`
}
```

Update all three constructor functions (`toApplicationResponse`, `toEnrichedResponse`, `toEnrichedReviewerRow`) to initialise `CriterionScores: []criterionScore{}` so the JSON field is always an array, never null.

- [ ] **Step 4: Update `review.go` — criterion summary assembly**

In `ListApplicationsHandler`, the `GetMyScoresByApplications` query now returns `(application_id, criterion_id, score)`. Update the map to `map[string]map[string]int32` and the assembly loop.

Find the section starting with `// Batch-fetch the caller's own scores.` and replace through the end of the assembly loop:

```go
		// Batch-fetch the caller's own scores (now per criterion).
		type myScoreRow struct{ criterionID string; score int32 }
		myScoresByApp := map[string][]myScoreRow{}
		myScores, err := q.GetMyScoresByApplications(r.Context(), sqlcdb.GetMyScoresByApplicationsParams{
			Column1:    appIDs,
			ReviewerID: callerUUID,
		})
		if err != nil {
			httperr.InternalServerError(w)
			return
		}
		for _, ms := range myScores {
			k := ms.ApplicationID.String()
			myScoresByApp[k] = append(myScoresByApp[k], myScoreRow{ms.CriterionID, ms.Score})
		}

		// Parse criteria config once for the whole batch.
		criteria, _ := parseCriteria(form.ReviewCriteria)

		// Batch-fetch per-criterion summaries (only needed when criteria are configured).
		type criterionKey struct{ appID, criterionID string }
		criterionSummaries := map[criterionKey]struct {
			avg   float64
			count int
		}{}
		if len(criteria) > 0 {
			rows, err := q.CriterionSummaryByApplications(r.Context(), appIDs)
			if err != nil {
				httperr.InternalServerError(w)
				return
			}
			for _, row := range rows {
				k := criterionKey{row.ApplicationID.String(), row.CriterionID}
				criterionSummaries[k] = struct {
					avg   float64
					count int
				}{row.AvgScore, int(row.ScoreCount)}
			}
		}

		// Assemble final response.
		isReviewer := role == roleReviewer
		resp := make([]applicationResponse, len(items))
		for i, it := range items {
			a := it.resp
			a.Notes = notesByApp[it.id.String()]

			// Overall score summary.
			if sum, ok := summaryByApp[it.id.String()]; ok {
				avg := sum.avg
				a.AvgScore = &avg
				a.ScoreCount = sum.count
			}

			// Build my_score: for no-criteria use 'overall', for criteria use mean.
			myRows := myScoresByApp[it.id.String()]
			if len(criteria) == 0 {
				// No rubric — look for the 'overall' criterion score.
				for _, row := range myRows {
					if row.criterionID == "overall" {
						m := row.score
						a.MyScore = &m
						break
					}
				}
			} else {
				// Rubric — my_score = mean of scored criteria; criterion_scores populated.
				myScoreLookup := map[string]int32{}
				for _, row := range myRows {
					myScoreLookup[row.criterionID] = row.score
				}

				cs := make([]criterionScore, 0, len(criteria))
				var totalMy int32
				myCount := 0
				for _, c := range criteria {
					entry := criterionScore{
						CriterionID: c.ID,
						Label:       c.Label,
						Min:         c.Min,
						Max:         c.Max,
					}
					if sum, ok := criterionSummaries[criterionKey{it.id.String(), c.ID}]; ok {
						entry.AvgScore = &sum.avg
						entry.ScoreCount = sum.count
					}
					if ms, ok := myScoreLookup[c.ID]; ok {
						entry.MyScore = &ms
						totalMy += ms
						myCount++
					}
					cs = append(cs, entry)
				}
				a.CriterionScores = cs

				if myCount > 0 {
					mean := int32(math.Round(float64(totalMy) / float64(myCount)))
					a.MyScore = &mean
				}
			}

			// Anonymous review stripping (unchanged — uses a.MyScore which is now set).
			if shouldAnonymise(isReviewer, form.AnonymousReview, a.MyScore) {
				a.Artist = &artistSummary{
					DisplayName:   "",
					AvatarS3Key:   nil,
					MediumTags:    a.Artist.MediumTags,
					LocationLabel: nil,
				}
				a.IdentityHidden = true
			}
			resp[i] = a
		}
```

Add `"math"` to the import block of `review.go`.

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd api && go test ./internal/festival/... -run TestListApplications_Criterion -v 2>&1 | tail -20
```

Expected: all 3 pass.

- [ ] **Step 6: Run full API tests**

```bash
task api:test
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add api/internal/festival/application.go \
        api/internal/festival/review.go \
        api/internal/festival/review_test.go
git commit -m "feat(api): criterion_scores in list response; my_score = mean of criteria"
```

---

## Task 5: OpenAPI + regenerate TS client

**Files:**
- Modify: `openapi/openapi.yaml`
- Regenerated: `openapi/generated/client.ts`, `api/internal/openapi/`

- [ ] **Step 1: Add `CriterionScore` schema**

In `openapi/openapi.yaml`, after the `ApplicationNote:` schema, add:

```yaml
    CriterionScore:
      type: object
      properties:
        criterion_id:
          type: string
        label:
          type: string
        min:
          type: integer
        max:
          type: integer
        avg_score:
          type: number
          format: float
          nullable: true
        score_count:
          type: integer
        my_score:
          type: integer
          nullable: true
```

- [ ] **Step 2: Add `review_criteria` to `ApplicationForm` schema**

In the `ApplicationForm:` schema, after `anonymous_review`:

```yaml
        review_criteria:
          type: array
          items:
            type: object
            properties:
              id:
                type: string
              label:
                type: string
              min:
                type: integer
              max:
                type: integer
```

- [ ] **Step 3: Add `criterion_scores` to `Application` schema**

In the `Application:` schema, after `identity_hidden`:

```yaml
        criterion_scores:
          type: array
          items:
            $ref: "#/components/schemas/CriterionScore"
```

- [ ] **Step 4: Add `review_criteria` to the PATCH /form request body**

In the `patch:` operation under `/festivals/{festivalID}/form`, extend the request body schema:

```yaml
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                anonymous_review:
                  type: boolean
                review_criteria:
                  type: array
                  items:
                    type: object
                    properties:
                      id:
                        type: string
                      label:
                        type: string
                      min:
                        type: integer
                      max:
                        type: integer
```

- [ ] **Step 5: Regenerate**

```bash
task openapi:gen
```

Expected: no errors; `openapi/generated/client.ts` and `api/internal/openapi/` updated.

- [ ] **Step 6: Typecheck**

```bash
cd web && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add openapi/openapi.yaml openapi/generated/ api/internal/openapi/
git commit -m "feat(openapi): CriterionScore schema; criterion_scores on Application; review_criteria on form"
```

---

## Task 6: Web — ApplicationCard rubric mode

**Files:**
- Modify: `web/src/components/ApplicationCard.tsx`
- Modify: `web/src/__tests__/components/ApplicationCard.test.tsx`

- [ ] **Step 1: Write failing tests**

In `web/src/__tests__/components/ApplicationCard.test.tsx`, add after the anonymous mode block. First update the `baseApp` fixture to include `criterion_scores: []`, then add the new describe block:

```tsx
// Add criterion_scores: [] to baseApp (and anonApp in the anonymous describe)
// so TypeScript is happy with the updated type.
// In the baseApp const, add:
//   criterion_scores: [],

describe('ApplicationCard — rubric mode (criteria configured)', () => {
  const rubricApp = {
    ...baseApp,
    criterion_scores: [
      { criterion_id: 'art', label: 'Artistic Quality', min: 1, max: 5, avg_score: null, score_count: 0, my_score: null },
      { criterion_id: 'feas', label: 'Feasibility', min: 1, max: 5, avg_score: null, score_count: 0, my_score: null },
    ],
  }
  const criteria = [
    { id: 'art', label: 'Artistic Quality', min: 1, max: 5 },
    { id: 'feas', label: 'Feasibility', min: 1, max: 5 },
  ]

  it('shows "Score →" button instead of inline stars when criteria are configured', () => {
    render(<ApplicationCard application={rubricApp} onSelect={noop} onAccept={noop}
      onDecline={noop} onWaitlist={noop} onToggleShortlist={noop}
      onToggleReviewFlag={noop} onScore={noop} isReviewer={true} isPending={false}
      criteria={criteria} />)
    expect(screen.getByRole('button', { name: /Score/i })).toBeInTheDocument()
    expect(screen.queryByLabelText('Score 1')).not.toBeInTheDocument()
  })

  it('calls onSelect when "Score →" button is clicked', () => {
    const onSelect = vi.fn()
    render(<ApplicationCard application={rubricApp} onSelect={onSelect} onAccept={noop}
      onDecline={noop} onWaitlist={noop} onToggleShortlist={noop}
      onToggleReviewFlag={noop} onScore={noop} isReviewer={true} isPending={false}
      criteria={criteria} />)
    fireEvent.click(screen.getByRole('button', { name: /Score/i }))
    expect(onSelect).toHaveBeenCalledWith(rubricApp)
  })
})
```

Also add `criteria={[]}` to every existing `render(<ApplicationCard ...)` call in the file so TypeScript doesn't complain about the new required prop.

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd web && npx vitest run src/__tests__/components/ApplicationCard.test.tsx
```

Expected: compile error — `criteria` prop not defined on `ApplicationCard`.

- [ ] **Step 3: Update `ApplicationCard.tsx`**

Add to the `Props` interface:

```tsx
interface ReviewCriterion {
  id: string
  label: string
  min: number
  max: number
}

interface Props {
  // ...existing props...
  criteria: ReviewCriterion[]
}
```

Add `criteria` to the destructured params.

In the reviewer right-slot, replace the `<StarControl>` with:

```tsx
{isReviewer ? (
  <>
    {showAvg && (
      <span className="font-mono text-xs text-mid">★ {avgScore?.toFixed(1)} · {scoreCount}</span>
    )}
    {criteria.length > 0 ? (
      <button
        type="button"
        onClick={e => { e.stopPropagation(); onSelect(application) }}
        className="font-sans text-xs text-mid border border-light px-2 py-1 rounded hover:border-amber hover:text-ink transition-colors"
      >
        {myScore != null ? 'Edit score' : 'Score →'}
      </button>
    ) : (
      <StarControl appId={id} myScore={myScore} onScore={onScore} />
    )}
  </>
) : (
  // ...owner slot unchanged...
)}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd web && npx vitest run src/__tests__/components/ApplicationCard.test.tsx
```

Expected: all 15 tests PASS (13 existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ApplicationCard.tsx \
        web/src/__tests__/components/ApplicationCard.test.tsx
git commit -m "feat(web): ApplicationCard rubric mode — Score → button when criteria configured"
```

---

## Task 7: Web — ApplicationSlideOver criterion scoring

**Files:**
- Modify: `web/src/components/ApplicationSlideOver.tsx`
- Modify: `web/src/__tests__/components/ApplicationSlideOver.test.tsx`

- [ ] **Step 1: Write failing tests**

In `web/src/__tests__/components/ApplicationSlideOver.test.tsx`, add `criteria={[]}` to every existing render call, then add a new describe block:

```tsx
describe('ApplicationSlideOver — rubric mode (criteria configured)', () => {
  const criteria = [
    { id: 'art', label: 'Artistic Quality', min: 1, max: 5 },
    { id: 'feas', label: 'Feasibility', min: 1, max: 3 },
  ]
  const rubricApp = {
    ...baseApp,
    criterion_scores: [
      { criterion_id: 'art', label: 'Artistic Quality', min: 1, max: 5, avg_score: null, score_count: 0, my_score: null },
      { criterion_id: 'feas', label: 'Feasibility', min: 1, max: 3, avg_score: null, score_count: 0, my_score: null },
    ],
  }

  it('shows one star row per criterion', () => {
    render(<ApplicationSlideOver {...baseProps} application={rubricApp} isReviewer={true} criteria={criteria} />)
    expect(screen.getByText('Artistic Quality')).toBeInTheDocument()
    expect(screen.getByText('Feasibility')).toBeInTheDocument()
    // max=3 for Feasibility → 3 star buttons, not 5
    expect(screen.getByLabelText('Score Feasibility 3')).toBeInTheDocument()
    expect(screen.queryByLabelText('Score Feasibility 4')).not.toBeInTheDocument()
  })

  it('calls onScore with criterion_id when a criterion star is clicked', () => {
    const onScore = vi.fn()
    render(<ApplicationSlideOver {...baseProps} application={rubricApp} isReviewer={true} criteria={criteria} onScore={onScore} />)
    fireEvent.click(screen.getByLabelText('Score Artistic Quality 4'))
    expect(onScore).toHaveBeenCalledWith('app-1', 4, 'art')
  })

  it('shows per-criterion panel averages after scoring', () => {
    const scoredApp = {
      ...rubricApp,
      my_score: 3,
      criterion_scores: [
        { criterion_id: 'art', label: 'Artistic Quality', min: 1, max: 5, avg_score: 4.0, score_count: 1, my_score: 4 },
        { criterion_id: 'feas', label: 'Feasibility', min: 1, max: 3, avg_score: 2.0, score_count: 1, my_score: 2 },
      ],
    }
    render(<ApplicationSlideOver {...baseProps} application={scoredApp} isReviewer={true} criteria={criteria} />)
    expect(screen.getByText(/Panel average/i)).toBeInTheDocument()
    expect(screen.getByText(/Artistic Quality/)).toBeInTheDocument()
  })

  it('hides single 5-star when criteria configured', () => {
    render(<ApplicationSlideOver {...baseProps} application={rubricApp} isReviewer={true} criteria={criteria} />)
    // The single generic "Score 1" label should not exist (per-criterion labels are "Score Artistic Quality 1")
    expect(screen.queryByLabelText('Score 1')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd web && npx vitest run src/__tests__/components/ApplicationSlideOver.test.tsx
```

Expected: compile error — `criteria` prop not defined.

- [ ] **Step 3: Update `ApplicationSlideOver.tsx`**

Add the `ReviewCriterion` interface and `criteria` prop:

```tsx
interface ReviewCriterion {
  id: string
  label: string
  min: number
  max: number
}

interface Props {
  // ...existing...
  onScore: (id: string, score: number, criterionId?: string) => void
  criteria: ReviewCriterion[]
}
```

Replace the `{/* Score control */}` section with a criteria-aware version:

```tsx
          {/* Score control */}
          <div>
            <h3 className="font-mono text-xs text-mid uppercase tracking-widest mb-2">Your Score</h3>
            {criteria.length > 0 ? (
              <div className="space-y-4">
                {criteria.map(c => {
                  const cs = (application.criterion_scores ?? []).find(
                    (s: { criterion_id: string; my_score?: number | null }) => s.criterion_id === c.id
                  )
                  const myCs = cs?.my_score ?? null
                  return (
                    <div key={c.id}>
                      <p className="font-sans text-xs text-mid mb-1">{c.label}</p>
                      <div className="flex gap-1 mb-0.5">
                        {Array.from({ length: c.max }, (_, i) => i + 1).map(n => (
                          <button
                            type="button"
                            key={n}
                            aria-label={`Score ${c.label} ${n}`}
                            onClick={() => onScore(id, n, c.id)}
                            className={`text-xl leading-none ${(myCs ?? 0) >= n ? 'text-amber' : 'text-light hover:text-mid'}`}
                          >★</button>
                        ))}
                      </div>
                      <p className="font-sans text-xs text-mid">
                        {myCs != null ? `${myCs} / ${c.max} · click to change` : 'Not yet scored'}
                      </p>
                    </div>
                  )
                })}
              </div>
            ) : (
              <>
                <div className="flex gap-1 mb-1">
                  {[1, 2, 3, 4, 5].map(n => (
                    <button
                      type="button"
                      key={n}
                      aria-label={`Score ${n}`}
                      onClick={() => onScore(id, n)}
                      className={`text-2xl leading-none ${(myScore ?? 0) >= n ? 'text-amber' : 'text-light hover:text-mid'}`}
                    >★</button>
                  ))}
                </div>
                <p className="font-sans text-xs text-mid">
                  {myScore != null ? `${myScore} / 5 · click to change` : 'Not yet scored'}
                </p>
              </>
            )}
          </div>
```

Replace the `{/* Panel average */}` section with criteria-aware version:

```tsx
          {/* Panel average — only shown once scored */}
          {showAvg && (
            <div>
              <h3 className="font-mono text-xs text-mid uppercase tracking-widest mb-1">Panel average</h3>
              <p className="font-sans text-sm text-ink mb-2">
                ★ {avgScore?.toFixed(1)}
                <span className="text-mid ml-1">from {scoreCount} {scoreCount === 1 ? 'reviewer' : 'reviewers'}</span>
              </p>
              {criteria.length > 0 && (
                <div className="space-y-1">
                  {(application.criterion_scores ?? []).map((cs: {
                    criterion_id: string; label: string; avg_score?: number | null; score_count: number
                  }) => (
                    <p key={cs.criterion_id} className="font-sans text-xs text-mid">
                      {cs.label}
                      {cs.avg_score != null && (
                        <span className="ml-2 text-ink">★ {cs.avg_score.toFixed(1)}</span>
                      )}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd web && npx vitest run src/__tests__/components/ApplicationSlideOver.test.tsx
```

Expected: all 15 tests PASS (11 existing + 4 new).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ApplicationSlideOver.tsx \
        web/src/__tests__/components/ApplicationSlideOver.test.tsx
git commit -m "feat(web): ApplicationSlideOver criterion scoring rows + per-criterion panel avg"
```

---

## Task 8: Web — applications page wiring

**Files:**
- Modify: `web/src/app/organiser/festivals/[id]/applications/page.tsx`

- [ ] **Step 1: Read the current file**

Read `web/src/app/organiser/festivals/[id]/applications/page.tsx` lines 1–50 to see current imports.

- [ ] **Step 2: Add `ReviewCriterion` type and extend `handleScore` + `scoreMutation`**

Add after the existing `FormField` interface:

```tsx
interface ReviewCriterion {
  id: string
  label: string
  min: number
  max: number
}
```

Replace the existing `scoreMutation` and `handleScore` with:

```tsx
  const scoreMutation = useMutation({
    mutationFn: async ({ applicationId, score, criterionId }: {
      applicationId: string; score: number; criterionId: string
    }) => {
      const res = await apiClient.PUT('/festivals/{festivalID}/applications/{applicationID}/score', {
        params: { path: { festivalID: festivalId, applicationID: applicationId } },
        body: criterionId === 'overall'
          ? { score }
          : { score, criterion_id: criterionId },
      })
      if (res.error) throw new Error('Score failed')
    },
    onMutate: ({ applicationId, score, criterionId }) => {
      const snapshot = localApps
      setLocalApps(prev => prev?.map(a => {
        if (a.id !== applicationId) return a
        if (criterionId === 'overall') return { ...a, my_score: score }
        const criterionScores = (a.criterion_scores ?? []).map((cs: {
          criterion_id: string; my_score?: number | null
        }) => cs.criterion_id === criterionId ? { ...cs, my_score: score } : cs)
        const scored = criterionScores.filter((cs: { my_score?: number | null }) => cs.my_score != null)
        const mean = scored.length > 0
          ? Math.round(scored.reduce((s: number, cs: { my_score: number }) => s + cs.my_score, 0) / scored.length)
          : a.my_score
        return { ...a, criterion_scores: criterionScores, my_score: mean }
      }) ?? null)
      return { snapshot }
    },
    onError: (_err: unknown, _vars: unknown, context: { snapshot: Application[] | null } | undefined) => {
      if (context?.snapshot !== undefined) setLocalApps(context.snapshot)
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
          const criterionScores = (prev.criterion_scores ?? []).map((cs: {
            criterion_id: string; my_score?: number | null
          }) => cs.criterion_id === criterionId ? { ...cs, my_score: score } : cs)
          const scored = criterionScores.filter((cs: { my_score?: number | null }) => cs.my_score != null)
          const mean = scored.length > 0
            ? Math.round(scored.reduce((s: number, cs: { my_score: number }) => s + cs.my_score, 0) / scored.length)
            : prev.my_score
          return { ...prev, criterion_scores: criterionScores, my_score: mean }
        })
      }
    }
  }
```

- [ ] **Step 3: Derive `criteria` from form data and pass to Card + SlideOver**

Find the line that derives `formFields` and add `criteria` below it:

```tsx
  const formFields: FormField[] = (formQuery.data as { fields?: FormField[] })?.fields ?? []
  const criteria: ReviewCriterion[] = (formQuery.data as { review_criteria?: ReviewCriterion[] })?.review_criteria ?? []
```

Add `criteria={criteria}` to every `<ApplicationCard` usage in the file (in `cardList`).

Add `criteria={criteria}` to `<ApplicationSlideOver`.

- [ ] **Step 4: Typecheck**

```bash
cd web && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 5: Run full web test suite**

```bash
task web:test
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add "web/src/app/organiser/festivals/[id]/applications/page.tsx"
git commit -m "feat(web): applications page — criterion-aware score mutation, pass criteria to Card/SlideOver"
```

---

## Task 9: CriteriaSection on festival settings page

**Files:**
- Modify: `web/src/app/organiser/festivals/[id]/page.tsx`

- [ ] **Step 1: Read current file structure**

Read `web/src/app/organiser/festivals/[id]/page.tsx` to see the existing `AnonymousReviewSection` pattern and the JSX ordering (Anonymous → Reviewers → Danger zone).

- [ ] **Step 2: Add `CriteriaSection` component**

Add this component before the default export (after `AnonymousReviewSection`):

```tsx
interface ReviewCriterion { id: string; label: string; min: number; max: number }
interface CriterionInput  { id?: string; label: string; min: number; max: number }

function CriteriaSection({ festivalId }: { festivalId: string }) {
  const queryClient = useQueryClient()
  const [newLabel, setNewLabel] = useState('')
  const [newMax, setNewMax] = useState(5)

  const formQuery = useQuery({
    queryKey: ['festival-form', festivalId],
    queryFn: async () => {
      const res = await apiClient.GET('/festivals/{festivalID}/form', {
        params: { path: { festivalID: festivalId } },
      })
      if (res.error) return null
      return res.data ?? null
    },
  })

  const patchMutation = useMutation({
    mutationFn: async (criteria: CriterionInput[]) => {
      const res = await apiClient.PATCH('/festivals/{festivalID}/form', {
        params: { path: { festivalID: festivalId } },
        body: { review_criteria: criteria },
      })
      if (res.error) throw new Error('Failed to update criteria')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['festival-form', festivalId] }),
  })

  if (formQuery.isLoading || formQuery.data == null) return null

  const criteria = ((formQuery.data as { review_criteria?: ReviewCriterion[] }).review_criteria ?? [])

  const handleAdd = () => {
    const label = newLabel.trim()
    if (!label) return
    // Send existing criteria with their IDs (stable), new one without.
    const updated: CriterionInput[] = [
      ...criteria.map(c => ({ id: c.id, label: c.label, min: c.min, max: c.max })),
      { label, min: 1, max: newMax },
    ]
    patchMutation.mutate(updated)
    setNewLabel('')
    setNewMax(5)
  }

  const handleRemove = (id: string) => {
    const updated: CriterionInput[] = criteria
      .filter(c => c.id !== id)
      .map(c => ({ id: c.id, label: c.label, min: c.min, max: c.max }))
    patchMutation.mutate(updated)
  }

  return (
    <div className="p-5 bg-warm border border-light rounded-lg mb-6">
      <h2 className="font-serif text-xl text-ink mb-4">Scoring criteria</h2>
      {criteria.length === 0 && (
        <p className="font-sans text-sm text-mid mb-4">
          No criteria set. Reviewers score each application with a single 1–5 rating.
        </p>
      )}
      {criteria.length > 0 && (
        <ul className="space-y-2 mb-4">
          {criteria.map(c => (
            <li key={c.id} className="flex items-center gap-3">
              <span className="font-sans text-sm text-ink flex-1">{c.label}</span>
              <span className="font-mono text-xs text-mid">1–{c.max}</span>
              <button
                type="button"
                onClick={() => handleRemove(c.id)}
                disabled={patchMutation.isPending}
                className="font-sans text-xs text-clay hover:opacity-80 disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2 items-center">
        <input
          type="text"
          value={newLabel}
          onChange={e => setNewLabel(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
          placeholder="e.g. Artistic Quality"
          className="flex-1 border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite focus:outline-none focus:border-amber"
        />
        <select
          value={newMax}
          onChange={e => setNewMax(Number(e.target.value))}
          className="border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite focus:outline-none focus:border-amber"
        >
          {[3, 5, 7, 10].map(n => <option key={n} value={n}>1–{n}</option>)}
        </select>
        <button
          type="button"
          onClick={handleAdd}
          disabled={patchMutation.isPending || !newLabel.trim()}
          className="font-sans text-sm font-medium bg-amber text-ink px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </div>
  )
}
```

Note: `useState` is already imported in this file.

- [ ] **Step 3: Add `CriteriaSection` to JSX**

Find `{/* Anonymous review */}` and add `CriteriaSection` after it:

```tsx
      {/* Anonymous review */}
      <AnonymousReviewSection festivalId={festivalId} />

      {/* Scoring criteria */}
      <CriteriaSection festivalId={festivalId} />

      {/* Reviewers */}
      <ReviewersSection festivalId={festivalId} />
```

- [ ] **Step 4: Typecheck + tests**

```bash
cd web && npx tsc --noEmit && task web:test
```

Expected: 0 errors, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add "web/src/app/organiser/festivals/[id]/page.tsx"
git commit -m "feat(web): CriteriaSection — add/remove scoring criteria on festival settings page"
```

---

## Task 10: E2E API tests

**Files:**
- Create: `e2e/api/rubric-scoring.test.ts`

- [ ] **Step 1: Write the test file**

Create `e2e/api/rubric-scoring.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest'
import {
  createArtist, createOrganiser, createProfile, createFestival,
  setFestivalStatus, upsertForm, submitApplication,
} from '../fixtures/helpers.js'

const API = process.env.API_URL ?? 'http://localhost:8080'
const SUFFIX = `rubric-${Date.now()}`
const auth = (t: string) => ({ Authorization: `Bearer ${t}` })
const json = (t: string) => ({ 'Content-Type': 'application/json', ...auth(t) })

describe('rubric scoring', () => {
  let orgToken: string
  let festivalId: string
  let appId: string
  let reviewerToken: string
  let reviewer2Token: string

  beforeAll(async () => {
    const org = await createOrganiser(`${SUFFIX}-org`)
    orgToken = org.token
    const fest = await createFestival(org.token, { name: `Rubric Fest ${SUFFIX}`, slug: `rubric-${SUFFIX}` })
    festivalId = fest.festivalId
    await upsertForm(org.token, festivalId)
    await setFestivalStatus(org.token, festivalId, 'open')

    const applicant = await createArtist(`${SUFFIX}-app`)
    await createProfile(applicant.token, { displayName: `Rubric Artist ${SUFFIX}` })
    const app = await submitApplication(applicant.token, festivalId)
    appId = app.applicationId

    const reviewer = await createArtist(`${SUFFIX}-rev`)
    reviewerToken = reviewer.token
    const reviewer2 = await createArtist(`${SUFFIX}-rev2`)
    reviewer2Token = reviewer2.token

    for (const email of [reviewer.email, reviewer2.email]) {
      const inv = await fetch(`${API}/festivals/${festivalId}/reviewers`, {
        method: 'POST', headers: json(orgToken), body: JSON.stringify({ email }),
      })
      expect(inv.status).toBe(201)
    }
  })

  it('non-owner cannot PATCH review_criteria → 403', async () => {
    const res = await fetch(`${API}/festivals/${festivalId}/form`, {
      method: 'PATCH', headers: json(reviewerToken),
      body: JSON.stringify({ review_criteria: [{ label: 'X', min: 1, max: 5 }] }),
    })
    expect(res.status).toBe(403)
  })

  it('owner adds two criteria → form response includes them with generated IDs', async () => {
    const res = await fetch(`${API}/festivals/${festivalId}/form`, {
      method: 'PATCH', headers: json(orgToken),
      body: JSON.stringify({ review_criteria: [
        { label: 'Artistic Quality', min: 1, max: 5 },
        { label: 'Feasibility', min: 1, max: 5 },
      ]}),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.review_criteria).toHaveLength(2)
    expect(body.review_criteria[0].id).toBeTruthy()
    expect(body.review_criteria[0].label).toBe('Artistic Quality')
  })

  it('reviewer scores a named criterion → 200, response has criterion_id', async () => {
    const res = await fetch(`${API}/festivals/${festivalId}/applications/${appId}/score`, {
      method: 'PUT', headers: json(reviewerToken),
      body: JSON.stringify({ score: 4, criterion_id: 'artistic-quality' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.criterion_id).toBe('artistic-quality')
    expect(body.score).toBe(4)
  })

  it('unknown criterion_id → 422', async () => {
    const res = await fetch(`${API}/festivals/${festivalId}/applications/${appId}/score`, {
      method: 'PUT', headers: json(reviewerToken),
      body: JSON.stringify({ score: 3, criterion_id: 'does-not-exist' }),
    })
    expect(res.status).toBe(422)
  })

  it('no criterion_id defaults to overall → 200', async () => {
    const res = await fetch(`${API}/festivals/${festivalId}/applications/${appId}/score`, {
      method: 'PUT', headers: json(reviewerToken),
      body: JSON.stringify({ score: 3 }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.criterion_id).toBe('overall')
  })

  it('two reviewers score → criterion_scores avg is non-zero (sqlc canary)', async () => {
    // reviewer2 scores artistic-quality
    const s = await fetch(`${API}/festivals/${festivalId}/applications/${appId}/score`, {
      method: 'PUT', headers: json(reviewer2Token),
      body: JSON.stringify({ score: 2, criterion_id: 'artistic-quality' }),
    })
    expect(s.status).toBe(200)

    const res = await fetch(`${API}/festivals/${festivalId}/applications`, {
      headers: auth(orgToken),
    })
    const apps = await res.json()
    expect(apps).toHaveLength(1)
    const cs = apps[0].criterion_scores.find((c: { criterion_id: string }) => c.criterion_id === 'artistic-quality')
    expect(cs).toBeDefined()
    expect(cs.avg_score).toBeGreaterThan(0)
    expect(cs.score_count).toBe(2)
  })

  it('unauthenticated PATCH /form → 401', async () => {
    const res = await fetch(`${API}/festivals/${festivalId}/form`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ review_criteria: [] }),
    })
    expect(res.status).toBe(401)
  })
})
```

- [ ] **Step 2: Verify stack is running**

```bash
curl -sf http://localhost:8080/healthz && echo "API OK" || echo "API DOWN"
```

- [ ] **Step 3: Run tests**

```bash
npx vitest run --config vitest.e2e.config.ts e2e/api/rubric-scoring.test.ts
```

Expected: all 7 tests PASS.

- [ ] **Step 4: Commit**

```bash
git add e2e/api/rubric-scoring.test.ts
git commit -m "test(e2e): rubric scoring — criteria CRUD, named criterion, sqlc canary, auth probes"
```

---

## Task 11: Browser spec

**Files:**
- Create: `e2e/browser/rubric-scoring.spec.ts`

- [ ] **Step 1: Write the spec**

Create `e2e/browser/rubric-scoring.spec.ts`:

```typescript
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

async function setCriteria(orgToken: string, festivalId: string, criteria: object[]) {
  const res = await fetch(`${API}/festivals/${festivalId}/form`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${orgToken}` },
    body: JSON.stringify({ review_criteria: criteria }),
  })
  if (!res.ok) throw new Error(`setCriteria failed: ${res.status}`)
  return res.json()
}

async function inviteReviewer(orgToken: string, festivalId: string, email: string) {
  const res = await fetch(`${API}/festivals/${festivalId}/reviewers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${orgToken}` },
    body: JSON.stringify({ email }),
  })
  if (!res.ok) throw new Error(`inviteReviewer failed: ${res.status}`)
}

test.describe('rubric scoring', () => {
  const suffix = `rubric-browser-${Date.now()}`
  const baseURL = process.env.BASE_URL ?? 'http://localhost:3000'

  test('1 — organiser adds criteria on the settings page', async ({ browser }) => {
    const org = await createOrganiser(`${suffix}-org1`)
    const { festivalId } = await createFestival(org.token, {
      name: `Rubric Fest 1 ${suffix}`, slug: `rub1-${suffix}`,
    })
    await upsertForm(org.token, festivalId)

    const { ctx, page } = await loginAs(browser, org.email, org.password, baseURL)
    try {
      await page.goto(`/organiser/festivals/${festivalId}`)
      await expect(page.getByRole('heading', { name: 'Scoring criteria' })).toBeVisible({ timeout: 10_000 })

      // Default empty state
      await expect(page.getByText('No criteria set')).toBeVisible()

      // Add a criterion
      await page.fill('input[placeholder="e.g. Artistic Quality"]', 'Artistic Quality')
      await page.getByRole('button', { name: 'Add' }).click()

      // Criterion appears in the list
      await expect(page.getByText('Artistic Quality')).toBeVisible({ timeout: 5_000 })
      await expect(page.getByText('No criteria set')).not.toBeVisible()

      // Reload — persisted
      await page.reload()
      await expect(page.getByText('Artistic Quality')).toBeVisible({ timeout: 5_000 })
    } finally {
      await ctx.close()
    }
  })

  test('2 — reviewer sees per-criterion stars in slide-over (not single star)', async ({ browser }) => {
    const org = await createOrganiser(`${suffix}-org2`)
    const { festivalId } = await createFestival(org.token, {
      name: `Rubric Fest 2 ${suffix}`, slug: `rub2-${suffix}`,
    })
    await upsertForm(org.token, festivalId)
    await setFestivalStatus(org.token, festivalId, 'open')

    const applicant = await createArtist(`${suffix}-app2`)
    await createProfile(applicant.token, { displayName: `Rubric Artist ${suffix}` })
    await submitApplication(applicant.token, festivalId)

    const reviewer = await createArtist(`${suffix}-rev2`)
    await inviteReviewer(org.token, festivalId, reviewer.email)
    await setCriteria(org.token, festivalId, [
      { label: 'Artistic Quality', min: 1, max: 5 },
      { label: 'Feasibility', min: 1, max: 5 },
    ])

    const { ctx, page } = await loginAs(browser, reviewer.email, reviewer.password, baseURL)
    try {
      await page.goto(`/organiser/festivals/${festivalId}/applications`)
      await expect(page.getByRole('heading', { name: 'Applications' })).toBeVisible({ timeout: 10_000 })

      // Card shows "Score →" button, not inline stars
      await expect(page.getByRole('button', { name: /Score/i })).toBeVisible()
      await expect(page.getByLabel('Score 1')).not.toBeVisible()

      // Open slide-over
      await page.getByRole('button', { name: /Score/i }).click()

      // Per-criterion labels visible
      await expect(page.getByText('Artistic Quality')).toBeVisible({ timeout: 5_000 })
      await expect(page.getByText('Feasibility')).toBeVisible()

      // Per-criterion star buttons present
      await expect(page.getByLabel('Score Artistic Quality 3')).toBeVisible()
    } finally {
      await ctx.close()
    }
  })

  test('3 — reviewer scores criteria, panel avg appears in slide-over', async ({ browser }) => {
    const org = await createOrganiser(`${suffix}-org3`)
    const { festivalId } = await createFestival(org.token, {
      name: `Rubric Fest 3 ${suffix}`, slug: `rub3-${suffix}`,
    })
    await upsertForm(org.token, festivalId)
    await setFestivalStatus(org.token, festivalId, 'open')

    const applicant = await createArtist(`${suffix}-app3`)
    await createProfile(applicant.token, { displayName: `Rubric Artist 3 ${suffix}` })
    await submitApplication(applicant.token, festivalId)

    const reviewer = await createArtist(`${suffix}-rev3`)
    await inviteReviewer(org.token, festivalId, reviewer.email)
    const form = await setCriteria(org.token, festivalId, [
      { label: 'Artistic Quality', min: 1, max: 5 },
    ])
    const criterionId = form.review_criteria[0].id

    // Pre-score via API so there's already a score to reveal avg
    await fetch(`${API}/festivals/${festivalId}/applications/${(await submitApplication(applicant.token, festivalId)).applicationId}/score`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${org.token}` },
      body: JSON.stringify({ score: 5, criterion_id: criterionId }),
    })

    const { ctx, page } = await loginAs(browser, reviewer.email, reviewer.password, baseURL)
    try {
      await page.goto(`/organiser/festivals/${festivalId}/applications`)
      await expect(page.getByRole('button', { name: /Score/i }).first()).toBeVisible({ timeout: 10_000 })

      // Open slide-over for any card
      await page.getByRole('button', { name: /Score/i }).first().click()
      await expect(page.getByText('Artistic Quality')).toBeVisible({ timeout: 5_000 })

      // Score it
      await page.getByLabel('Score Artistic Quality 4').click()
      await page.waitForTimeout(800)

      // Panel average should appear
      await expect(page.getByText(/Panel average/i)).toBeVisible({ timeout: 5_000 })
    } finally {
      await ctx.close()
    }
  })
})
```

- [ ] **Step 2: Run spec**

```bash
npx playwright test e2e/browser/rubric-scoring.spec.ts
```

Expected: all 3 PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/browser/rubric-scoring.spec.ts
git commit -m "test(e2e): rubric scoring — add criteria UI, per-criterion stars, scoring reveals avg"
```

---

## Task 12: Final sweep

- [ ] **Step 1: Full web test suite**

```bash
task web:test
```

Expected: all pass.

- [ ] **Step 2: Full browser e2e suite**

```bash
npx playwright test
```

Expected: all pass (pre-existing stale-DB flake in `application-flow.spec.ts` is unrelated).

- [ ] **Step 3: API lint**

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
- Section 1 (rubric data model) ✓ Tasks 3, 5 — `reviewCriterion` struct, `buildCriteria` with slug+validation, `criterionInput` with optional `id` for stable re-use
- Section 2 (DB) ✓ Task 1 — `criterion_id DEFAULT 'overall'` on `application_scores`, PK 3-column, relaxed CHECK, `review_criteria jsonb DEFAULT '[]'` on `application_forms`
- Section 3 (SQL queries) ✓ Task 1 — all queries replaced; `CriterionSummaryByApplications` new; `GetMyScoresByApplications` returns criterion_id; `PatchFormCriteria` new
- Section 4a (score endpoint) ✓ Task 2 — optional `criterion_id`, defaults 'overall', validates range against form criteria, returns `criterion_id` in response
- Section 4b (form PATCH criteria) ✓ Task 3 — `review_criteria` in PATCH body, slugify, validation (max 10, max≤10, label non-empty), stable ID preservation
- Section 4c (list response) ✓ Task 4 — `criterion_scores []`, per-criterion summary batch, `my_score` = mean of scored criteria (nil if none), orphan omission
- Section 5 (OpenAPI) ✓ Task 5 — `CriterionScore` schema, fields on `Application` and `ApplicationForm`
- Section 6a (criteria builder) ✓ Task 9 — `CriteriaSection` on settings page
- Section 6b (ApplicationCard) ✓ Task 6 — `criteria` prop, "Score →" / "Edit score" button when rubric
- Section 6c (ApplicationSlideOver) ✓ Task 7 — per-criterion star rows, per-criterion panel avg
- Section 6d (handleScore) ✓ Task 8 — `criterionId` optional param, optimistic update for criteria

**Type consistency:** `ReviewCriterion` defined locally in `ApplicationCard`, `ApplicationSlideOver`, and the applications page (identical shape). `criterionScore` in Go, `CriterionScore` in OpenAPI, `criterion_scores` in JSON. `onScore(id, score, criterionId?)` consistently typed across ApplicationCard → ApplicationSlideOver → applications page.

**No placeholders:** All code blocks are complete with exact function names and expected test output.

**sqlc Scan canary:** `TestListApplications_CriterionScores_PopulatedAfterScoring` in Task 4 and the `two reviewers score` e2e test in Task 10 both assert `avg_score > 0` — catches a missing column Scan that a zero-asserting test would miss.
