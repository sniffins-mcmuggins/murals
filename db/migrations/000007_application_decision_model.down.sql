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
