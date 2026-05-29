-- name: UpsertApplicationScore :one
INSERT INTO application_scores (application_id, reviewer_id, score)
VALUES ($1, $2, $3)
ON CONFLICT (application_id, reviewer_id)
DO UPDATE SET score = EXCLUDED.score, updated_at = now()
RETURNING *;

-- name: ScoreSummaryByApplications :many
SELECT application_id, AVG(score)::float8 AS avg_score, COUNT(*)::int AS score_count
FROM application_scores
WHERE application_id = ANY($1::uuid[])
GROUP BY application_id;

-- name: GetMyScore :one
SELECT score FROM application_scores WHERE application_id = $1 AND reviewer_id = $2;

-- name: GetMyScoresByApplications :many
SELECT application_id, score
FROM application_scores
WHERE application_id = ANY($1::uuid[]) AND reviewer_id = $2;
