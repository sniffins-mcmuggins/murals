# Admin Panel Design

**Date:** 2026-05-27  
**Status:** Approved

## Overview

An internal API for company admins to manage users, issue direct access grants, and create/distribute promo codes for free platform access. No UI in this phase — accessed via Postman/curl. A browser UI can be added later against the same endpoints.

## Authentication

Admins authenticate via the existing JWT login flow (`POST /auth/login`). Admin accounts **must** have TOTP enrolled (`mfa_enabled = true`). The login flow automatically gates them behind the `mfa_pending` token, requiring a `POST /auth/mfa/verify` call before a full session JWT is issued.

A new `RequireAdmin` middleware (in `api/internal/admin/middleware.go`) sits downstream of the existing `auth.Middleware` and enforces:

1. A valid Principal exists (→ 401 if anonymous)
2. `role == "admin"` in JWT claims (→ 403)
3. `user.mfa_enabled == true` in the DB (→ 403 with message "admin account must have MFA enrolled")

Check 3 is a safety net: if `mfa_enabled = true` in the DB and a full-scope JWT was issued, it must have been issued via the `mfa_pending → /auth/mfa/verify` path — that's the only upgrade path.

## Database — Migration 000005

### `promo_codes` table

```sql
CREATE TABLE promo_codes (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    code          text        UNIQUE NOT NULL,
    plan          text        NOT NULL,
    duration_days integer     NOT NULL,
    max_uses      integer,                -- NULL = unlimited
    use_count     integer     NOT NULL DEFAULT 0,
    expires_at    timestamptz,            -- NULL = never
    created_by    uuid        REFERENCES users(id) ON DELETE SET NULL,
    revoked_at    timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now()
);
```

### `access_grants` table

```sql
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

CREATE INDEX access_grants_user_idx ON access_grants (user_id);
CREATE INDEX access_grants_plan_idx ON access_grants (user_id, plan);
```

`granted_by` is the admin user ID for direct grants. For promo code redemptions, `promo_code_id` is set and `granted_by` is NULL.

`festival_id` is required when `plan = 'festival_activation'` — grants for that plan are scoped to a specific festival, mirroring how `organiser_payments` works. For all other plans, `festival_id` is NULL.

## Plan Identifiers

The `plan` field in both tables uses the same values already in the billing system:

| Value | Covers | Where the billing check lives |
|---|---|---|
| `artist_basic` | Artist Basic subscription | `billing.RequirePlan` middleware |
| `artist_pro` | Artist Pro subscription | `billing.RequirePlan` middleware |
| `organiser_setup` | Organiser one-off setup fee | `HasPaidSetupFee` called from checkout handlers |
| `festival_activation` | Per-festival activation fee | `HasActiveFestivalActivation` called from checkout handlers |

## Billing Middleware Changes

Two billing functions in `api/internal/billing/` gain an OR-with-grant fallback:

**`RequirePlan` middleware** (`billing/middleware.go`) — checks active subscription **or** active `access_grant` for the same plan. Uses `HasActiveGrant(ctx, q, userID, plan)`.

**`HasPaidSetupFee` and `HasActiveFestivalActivation`** are SQL queries called inline from checkout handlers, not middleware. They act as duplicate-payment guards (returning 409 if already paid). For users with an active grant these need to return `true` so the guard treats them as already having "paid" and they are not directed to Stripe checkout. Two new wrapper functions in `billing/organiser.go` and `billing/festival.go` will call the existing SQL query first, then fall back to `HasActiveGrant`.

New SQL query `HasActiveGrant`:

```sql
-- name: HasActiveGrant :one
SELECT EXISTS (
    SELECT 1 FROM access_grants
    WHERE user_id = $1
      AND plan = $2
      AND revoked_at IS NULL
      AND valid_until > now()
      AND (festival_id IS NULL OR festival_id = $3)
) AS has_grant;
```

`$3` (festival_id) is passed as a null UUID for plans that aren't festival-scoped.

No other billing logic (checkout, webhooks, Stripe sync) changes.

## Package Structure

New package `api/internal/admin/`:

| File | Responsibility |
|---|---|
| `middleware.go` | `RequireAdmin` middleware |
| `users.go` | User list, detail, password reset trigger |
| `grants.go` | Direct grant creation and revocation |
| `promo.go` | Promo code CRUD and user-facing redemption |

## Endpoints

### Admin-only routes (behind `RequireAdmin`)

```
GET    /admin/users                     List users — paginated, filterable by email
GET    /admin/users/{userID}            User detail: role, active subscription, grants
POST   /admin/users/{userID}/password-reset   Trigger password reset email (no body)
POST   /admin/users/{userID}/grants     Create direct access grant
                                          body: { plan, duration_days, note? }
DELETE /admin/grants/{grantID}          Revoke a grant early (sets revoked_at)
GET    /admin/promo-codes               List all promo codes with use_count
POST   /admin/promo-codes               Create a promo code
                                          body: { code, plan, duration_days, max_uses?, expires_at? }
DELETE /admin/promo-codes/{codeID}      Revoke a promo code (sets revoked_at)
```

### User-facing route (normal auth only)

```
POST   /promo/redeem                    body: { "code": "CPF2027FREE" }
```

Validation for `/promo/redeem`:
1. Code exists and is not revoked
2. Code has not expired (`expires_at IS NULL OR expires_at > now()`)
3. `use_count < max_uses` (or `max_uses IS NULL`)
4. This user has not already redeemed this specific code (check: no existing `access_grants` row for `(user_id, promo_code_id)`)

On success: increments `promo_codes.use_count`, writes an `access_grants` row with `valid_until = now() + duration_days`.

## SQL Queries Needed (db/queries/admin.sql)

- `ListUsers` — paginated list with optional email filter
- `GetUserByIDWithDetail` — user row (existing `GetUserByID` may suffice)
- `CreateAccessGrant`
- `RevokeAccessGrant` — sets `revoked_at = now()` by grant ID
- `HasActiveGrant` — used by `RequirePlan` middleware and organiser/festival billing wrappers
- `ListActiveGrants` — for user detail view
- `CreatePromoCode`
- `GetPromoCodeByCode` — for redemption lookup
- `GetPromoCodeByID` — for admin revoke
- `ListPromoCodes`
- `RevokePromoCode`
- `IncrementPromoUseCount`
- `HasRedeemedPromo` — checks `(user_id, promo_code_id)` uniqueness

## Password Reset Trigger

`POST /admin/users/{userID}/password-reset` reuses the existing `forgotPasswordWork` background function from `api/internal/auth/reset.go`. The admin handler looks up the user by ID, then calls the same work function. No new email template needed.

## Testing

- Unit tests for `RequireAdmin` middleware: anonymous → 401, non-admin role → 403, admin without MFA → 403, admin with MFA → passes
- Unit tests for promo redemption: expired code, over max_uses, already redeemed, valid redemption
- Unit tests for billing middleware changes: grant active → allowed, grant revoked → blocked, grant expired → blocked
- E2E coverage: create admin user via DB seed, enrol TOTP, hit admin endpoints, verify access grant unlocks a gated route

## Out of Scope

- Admin UI (browser panel) — deferred
- Ban/unban feature — deferred
- Bulk operations (bulk grant, bulk promo)
- Audit log of admin actions
