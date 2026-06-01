# E15.3 + E15.4 Design: Publish Control UI & Prospect Profiles
**Date:** 2026-06-01
**Issues:** #178 (E15.3), #179 (E15.4)
**Part of:** #175 — Private page sharing epic

---

## E15.3 — Artist Publish Control UI

### Architecture

Two new dedicated API endpoints replace the implicit visibility change in `PATCH /profiles/me`:

- `POST /profiles/me/publish` — flips `draft → public`. Calls `billing.CanPublish`; returns 402 + JSON `{ code: "payment_required", message: "..." }` if not entitled. Returns updated profile on success.
- `POST /profiles/me/unpublish` — flips `public → draft`. Always allowed; no entitlement check.

Both live in `api/internal/artist/profile.go` alongside the existing handlers. The existing `PATCH /profiles/me` visibility field stays for backward compat but the publish gate logic is extracted into a shared helper to avoid duplication.

### Web — Status/Action Bar

The `/profile` page (`web/src/app/(artist)/profile/`) gains a `PublishBar` client component rendered at the top of the page, above the profile form.

**States:**

| Profile state | Bar shows |
|---|---|
| No profile yet | Nothing (can't publish what doesn't exist) |
| Draft, not entitled | Status: `Draft` · Preview link button · `Go Public` button (opens upsell panel) |
| Draft, entitled | Status: `Draft` · Preview link button · `Go Public` CTA (amber) |
| Public | Status: `Public` · Preview link button · `Take Offline` button |

**Preview link**: copies `${NEXT_PUBLIC_APP_URL}/profiles/preview/${profile.preview_token}` to clipboard. Falls back to showing the URL in a small tooltip if Clipboard API is unavailable.

**Upsell panel**: inline below the bar. Shows the plan picker (link to `/billing`) and "you have been gifted N months" if a `comp_grant` is active. Keeps the user on the page rather than hard-navigating.

**Go Public flow**: calls `POST /profiles/me/publish`. On 200 → refresh profile data, update status pill. On 402 → open upsell panel.

**Data flow**: `ProfilePage` (server component) fetches profile and passes it as a prop. `PublishBar` is a client component that manages optimistic state and re-fetches after mutations. Uses the existing `apiClient` from `@/lib/api`.

### E2E (browser)

`e2e/browser/artist-publish-control.spec.ts`:
- Entitled artist: create profile → publish → public page renders → unpublish → draft again
- Non-entitled artist: create profile → Go Public → upsell panel shown, profile stays draft

---

## E15.4 — Prospect Profiles + Claim-on-Signup

### Schema (migration 000018)

```sql
-- Up
ALTER TABLE artist_profiles ALTER COLUMN user_id DROP NOT NULL;
DROP INDEX artist_profiles_user_id_idx;
CREATE UNIQUE INDEX artist_profiles_user_id_idx
  ON artist_profiles (user_id) WHERE user_id IS NOT NULL;

ALTER TABLE artist_profiles
  ADD COLUMN claim_token   TEXT UNIQUE,
  ADD COLUMN claimed_at    TIMESTAMPTZ,
  ADD COLUMN created_by    UUID REFERENCES users(id);

-- Down
ALTER TABLE artist_profiles
  DROP COLUMN claim_token,
  DROP COLUMN claimed_at,
  DROP COLUMN created_by;
DROP INDEX artist_profiles_user_id_idx;
CREATE UNIQUE INDEX artist_profiles_user_id_idx ON artist_profiles (user_id);
ALTER TABLE artist_profiles ALTER COLUMN user_id SET NOT NULL;
```

### sqlc + Go changes

`artist_profiles.user_id` becomes `pgtype.UUID` with `Valid: false` for unclaimed rows. Every place that calls `p.UserID.String()` must guard against `!p.UserID.Valid`. Key touch points:

- `toProfileResponse` — `UserID` field becomes `*string` (null for unclaimed)
- `GetArtistProfileByUserID` — unchanged (only fetches rows with a valid user_id)
- New queries: `CreateProspectProfile`, `ClaimProfile`, `GetArtistProfileByClaimToken`
- `sqlcdb/artist_profiles.sql.go` Scan calls must include the three new nullable columns

### Admin Endpoint

`POST /admin/prospects` (admin-only route group in `main.go`)

Request body matches the `artist-preview-builder` skill's `seed.json` shape:
```json
{
  "display_name": "...",
  "bio": "...",
  "location_label": "...",
  "medium_tags": [...],
  "social_links": {...},
  "images": [{ "source_url": "...", "caption": "..." }]
}
```

Handler steps:
1. Validate request
2. Generate `claim_token` (UUID v4 hex string)
3. Insert `artist_profiles` row: `user_id NULL`, `visibility draft`, `claim_token`, `created_by = admin user_id`
4. Insert one collection ("Portfolio") for the prospect
5. Spawn bounded goroutine for image re-upload: for each `source_url`, call `presign → PUT → confirm → attach` to the collection (per `background-work.md` rules: bounded timeout, no `r.Context()` capture, errors logged)
6. Return `{ profile_id, claim_token, preview_url: "/profiles/preview/{preview_token}" }`

Idempotency: if a prospect with the same `display_name + created_by` already exists, return the existing record (no duplicate).

Handler lives in `api/internal/admin/prospects.go`.

### Claim on Signup

`POST /auth/signup` gains an optional `claim_token` field in the JSON request body. After the user row is created (works in both the standard and `signupBeta` paths — extract claim logic into a shared `claimProspectProfile(ctx, pool/tx, userID, claimToken)` helper called from both):

```sql
UPDATE artist_profiles
  SET user_id = $1, claimed_at = now()
  WHERE claim_token = $2 AND user_id IS NULL
  RETURNING id
```

- No row returned (already claimed or bad token) → 409 `{ code: "already_claimed" }`
- Partial unique index enforces one profile per user; attempting to claim when the user already owns a profile → unique constraint violation → 409
- On success: the signup response includes `{ claimed_profile_id: "..." }` so the web client can redirect to `/profile`

### Web — Signup Claim Flow

`web/src/app/(auth)/signup/page.tsx`: reads `?claim=` from the URL, passes it to the signup API call as `claim_token` in the request body. On success with `claimed_profile_id` in the response, redirects to `/profile` with a `?claimed=1` query param. The profile page shows a "Your page is ready — take a look!" banner if `claimed=1` is present.

### Security / Invariants

- Unclaimed profiles (`user_id IS NULL`) are excluded from `ListPublicProfiles` and from `GET /profiles/{profileID}` by any non-owner (404 always)
- Preview token is the only read path for unclaimed profiles: `GET /profiles/preview/{token}`
- Claim is atomic: conditional UPDATE with `user_id IS NULL` predicate; race-safe by construction
- Admin route group already requires `role = admin` via middleware; `POST /admin/prospects` requires no new auth work
- IDOR matrix: `GET /profiles/{id}` and all `PATCH/DELETE /collections/{id}` handlers must 404 for profiles/collections not owned by the requesting user (already enforced; tests verify it)

### E2E

New file `e2e/api/prospect-claim.test.ts`:
- Admin creates prospect → preview_url returns profile data
- Prospect not in public listing, not in `GET /profiles/{id}` for random user
- Claim at signup → profile bound, collections + images present
- Double-claim → exactly one 200, one 409 (concurrent `Promise.all`)
- Re-claim after success → 409
- IDOR: user A cannot GET or PATCH user B's unclaimed prospect collections
- Partial index: two NULL-user prospects coexist; user who already owns a profile gets 409 on second claim

---

## Sequencing

Build E15.3 first (simpler, no schema changes). E15.4 independently after. Each gets its own PR.

## Spec updates required after implementation

- `api/internal/artist/artist.spec.md` — add publish/unpublish endpoints; update `user_id` invariant for nullable; add claim token invariant
- `api/internal/admin/admin.spec.md` — add prospect creation endpoint
- `api/cmd/api/api.spec.md` — add new route registrations
- `web/src/app/(artist)/artist.spec.md` — add PublishBar component
