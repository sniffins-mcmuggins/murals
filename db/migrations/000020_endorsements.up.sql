CREATE TABLE endorsements (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  endorser_id       uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endorsee_id       uuid        NOT NULL REFERENCES artist_profiles(id) ON DELETE CASCADE,
  kind              varchar(20) NOT NULL CHECK (kind IN ('peer', 'organiser')),
  festival_id       uuid        REFERENCES festivals(id) ON DELETE SET NULL,
  body              text,
  skills            text[]      NOT NULL DEFAULT '{}',
  hidden_by_endorsee bool       NOT NULL DEFAULT false,
  moderation_status varchar(20) NOT NULL DEFAULT 'ok'
                    CHECK (moderation_status IN ('ok', 'hidden', 'removed')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (endorser_id, endorsee_id),
  CHECK (endorser_id <> endorsee_id),
  CHECK (kind = 'peer' OR festival_id IS NOT NULL)
);
