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
