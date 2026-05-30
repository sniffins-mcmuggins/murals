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
