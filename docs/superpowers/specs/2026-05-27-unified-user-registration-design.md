# Unified User Registration — Drop `users.role`, Derive From Behavior

**Date:** 2026-05-27
**Scope:** Drop the `users.role` ENUM (`artist | organiser | admin`). Anyone can sign up; whether they are "an artist" or "an organiser" is derived from owning an `artist_profile` row or a `festivals` row respectively. Admin becomes a boolean. Signup endpoint stops taking a role. Dashboard becomes unified.

## Problem

Today, `users.role` is set at signup and locks the user into one capability:
- Signup form forces a choice up front: artist *or* organiser.
- A user who runs a small community paint event AND paints murals themselves can't be both without two accounts.
- The OAuth callback hardcodes `Role: UserRoleArtist`, so Google/Apple sign-up can never produce an organiser.

User research (this conversation): the overlap is real and common — muralists hosting their own community events, collectives running annual jams. The lock-at-signup model is wrong.

A second motivation: the role check is **doing duplicate work**. Every endpoint that gates on role *also* needs to gate on ownership (you can't edit *any* artist profile, only yours). Role is a coarse first-pass filter that adds no real security on top of the ownership check.

## Design summary

1. Drop `users.role`. Add `users.is_admin boolean`.
2. Signup body becomes `{ email, password }`. No role. OAuth doesn't pick a role either.
3. Replace every `principal.Role != "X"` gate with an ownership check on the relevant entity. Where no entity exists yet (e.g. "create your first festival"), drop the gate — any authenticated user can create.
4. New unified dashboard at `/dashboard` showing two cards: "Your art" and "Your festivals". Either or both can be empty.
5. New endpoint `GET /me/summary` returns `{ artist_profile, festivals }` to feed the dashboard in one round trip.
6. Apply-without-profile: API returns `409 profile_required`; frontend shows inline "Set up your artist profile to apply".

## Authorization changes (the load-bearing part)

Eight production sites currently gate on role. Replacement gates:

| File:line | Today | After |
|---|---|---|
| `api/internal/festival/festival.go:77` (POST `/festivals`) | `role == organiser` | authenticated; INSERT sets `organiser_id = principal.UserID` |
| `api/internal/festival/map_editor.go:57,108` | `role == organiser` | `festival.organiser_id == principal.UserID` |
| `api/internal/billing/festival.go:22` | `role == organiser` | `festival.organiser_id == principal.UserID` for the festival being paid for |
| `api/internal/billing/organiser.go:22` (setup fee) | `role == organiser` | drop — any authenticated user can pay the setup fee; the row links to them |
| `api/internal/artist/profile.go:76` (PUT `/profiles/me`) | `role == artist` | upsert: `artist_profile.user_id == principal.UserID` (one row per user via the existing unique index) |
| `api/internal/festival/application.go:55` (POST `/applications`) | `role == artist` | user must have an `artist_profile` row → else `409 profile_required` |
| `api/internal/festival/my_applications.go:26` (GET `/my-applications`) | `role == artist` | user must have an `artist_profile` row → else `200 []` (no profile = no applications) |
| `api/internal/auth/ctx.go:45` (`RequireRole` helper) | role match | delete the helper; nothing calls it after the migration |

The principle: **ownership-of-the-relevant-entity is the only gate.** Role was redundant scaffolding.

`auth/middleware.go` continues to require a valid JWT; that is the only auth gate left for the "is this user real" question. The principal struct loses `Role` and gains `IsAdmin`.

## Schema migration

New migration `db/migrations/000005_drop_user_role.up.sql`:

```sql
-- Add is_admin, derive from existing role, drop the enum.
ALTER TABLE users ADD COLUMN is_admin boolean NOT NULL DEFAULT false;
UPDATE users SET is_admin = true WHERE role = 'admin';
ALTER TABLE users DROP COLUMN role;
DROP TYPE user_role;
```

The `.down.sql` reverses by re-creating the enum and back-filling. A user can be both an artist and an organiser after this change, so the down-migration picks one — `organiser` wins if they own any festival, else `artist`, else `admin` if `is_admin`:

```sql
CREATE TYPE user_role AS ENUM ('artist', 'organiser', 'admin');
ALTER TABLE users ADD COLUMN role user_role NOT NULL DEFAULT 'artist';
UPDATE users SET role = 'admin' WHERE is_admin;
UPDATE users SET role = 'organiser'
  WHERE id IN (SELECT DISTINCT organiser_id FROM festivals WHERE deleted_at IS NULL)
    AND NOT is_admin;
ALTER TABLE users DROP COLUMN is_admin;
```

Per `.claude/rules/sqlc-and-schema.md`: every `*.sql.go` Scan that touches `users` (including `password_reset.sql.go` which returns `users.*`) needs `&i.Role` removed and `&i.IsAdmin` added in the right ordinal position. Regenerate with `sqlc generate` if available; otherwise hand-edit both `users.sql.go` and `password_reset.sql.go` and grep-count the `&i.` calls to confirm field-count parity.

## Signup + OAuth

`api/internal/auth/signup.go`:
- `signupRequest` drops `Role`.
- Drop the `role := sqlcdb.UserRole(req.Role)` block.
- `CreateUser` query loses the role parameter (regenerate after editing `db/queries/users.sql`).

`api/internal/auth/oauth.go:197` and the parallel insert paths: drop `Role: sqlcdb.UserRoleArtist`.

`db/queries/users.sql`:
- `CreateUser` no longer takes `role`. Column list drops `role`, gains nothing (is_admin defaults to false).
- Anything else SELECT-ing `*` from users just picks up `is_admin` automatically.

JWT (`auth/jwt.go`):
- `Claims` struct loses `Role` field. Adds `IsAdmin bool`.
- `IssueToken` signature loses the role parameter.
- Every `IssueToken` call-site (login, oauth, signup, reset) drops the role argument.
- Per `.claude/rules/auth-changes.md`: this is a JWT shape change — bump `session_version` is NOT required (we're not invalidating sessions, just removing a claim), but old tokens will fail to decode and users will need to log back in. That's acceptable for a PoC pre-production.

OpenAPI spec (`api/internal/openapi/`) needs regeneration. The `User` schema loses `role`, gains `is_admin`.

## Dashboard + navigation

New endpoint `GET /me/summary`:

```json
{
  "artist_profile": { "id": "...", "display_name": "...", "avatar_url": "..." } | null,
  "festivals": [
    { "id": "...", "name": "...", "slug": "...", "status": "draft|open|live|archived" }
  ]
}
```

Implementation: one handler that runs two queries against `artist_profiles` (by user_id) and `festivals` (by organiser_id, excluding `deleted_at`) in parallel.

The existing `web/src/app/(artist)/dashboard/page.tsx` already resolves to `/dashboard` (route groups in parens don't affect URLs). Repurpose it as the unified dashboard:

- Move the file out of the `(artist)` group to `web/src/app/dashboard/page.tsx` so it's no longer scoped to an artist-only group/layout. If `(artist)/layout.tsx` does anything important (e.g. shared chrome), copy what's needed into the new file or a sibling layout.
- The new `/dashboard/page.tsx` server-fetches `/me/summary` using `API_URL` (per `.claude/rules/e2e-debugging.md`).
- Renders two cards:
  - **Your art**: if `artist_profile` is null, empty state with "Set up your artist profile" CTA → links to the existing profile editor under `(artist)/`. If present, shows display name, avatar, and "Manage profile" link.
  - **Your festivals**: if list is empty, empty state with "Create a festival" CTA → links to the existing festival creation flow under `organiser/`. If present, shows a list with names/status and a link to manage each.

The existing `organiser/dashboard/page.tsx` at `/organiser/dashboard` stays as the deeper "festivals management" page (or rename/move later — out of scope here). The unified `/dashboard` links into it.

Login redirect changes:
- `web/src/app/(auth)/login/page.tsx` (or wherever the post-login redirect lives): redirect to `/dashboard`, not the old role-branched destination.

Existing route groups `(artist)` and `organiser/` stay where they are. The change is just:
- Remove any "you're not an artist/organiser, go away" client-side guards. Server-side ownership checks are now the only gate.
- Both nav groups become reachable from the dashboard.

## Apply-without-profile UX

API: `POST /applications` returns `409 Conflict` with body `{"error":"profile_required","message":"Create an artist profile to apply"}` when the user has no `artist_profile`.

Web: the festival application page (`web/src/app/(public)/festivals/[id]/apply/...`) checks for this status on submit. On 409 profile_required, shows an inline panel: "You need an artist profile to apply. [Set up profile]". The link routes to `/profile/edit` — no return-URL plumbing for PoC; the user re-finds the festival afterwards. (Future: encode a `?next=` param.)

## Testing changes

**E2E helpers (`e2e/fixtures/helpers.ts`):**
- `createArtist(...)` and `createOrganiser(...)` collapse into `createUser(...)`. Signup body is `{email, password}`. Return shape unchanged otherwise.
- Where a test needs "an artist", it calls `createUser` then `POST /profiles` to create the artist profile.
- Where a test needs "an organiser", it calls `createUser` then `POST /festivals` to create a festival.

**API gate (`e2e/api/golden-path.test.ts`):**
- The 18 sequential `it(...)` blocks: drop `role` from any signup payload. Add an explicit "create artist profile" step before the first apply call. Add "create festival" step before any organiser-only path.

**Browser specs (`e2e/browser/*.spec.ts`):**
- `application-flow.spec.ts`: needs an artist-profile-creation step before the apply.
- `artist-onboarding.spec.ts`: unchanged in spirit but uses `createUser` + profile setup.
- `organiser-setup.spec.ts`: unchanged in spirit but uses `createUser` + festival creation.
- `public-visitor.spec.ts`: unaffected.
- **New spec recommended:** `apply-without-profile.spec.ts` covering the 409 path and the inline CTA. One short test.

**Unit tests:**
- `auth/signup_test.go`, `auth/oauth_test.go`, `auth/login_test.go`: drop role assertions, drop role from request bodies, assert `is_admin: false` on the user response where useful.
- Every test in `billing/`, `artist/`, `festival/` that constructs a `Principal` literal: drop the `Role:` field, add `IsAdmin: false` where the test explicitly needs the admin path (none currently do).
- `auth/middleware_test.go`: `TestMiddleware_StaleSessionVersionRejected` is the canary per `.claude/rules/auth-changes.md`; this should keep passing because we're not touching the session_version logic.

## File-by-file change list

**Schema/SQL:**
- `db/migrations/000005_drop_user_role.up.sql` (new)
- `db/migrations/000005_drop_user_role.down.sql` (new)
- `db/queries/users.sql` (drop role from CreateUser)
- `api/internal/sqlcdb/models.go` (regenerated)
- `api/internal/sqlcdb/users.sql.go` (regenerated)
- `api/internal/sqlcdb/password_reset.sql.go` (regenerated — returns `users.*`)

**API (auth):**
- `api/internal/auth/signup.go`
- `api/internal/auth/oauth.go`
- `api/internal/auth/login.go` (token issue call site)
- `api/internal/auth/reset.go` (token issue call site)
- `api/internal/auth/jwt.go` (Claims struct, IssueToken signature)
- `api/internal/auth/middleware.go` (principal hydration)
- `api/internal/auth/ctx.go` (delete RequireRole helper, update Principal struct)
- `api/internal/auth/user.go` (toUserResponse: drop role, add is_admin)

**API (handlers — drop role gate):**
- `api/internal/festival/festival.go`
- `api/internal/festival/map_editor.go`
- `api/internal/festival/application.go`
- `api/internal/festival/my_applications.go`
- `api/internal/artist/profile.go`
- `api/internal/billing/festival.go`
- `api/internal/billing/organiser.go`

**API (new):**
- `api/internal/me/summary.go` (new handler `GET /me/summary`)
- `api/cmd/api/main.go` (route registration)

**OpenAPI:**
- `api/internal/openapi/openapi.yaml` (or wherever the source lives) — regenerate the generated files.

**Web:**
- Move `web/src/app/(artist)/dashboard/page.tsx` → `web/src/app/dashboard/page.tsx`, rewrite as the unified two-card view
- `web/src/app/(auth)/login/.../page.tsx` (post-login redirect → `/dashboard`)
- `web/src/app/(public)/festivals/[id]/apply/...` (409 handling, inline CTA)
- Remove any client-side role guards (search `web/` for `role ===`).

**Tests:**
- `e2e/fixtures/helpers.ts`
- `e2e/api/golden-path.test.ts`
- `e2e/browser/application-flow.spec.ts`
- `e2e/browser/artist-onboarding.spec.ts`
- `e2e/browser/organiser-setup.spec.ts`
- `e2e/browser/apply-without-profile.spec.ts` (new)
- Every `*_test.go` constructing a Principal literal or sending a signup with a role.

## Non-goals

- No capability flags (`users.capabilities[]`). Ownership-of-entity is the model; an extra column adds nothing.
- No `?next=` redirect plumbing for the apply-without-profile flow. PoC.
- No admin UI redesign. `is_admin` is a boolean; the existing admin paths (if any) keep working with a one-line check.
- No JWT versioning / forced re-login orchestration. Old tokens will fail to decode (because the `Role` claim is gone); users log back in. Acceptable for PoC.
- No data backfill beyond the migration. Existing users continue to have whatever artist_profiles/festivals they had; the cross-product (artist who can now also organise) is unlocked by removing the gate, not by writing data.

## Open questions

None — all design choices delegated to author per user instruction ("do what you think is best, we're still PoC").

## Risks

- **JWT shape change forces re-login.** Mitigation: documented in the migration plan; users see a one-time "session expired, log in again". Acceptable pre-production.
- **sqlc field-count drift.** Mitigation: the rule in `.claude/rules/sqlc-and-schema.md` is the canonical defense; the implementation plan will include the grep-count check.
- **`organiser_id` is still on `festivals` but the column comment says "user with role=organiser".** Update the migration comment in `000003_festivals.up.sql`? No — never edit merged migrations (`.claude/rules/sqlc-and-schema.md`). The new migration's comment block can explain.
