-- Promo codes: distributable codes granting free platform access.
-- max_uses NULL = unlimited. expires_at NULL = never expires.
CREATE TABLE promo_codes (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    code          text        UNIQUE NOT NULL,
    plan          text        NOT NULL,
    duration_days integer     NOT NULL,
    max_uses      integer,
    use_count     integer     NOT NULL DEFAULT 0,
    expires_at    timestamptz,
    created_by    uuid        REFERENCES users(id) ON DELETE SET NULL,
    revoked_at    timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now()
);

-- Access grants: free-access records for a user+plan, sourced either from a
-- direct admin grant (granted_by set) or a promo code redemption (promo_code_id set).
-- festival_id is required when plan = 'festival_activation'.
CREATE TABLE access_grants (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan          text        NOT NULL,
    festival_id   uuid        REFERENCES festivals(id) ON DELETE SET NULL,
    valid_until   timestamptz NOT NULL,
    granted_by    uuid        REFERENCES users(id) ON DELETE SET NULL,
    promo_code_id uuid        REFERENCES promo_codes(id) ON DELETE SET NULL,
    note          text,
    revoked_at    timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX access_grants_user_idx  ON access_grants (user_id);
CREATE INDEX access_grants_plan_idx  ON access_grants (user_id, plan);
