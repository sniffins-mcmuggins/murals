CREATE TYPE analytics_event_type AS ENUM ('profile_view', 'qr_scan', 'link_click');

CREATE TABLE analytics_events (
    id          uuid                 PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type  analytics_event_type NOT NULL,
    profile_id  uuid                 NOT NULL REFERENCES artist_profiles(id) ON DELETE CASCADE,
    occurred_at timestamptz          NOT NULL DEFAULT now()
);

-- index for the aggregate query: profile + time window
CREATE INDEX analytics_events_profile_time_idx ON analytics_events (profile_id, occurred_at);
