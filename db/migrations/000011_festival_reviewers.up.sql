-- Festival reviewers: invited advisory panellists. Access = row exists.
-- accepted_at is informational (does not gate access).
CREATE TABLE festival_reviewers (
    festival_id uuid        NOT NULL REFERENCES festivals(id) ON DELETE CASCADE,
    user_id     uuid        NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
    accepted_at timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (festival_id, user_id)
);

CREATE INDEX idx_festival_reviewers_user_id ON festival_reviewers (user_id);

-- Per-reviewer score. PK (application_id, reviewer_id) => one score per
-- reviewer per application; reviewers never clobber each other.
CREATE TABLE application_scores (
    application_id uuid        NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    reviewer_id    uuid        NOT NULL REFERENCES users(id)        ON DELETE CASCADE,
    score          int         NOT NULL CHECK (score BETWEEN 1 AND 5),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (application_id, reviewer_id)
);

CREATE INDEX idx_application_scores_application_id ON application_scores (application_id);

-- Attribute notes to their author. Nullable: pre-existing + owner-authored
-- notes may be NULL.
ALTER TABLE application_notes ADD COLUMN author_id uuid REFERENCES users(id) ON DELETE SET NULL;
