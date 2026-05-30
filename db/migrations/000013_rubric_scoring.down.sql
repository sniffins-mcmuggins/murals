ALTER TABLE application_forms DROP COLUMN review_criteria;

ALTER TABLE application_scores
  DROP CONSTRAINT application_scores_pkey,
  DROP CONSTRAINT application_scores_score_check,
  DROP COLUMN criterion_id,
  ADD CONSTRAINT application_scores_pkey
    PRIMARY KEY (application_id, reviewer_id),
  ADD CONSTRAINT application_scores_score_check
    CHECK (score BETWEEN 1 AND 5);
