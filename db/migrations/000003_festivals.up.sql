-- Festivals + their full application pipeline and map spots.
--
-- festivals: organiser-owned events. Soft-deleted via deleted_at so a slug
--   can be reused after removal; the partial unique index only constrains
--   active rows. 'closed' status added for festivals that have concluded but
--   remain publicly visible (distinct from 'archived' which is organiser-
--   hidden). center_lat/center_lng support the nearby-history overlay (E26).
-- festival_artists: M:N link (invited/accepted/declined). Pin coordinates
--   were removed in favour of dedicated festival_spots.
-- application_forms: one per festival; review_criteria is a jsonb array of
--   per-criterion scoring rubrics.
-- applications: artists' submissions. rank/shortlisted/review_flag support
--   the review round; staged_decision stages accept/waitlist/decline before
--   release.
-- application_scores: PK (application_id, reviewer_id, criterion_id) — one
--   score per reviewer per criterion per application.
-- festival_spots: organiser-placed map pins. mural_status records whether
--   the mural painted at this spot is still on the wall (E26).
-- festival_reviewers: invited advisory panellists.
-- endorsements: peer + organiser endorsements of artist profiles.
--
-- Column order: see individual table comments; preserve for sqlcdb compat.

CREATE TYPE festival_status AS ENUM ('draft', 'open', 'live', 'closed', 'archived');

CREATE TABLE festivals (
    id             uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    organiser_id   uuid            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name           text            NOT NULL,
    slug           text            NOT NULL,
    description    text            NOT NULL DEFAULT '',
    location_label text            NOT NULL DEFAULT '',
    start_date     date,
    end_date       date,
    status         festival_status NOT NULL DEFAULT 'draft',
    deleted_at     timestamptz,
    created_at     timestamptz     NOT NULL DEFAULT now(),
    updated_at     timestamptz     NOT NULL DEFAULT now(),
    decisions_released_at timestamptz,
    review_opened_at      timestamptz,
    review_closed_at      timestamptz,
    center_lat     numeric(9,6),
    center_lng     numeric(9,6)
);

CREATE UNIQUE INDEX festivals_slug_idx ON festivals (slug) WHERE deleted_at IS NULL;

CREATE TYPE festival_artist_status AS ENUM ('invited', 'accepted', 'declined');

-- pin_lat/pin_lng/w3w were removed; spots are now in festival_spots.
CREATE TABLE festival_artists (
    festival_id uuid                   NOT NULL REFERENCES festivals(id) ON DELETE CASCADE,
    artist_id   uuid                   NOT NULL REFERENCES artist_profiles(id) ON DELETE CASCADE,
    status      festival_artist_status NOT NULL DEFAULT 'invited',
    created_at  timestamptz            NOT NULL DEFAULT now(),
    updated_at  timestamptz            NOT NULL DEFAULT now(),
    PRIMARY KEY (festival_id, artist_id)
);

CREATE INDEX festival_artists_artist_idx ON festival_artists (artist_id);

CREATE TABLE application_forms (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    festival_id      uuid        NOT NULL UNIQUE REFERENCES festivals(id) ON DELETE CASCADE,
    fields           jsonb       NOT NULL DEFAULT '[]',
    open_at          timestamptz,
    close_at         timestamptz,
    max_applications int,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    review_criteria  jsonb       NOT NULL DEFAULT '[]'
);

-- application_status: 'waitlisted' added for the review round.
CREATE TYPE application_status AS ENUM ('submitted', 'accepted', 'declined', 'waitlisted');

-- Column order: core fields, created/updated, then review fields (rank,
-- shortlisted, review_flag, staged_decision) in addition order.
CREATE TABLE applications (
    id              uuid               PRIMARY KEY DEFAULT gen_random_uuid(),
    form_id         uuid               NOT NULL REFERENCES application_forms(id) ON DELETE CASCADE,
    artist_id       uuid               NOT NULL REFERENCES artist_profiles(id) ON DELETE CASCADE,
    status          application_status NOT NULL DEFAULT 'submitted',
    answers         jsonb              NOT NULL DEFAULT '{}',
    created_at      timestamptz        NOT NULL DEFAULT now(),
    updated_at      timestamptz        NOT NULL DEFAULT now(),
    rank            int                NOT NULL DEFAULT 0,
    shortlisted     bool               NOT NULL DEFAULT false,
    review_flag     bool               NOT NULL DEFAULT false,
    staged_decision text               CHECK (staged_decision IN ('accept', 'waitlist', 'decline')),
    UNIQUE (form_id, artist_id)
);

-- UNIQUE (form_id, artist_id) already creates an index covering form_id lookups.
CREATE INDEX applications_artist_idx ON applications (artist_id);

-- Column order: id, application_id, content, created_at, author_id (appended).
CREATE TABLE application_notes (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id uuid        NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    content        text        NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    author_id      uuid        REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_application_notes_application_id ON application_notes (application_id);

-- PK (application_id, reviewer_id, criterion_id) — one score per reviewer
-- per criterion. score >= 1 (no upper bound; rubric drives the display max).
-- Column order: application_id, reviewer_id, score, updated_at, criterion_id.
CREATE TABLE application_scores (
    application_id uuid        NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    reviewer_id    uuid        NOT NULL REFERENCES users(id)        ON DELETE CASCADE,
    score          int         NOT NULL CHECK (score >= 1),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    criterion_id   text        NOT NULL DEFAULT 'overall',
    PRIMARY KEY (application_id, reviewer_id, criterion_id)
);

CREATE INDEX idx_application_scores_application_id ON application_scores (application_id);

-- Festival map spots. mural_status records whether the mural is still on the
-- wall (permanent/temporary/unknown). Column order: id, festival_id, number,
-- lat/lng, optional fields, artist_id, timestamps, mural_status (appended E26).
CREATE TABLE festival_spots (
    id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    festival_id uuid         NOT NULL REFERENCES festivals(id) ON DELETE CASCADE,
    number      int          NOT NULL,
    lat         numeric(9,6) NOT NULL,
    lng         numeric(9,6) NOT NULL,
    w3w         text,
    width_m     numeric(5,1),
    height_m    numeric(5,1),
    notes       text,
    artist_id   uuid         REFERENCES artist_profiles(id) ON DELETE SET NULL,
    created_at  timestamptz  NOT NULL DEFAULT now(),
    updated_at  timestamptz  NOT NULL DEFAULT now(),
    mural_status text        NOT NULL DEFAULT 'unknown'
                CHECK (mural_status IN ('permanent', 'temporary', 'unknown')),
    UNIQUE (festival_id, number)
);

-- Partial unique: one spot per artist per festival, NULLs (unassigned) exempt.
CREATE UNIQUE INDEX festival_spots_artist_idx
    ON festival_spots (festival_id, artist_id)
    WHERE artist_id IS NOT NULL;

-- Supports GetSpotHistoryForProfile (WHERE artist_id = $1).
CREATE INDEX festival_spots_artist_history_idx
    ON festival_spots (artist_id)
    WHERE artist_id IS NOT NULL;

-- Festival reviewers: invited advisory panellists. Row presence = access.
CREATE TABLE festival_reviewers (
    festival_id uuid        NOT NULL REFERENCES festivals(id) ON DELETE CASCADE,
    user_id     uuid        NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
    accepted_at timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (festival_id, user_id)
);

CREATE INDEX idx_festival_reviewers_user_id ON festival_reviewers (user_id);

-- Endorsements: peer (no festival required) + organiser (festival required).
-- festival_id references festivals which exists earlier in this file.
CREATE TABLE endorsements (
    id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    endorser_id        uuid        NOT NULL REFERENCES users(id)            ON DELETE CASCADE,
    endorsee_id        uuid        NOT NULL REFERENCES artist_profiles(id)  ON DELETE CASCADE,
    kind               varchar(20) NOT NULL CHECK (kind IN ('peer', 'organiser')),
    festival_id        uuid        REFERENCES festivals(id)                 ON DELETE SET NULL,
    body               text,
    skills             text[]      NOT NULL DEFAULT '{}',
    hidden_by_endorsee bool        NOT NULL DEFAULT false,
    moderation_status  varchar(20) NOT NULL DEFAULT 'ok'
                       CHECK (moderation_status IN ('ok', 'hidden', 'removed')),
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    UNIQUE (endorser_id, endorsee_id),
    CHECK (endorser_id <> endorsee_id),
    CHECK (kind = 'peer' OR festival_id IS NOT NULL)
);

CREATE INDEX endorsements_endorsee_idx ON endorsements (endorsee_id);
