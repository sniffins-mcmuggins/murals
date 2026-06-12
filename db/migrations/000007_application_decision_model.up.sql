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
