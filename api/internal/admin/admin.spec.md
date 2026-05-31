# admin Spec
**Path:** `api/internal/admin/`
**Last updated:** 2026-05-31

## Contract
- `admin.RequireAdmin(pool)` middleware: gates routes to authenticated admin users who also have MFA enrolled; returns 401 (no principal), 403 (not admin), or 403 (MFA not enrolled)
- User management: list users, get user, set admin flag, set beta flag
- Access grants: create/revoke plan grants for users (comps, overrides)
- Promo codes: create codes, `RedeemPromoHandler` (rate-limited, handler-level auth check)
- Promo `RedeemPromoHandler` is in the rate-limited group but NOT the admin-required group — it is the public redemption endpoint; auth check is inside the handler

## Boundaries
- Does NOT manage festival content — organisers do that via the festival package
- Does NOT manage Stripe subscriptions — billing package owns those; grants are a separate DB-only mechanism

## Key Decisions
- **`RequireAdmin` re-reads `is_admin` from DB**: JWT's `is_admin` claim can be stale after demotion (TTL up to 7 days) — the middleware fetches the live user row and checks `user.IsAdmin`, NOT `principal.IsAdmin`
- **MFA required for admin**: `RequireAdmin` also verifies `user.MfaEnabled` — admin accounts without MFA cannot access any admin route, even with a valid admin JWT
- **Promo redemption is public but auth-gated at handler level**: `RedeemPromoHandler` is registered in the rate-limited group (not the admin group) so artists can redeem codes; the handler calls `auth.User(ctx)` to get the redeemer's identity
- **No `IncrementSessionVersion` on demotion**: demoting an admin does not revoke their session — the live DB check on every request is sufficient and avoids requiring every demotion path to remember to call it

## Invariants
- `RequireAdmin` MUST read `is_admin` from the live DB row — never from `principal.IsAdmin`
- `RequireAdmin` MUST also check `user.MfaEnabled` — admin without MFA is always 403
- Every new admin route group MUST have an unauthenticated e2e probe confirming 401 (see api-handler-checklist rule)

## AI Context
- `middleware.go`: `RequireAdmin` — the DB re-read pattern is the key thing; see auth-changes rule for the security rationale
- `users.go`: user management handlers
- `grants.go`: `GrantHandler`, `RevokeGrantHandler` — creates rows in `access_grants` which billing reads via `CanPublish`/`RequirePlan`
- `promo.go`: promo code CRUD + `RedeemPromoHandler` — note the dual registration (rate-limited group, not admin group) for the redemption endpoint
- `helpers.go`: `pgUUIDFromString` package-local utility

## Changelog
2026-05-31 — initial spec
