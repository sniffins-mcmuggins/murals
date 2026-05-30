# Configurable Multi-Criteria Scoring Rubric — Design Spec

**Date:** 2026-05-30
**Status:** Draft
**Issue:** #157
**Scope:** Extend reviewer scoring from a single 1–5 value to a configurable per-criterion rubric. When no criteria are configured the system behaves identically to today; when criteria are present each reviewer scores each criterion independently and a per-criterion aggregate is surfaced on the board.

---

## Overview

Today every reviewer submits a single integer (1–5) against the whole application. Zealous's strongest differentiator is a configurable rubric where organisers define named dimensions (e.g. *Artistic Quality*, *Community Impact*, *Technical Skill*) with their own score ranges, and the dashboard shows per-criterion averages in real time. Matching this feature closes the remaining gap on the organiser-review comparison.

The implementation is intentionally backward-compatible: `review_criteria = []` (the default) preserves existing behaviour exactly. The single-star widget, the `my_score` reveal guard for anonymous review, and all existing e2e tests remain valid without changes.

---

## 1. Rubric data model

A criterion is a small JSON object stored in the `review_criteria` array on `application_forms`:

```jsonc
{
  "id":    "artistic-quality",    // stable slug; URL-safe, lowercase, hyphenated
  "label": "Artistic Quality",    // display label
  "min":   1,                     // inclusive lower bound
  "max":   5                      // inclusive upper bound
}
```

`id` is assigned by the API when the organiser adds a criterion (slugified from `label`, made unique within the form's criteria). Once created it never changes, so stored `application_scores.criterion_id` rows remain valid even if the label is renamed. If a criterion is deleted its score rows become orphaned; the list handler silently omits orphaned criterion scores from the response rather than erroring.

**Invariants enforced by the API at write time:**
- `label` non-empty, ≤ 80 chars.
- `min ≥ 1`, `max ≥ min`, `max ≤ 10` (keeps star controls practical).
- `id` unique within the form's criteria array.
- Max 10 criteria per form (prevents pathologically wide rubrics).

---

## 2. Database

**Migration:** `db/migrations/000013_rubric_scoring.up.sql`

```sql
-- Add per-criterion score support to application_scores.
-- criterion_id 'overall' is the implicit single-criterion used when no rubric
-- is configured. Existing rows (all criterion_id = 'overall') remain valid.

-- Step 1: drop the old 2-column PK and constraint, add criterion_id column.
ALTER TABLE application_scores
  DROP CONSTRAINT application_scores_pkey,
  DROP CONSTRAINT application_scores_score_check,
  ADD COLUMN criterion_id text NOT NULL DEFAULT 'overall',
  ADD CONSTRAINT application_scores_pkey
    PRIMARY KEY (application_id, reviewer_id, criterion_id),
  ADD CONSTRAINT application_scores_score_check
    CHECK (score >= 1);

-- Step 2: add review_criteria to application_forms.
ALTER TABLE application_forms
  ADD COLUMN review_criteria jsonb NOT NULL DEFAULT '[]';
```

**Down migration** (`000013_rubric_scoring.down.sql`):

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

**sqlc scan verification** after `task db:generate`:

```bash
# application_scores.sql.go — now 4 columns
grep -c '&i\.' api/internal/sqlcdb/application_scores.sql.go

# application_forms.sql.go — now 10 columns
grep -c '&i\.' api/internal/sqlcdb/application_forms.sql.go
```

---

## 3. SQL queries

### `db/queries/application_scores.sql` — replace entirely

```sql
-- name: UpsertApplicationScore :one
INSERT INTO application_scores (application_id, reviewer_id, criterion_id, score)
VALUES ($1, $2, $3, $4)
ON CONFLICT (application_id, reviewer_id, criterion_id)
DO UPDATE SET score = EXCLUDED.score, updated_at = now()
RETURNING *;

-- name: DeleteApplicationScore :exec
DELETE FROM application_scores
WHERE application_id = $1 AND reviewer_id = $2 AND criterion_id = $3;

-- name: ScoreSummaryByApplications :many
-- Overall average + count across all criteria per application.
SELECT
  application_id,
  AVG(score)::float8 AS avg_score,
  COUNT(DISTINCT reviewer_id)::int AS score_count
FROM application_scores
WHERE application_id = ANY($1::uuid[])
GROUP BY application_id;

-- name: CriterionSummaryByApplications :many
-- Per-criterion average + count for a batch of applications.
SELECT
  application_id,
  criterion_id,
  AVG(score)::float8 AS avg_score,
  COUNT(*)::int AS score_count
FROM application_scores
WHERE application_id = ANY($1::uuid[])
GROUP BY application_id, criterion_id;

-- name: GetMyScoresByApplications :many
-- All criterion scores for the calling reviewer across a batch of applications.
SELECT application_id, criterion_id, score
FROM application_scores
WHERE application_id = ANY($1::uuid[]) AND reviewer_id = $2;
```

**Note on `score_count`:** Previously counted rows (= one per reviewer). Now uses `COUNT(DISTINCT reviewer_id)` so the count reflects the number of reviewers who scored at least one criterion, not the total number of criterion-score rows. This preserves the semantics the web badge relies on.

### `db/queries/application_forms.sql` — add one query

```sql
-- name: PatchFormCriteria :one
UPDATE application_forms
SET review_criteria = $2, updated_at = now()
WHERE festival_id = $1
RETURNING *;
```

---

## 4. API

### 4a. Score endpoint — `PUT /festivals/{festivalID}/applications/{applicationID}/score`

**Request body** (unchanged shape, one new optional field):

```jsonc
{ "score": 4 }                                    // no-rubric: stores as criterion_id='overall'
{ "score": 3, "criterion_id": "artistic-quality" } // rubric: stores for named criterion
```

When `criterion_id` is absent the handler defaults it to `"overall"`. This preserves exact backward compatibility — the existing web client, tests, and e2e suite all continue to work without modification.

**Validation:**
- `criterion_id` must match one of the form's criteria IDs, OR be `"overall"` (always valid as the no-rubric fallback).
- `score` must be within `[criterion.min, criterion.max]`. When criterion_id is `"overall"` the range is `[1, 5]` (the historic default). Returns 422 on range violation.
- COI guard (reviewer cannot score their own application) is unchanged.

**Response** (unchanged shape):

```jsonc
{ "application_id": "...", "criterion_id": "artistic-quality", "score": 3 }
```

### 4b. Form criteria — `PATCH /festivals/{festivalID}/form`

Extend the existing `PatchFormHandler` to accept `review_criteria`:

```go
var req struct {
    AnonymousReview *bool            `json:"anonymous_review"`
    ReviewCriteria  *[]criterionInput `json:"review_criteria"`
}

type criterionInput struct {
    Label string `json:"label"`
    Min   int    `json:"min"`
    Max   int    `json:"max"`
}
```

When `review_criteria` is non-nil the handler:
1. Validates each entry (label non-empty, 1 ≤ min ≤ max ≤ 10, ≤ 10 criteria total).
2. Assigns a stable `id` to each criterion: `slug(label)` made unique within the array by appending `-2`, `-3` etc. on collision.
3. Merges with the existing criteria array: criteria whose generated `id` already exists keep their existing `id` (re-slugifying the same label is idempotent). New labels get a fresh `id`.
4. Calls `PatchFormCriteria` to persist.
5. Returns the full `formResponse` including updated `review_criteria`.

The `GET /festivals/{festivalID}/form` (owner-only enriched path) returns `review_criteria` in the form response. The public path (`toPublicFormResponse`) omits it — artists submitting applications have no need to see the scoring rubric.

### 4c. Application list — `GET /festivals/{festivalID}/applications`

The `applicationResponse` gains one new field:

```go
type criterionScore struct {
    CriterionID string   `json:"criterion_id"`
    Label       string   `json:"label"`
    Min         int      `json:"min"`
    Max         int      `json:"max"`
    AvgScore    *float64 `json:"avg_score"`  // null if no scores yet
    ScoreCount  int      `json:"score_count"`
    MyScore     *int32   `json:"my_score"`   // null if caller hasn't scored this criterion
}

type applicationResponse struct {
    // …existing fields…
    CriterionScores []criterionScore `json:"criterion_scores"` // empty when no rubric
}
```

**Assembly logic in `ListApplicationsHandler`:**

After the existing score-summary and my-score batch fetches, if `form.ReviewCriteria` is non-empty:

1. Batch-fetch per-criterion summaries via `CriterionSummaryByApplications`.
2. Batch-fetch caller's per-criterion scores (already returned by the updated `GetMyScoresByApplications`).
3. For each application, build `criterion_scores` from the form's criteria config, joining the aggregates and the caller's scores. Omit orphaned criterion IDs (IDs present in scores but absent from the current form criteria config).
4. `my_score` (the top-level field): remains the mean of all the caller's scored criteria, rounded to nearest int. If the caller has scored zero criteria, `my_score` is `nil`. This preserves the anonymous-reveal guard (`shouldAnonymise` checks `myScore == nil`) without any changes to that function.
5. `avg_score` (the top-level field): mean of per-criterion averages, or nil if no scores exist.

When `form.ReviewCriteria` is empty, `criterion_scores` is `[]` and the existing `avg_score`/`score_count`/`my_score` fields are populated as today.

**Note on `score_count`:** Uses `COUNT(DISTINCT reviewer_id)` from the updated `ScoreSummaryByApplications` — counts reviewers, not criterion-score rows.

---

## 5. OpenAPI

Add to `ApplicationForm`:
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

Add to `Application`:
```yaml
        criterion_scores:
          type: array
          items:
            $ref: "#/components/schemas/CriterionScore"
```

Add new schema:
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

Add `review_criteria` to the `PATCH /form` request body schema.

Regenerate: `task openapi:gen`.

---

## 6. Frontend (web)

### 6a. Criteria builder on the festival settings page

New `CriteriaSection` component (inline in `festivals/[id]/page.tsx`, like `AnonymousReviewSection`). Owner-only (page already gated). Rendered between the anonymous review section and the reviewers section.

Fetches `GET /festivals/{id}/form` (same query key as the anonymous toggle — they share cache). Renders:
- List of configured criteria with label, min, max, and a remove button.
- "Add criterion" inline form: text input for label, number inputs for min (default 1) and max (default 5), "Add" button.
- On add: calls `PATCH /form` with `{ review_criteria: [...existing, newCriterion] }`.
- On remove: calls `PATCH /form` with the criterion filtered out.
- Empty state: "No scoring criteria. Reviewers score each application with a single 1–5 rating."

The section is only shown when a form exists (same `formQuery.data == null` guard as `AnonymousReviewSection`).

### 6b. `ApplicationCard` — reviewer mode with rubric

When `application.criterion_scores.length > 0` (rubric configured):
- Hide the inline star control.
- Show a compact `"Score →"` text button that calls `onSelect(application)` to open the slide-over where the full rubric is available.
- The avg badge remains: `★ {avg_score?.toFixed(1)} · {score_count}` gated on `my_score != null` (unchanged).

When `criterion_scores` is empty (no rubric): existing inline star control is unchanged.

### 6c. `ApplicationSlideOver` — criteria-aware scoring

The "Your Score" section currently shows 5 stars. Extend to be rubric-aware:

**No criteria (`criterion_scores` empty):** existing 5-star control unchanged.

**With criteria:** replace the single star row with one row per criterion:

```
Artistic Quality  (1–5)   ★ ★ ★ ☆ ☆   3 / 5
Technical Skill   (1–5)   ★ ★ ☆ ☆ ☆   2 / 5
Community Impact  (1–5)   ☆ ☆ ☆ ☆ ☆   Not yet scored
```

Each row is an independent star control (max = criterion.max). Clicking a star calls `onScore(appId, score, criterionId)` — extends the existing `onScore` signature with an optional third argument.

**Panel average section** (already present): when criteria, show per-criterion averages below the overall:

```
Panel average
★ 3.2  from 2 reviewers

  Artistic Quality   ★ 3.5 avg
  Technical Skill    ★ 3.0 avg
  Community Impact   ★ 3.0 avg
```

Only shown when `my_score != null` (unchanged guard).

### 6d. Applications page — `handleScore` updated

`handleScore(applicationId, score, criterionId = 'overall')` — adds optional third parameter passed through to `scoreMutation`.

`scoreMutation` body: `{ score, criterion_id: criterionId }`.

Optimistic update: when `criterionId === 'overall'`, update `my_score` as today. When a specific criterion: update `criterion_scores[criterion].my_score` and recompute `my_score` as mean of all scored criteria.

---

## 7. Testing

### API unit tests

**`score_test.go` additions:**
- `TestScore_WithCriterionID` — owner scores a named criterion; response contains `criterion_id`.
- `TestScore_InvalidCriterionRange` — score outside `[min, max]` → 422.
- `TestScore_UnknownCriterionID` — criterion_id not in form criteria → 422.
- `TestScore_NoCriterionDefaultsToOverall` — omitting criterion_id stores `'overall'`.

**`form_test.go` additions:**
- `TestPatchForm_Criteria_AddAndRemove` — adds 2 criteria, verifies IDs assigned; removes one, verifies remaining.
- `TestPatchForm_Criteria_LabelCollision` — two criteria with same label get distinct IDs (`creativity`, `creativity-2`).
- `TestPatchForm_Criteria_Validation` — max > 10 → 422; empty label → 422; > 10 criteria → 422.

**`review_test.go` additions:**
- `TestListApplications_CriterionScores_PopulatedAfterScoring` — scores two criteria; `criterion_scores` returned with correct `avg_score` and `my_score`; top-level `my_score` is mean of the two. This is the **sqlc Scan canary** — asserts non-zero values, catching a missing column in Scan.
- `TestListApplications_CriterionScores_EmptyWhenNoCriteria` — `criterion_scores` is `[]` when form has no criteria.
- `TestListApplications_OrphanedCriterionScores_Omitted` — score a criterion, remove it from form criteria, list response omits it.

### E2E API (`e2e/api/rubric-scoring.test.ts`)

- Auth probe: `PATCH /form` with `review_criteria` by non-owner → 403.
- Add criteria via PATCH, verify `GET /form` returns them (owner-only path).
- Reviewer scores criterion 1 → `criterion_scores[0].my_score` set; `my_score` (top-level) non-null → anonymous reveal fires.
- Reviewer scores all criteria → `avg_score` matches expected mean.
- **sqlc canary**: two reviewers score; `criterion_scores[0].avg_score` is non-zero in the list JSON.
- Unknown criterion_id → 422.

### Browser spec (`e2e/browser/rubric-scoring.spec.ts`)

- Organiser adds two criteria on the festival settings page; criteria appear in the list.
- Reviewer sees per-criterion star rows in the slide-over (not the single star widget).
- Reviewer scores criterion 1; `★` row updates; slide-over shows "Panel average" section.
- Scores persist on page reload.

---

## 8. Constraints

- **Backward compatibility is absolute.** When `review_criteria = []`, the API, web, and all existing tests behave exactly as today. No migrations to existing data; `DEFAULT 'overall'` covers all existing rows.
- **Immutable criterion IDs.** Once a criterion is scored, its `id` is locked. Deleting a criterion orphans its scores (silently omitted from responses, not deleted). The API does not prevent deleting a criterion that has been scored — the organiser's choice.
- **Score range enforced at application layer, not DB.** The DB constraint is `score >= 1`; the `[min, max]` validation happens in the Go handler against the form's criteria config. This avoids complex DB-level validation.
- **`my_score` (top-level) = mean of caller's scored criteria (rounded).** Nil when zero criteria scored. This preserves the anonymous-reveal guard without any changes to `shouldAnonymise`.
- **`score_count` = distinct reviewers who scored ≥ 1 criterion.** Not the total number of criterion-score rows.
- **Criteria are form-level, not festival-level.** Consistent with all other form settings (`fields`, `anonymous_review`). Multi-round selection (#159) will layer round-specific criteria on top.

---

## Out of scope

- Score distribution histograms / visualisations (issue mentions "show score distribution" — addressed by per-criterion averages in the slide-over; full histogram charts are a future enhancement).
- Criterion weights (all criteria contribute equally to the overall mean).
- Mandatory vs optional criteria (all criteria are optional; a reviewer can score some and not others).
- Round-specific criteria (issue #159).
- Bulk score submission endpoint (clients submit one criterion at a time; each click is one PUT — acceptable given the small number of criteria per form).
