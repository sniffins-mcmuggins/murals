-- Sentinel migration: verifies the migration pipeline is working.
-- Real schema migrations start at 000002.
CREATE TABLE IF NOT EXISTS _migrations_health (
    applied_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO _migrations_health DEFAULT VALUES;
