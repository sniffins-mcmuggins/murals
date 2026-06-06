-- Profile setup wizard support.
-- support_url: optional "Support this artist" donation link (Buy Me a Coffee / Ko-fi / etc.)
-- setup_completed_at: stamped when the artist finishes the setup wizard (or on prospect claim);
--                     null means the artist has not completed first-run setup → show the wizard.
ALTER TABLE artist_profiles
    ADD COLUMN support_url        text,
    ADD COLUMN setup_completed_at timestamptz;
