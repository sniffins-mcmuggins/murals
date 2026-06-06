# artist Spec
**Path:** `api/internal/artist/`
**Last updated:** 2026-06-01

## Contract
- Support link: `support_url` (nullable http(s)) on profile responses + `supportUrl` on PATCH /profiles/me (422 on malformed URL)
- Setup completion: `setup_completed_at` (owner responses only) + `POST /profiles/me/complete-setup` stamps it idempotently; claiming a prospect also stamps it
- CRUD for artist profiles: create, get-mine, update, public-get (by profile ID)
- Spot history: `GET /profiles/{profileID}` includes `spot_history` — spots from live/closed festivals where this artist was assigned; always an array (never null)
- Collections: create, get, patch, reorder, delete
- Collection images: add, reorder, delete, set-cover
- QR code: generate branded PNG for the artist's public profile URL
- Public listing: `ListPublicProfilesHandler` — returns only `visibility: public` profiles
- Visibility gating: `GET /profiles/{profileID}` — 404 for non-public profiles
- Preview sharing: `GET /profiles/preview/{token}` — returns any profile (draft or public) matching the `preview_token`; no auth required; token is the secret
- Preview token rotation: `POST /profiles/me/preview-token/rotate` — generates a new token, invalidating any previously shared preview links; owner-only
- Publish: `POST /profiles/me/publish` — flips draft → public, gated on `billing.CanPublish`; 402 if not entitled
- Unpublish: `POST /profiles/me/unpublish` — flips public → draft; always allowed
- Unclaimed prospect profiles: accessible only via preview token; never returned by GET /profiles/{id} or public listing

## Boundaries
- Does NOT own subscription/entitlement logic — calls `billing.CanPublish` to check publish eligibility
- Does NOT own analytics events — fires profile-view events via the analytics package on public profile reads
- Does NOT own festival applications — the festival package manages those

## Key Decisions
- **One profile per user**: `CreateProfileHandler` enforces uniqueness via DB constraint; calling it twice returns 409
- **Visibility states**: `draft` (owner only) and `public` (world-readable). No intermediate state.
- **Publish gate**: `PATCH /profiles/me` with `visibility: public` calls `billing.CanPublish` — returns 402 (not 403) if the user has no active subscription or grant. The canonical publish actions are `POST /profiles/me/publish` and `POST /profiles/me/unpublish` — prefer these over the PATCH visibility field.
- **Collections have `display_order`**: default `0`; ordered by `(display_order, created_at)`. Tests that assert creation order MUST call the reorder endpoint first — two rows created in the same millisecond under parallel load have a non-deterministic natural order
- **Images have a two-step flow**: presign (→ `image` package), PUT to MinIO (→ client), confirm (→ `image` package), then attach to collection. The `artist` package only handles attach + set-cover
- **Downgrade behaviour**: data exceeding a plan limit is locked (not deleted) when an artist downgrades
- **Preview token is the secret**: opaque UUID-derived string stored on the profile row; not a JWT, carries no claims. Sharing the URL grants access. Rotating revokes all previously shared links immediately.
- **`preview_token` omitted from public responses**: `toProfileResponse(p, public=true)` sets `PreviewToken = nil`; only the rotate response (`public=false`) returns it so the owner can copy the new link
- **Nullable user_id**: profiles owned by nobody until claimed; the partial unique index (WHERE user_id IS NOT NULL) enforces 1:1 user↔profile invariant only for claimed profiles

## Invariants
- Public profile read MUST return 404 (not 403) for non-public profiles — information about private profiles must not leak
- `preview_token` MUST NOT appear in any response where `toProfileResponse` is called with `public=true` — the token is the access credential
- QR code encodes the public profile URL — always `/p/{profile_id}`, never a route that might change
- `display_order` must never be assumed unique — ties are broken by `created_at`, and two rows can share the same millisecond
- `/profiles/me` and `/profiles/preview/{token}` are literal sub-paths — they MUST remain registered before `/{profileID}` in `main.go`
- GET /profiles/{profileID} MUST 404 for unclaimed profiles (user_id IS NULL) regardless of requester's auth state

## AI Context
- `profile.go`: profile CRUD + visibility management + publish gate + `RotatePreviewTokenHandler` + `PreviewByTokenHandler`; `toProfileResponse` returns `UserID *string` (null for unclaimed prospects, set since migration 000018)
- `publish.go`: `PublishHandler`, `UnpublishHandler` — thin wrappers around `SetArtistProfileVisibility` query + billing gate
- `collection.go`: collection CRUD + reorder
- `collection_image.go`: image attach/reorder/delete/set-cover — reads `s3_key` from the confirmed image record
- `qr.go`: QR code generation — uses `github.com/skip2/go-qrcode`; output is PNG bytes returned directly
- `errors.go`: package-level sentinel errors used across handlers
- `testhelpers_test.go`: shared helpers for creating profiles, collections, images in tests — check before writing new test setup
- Analytics: `profile.go` fires a `profile_view` event on public reads — this calls into the analytics package; do not remove it accidentally when refactoring the public GET handler

## Changelog
2026-06-06 — Profile setup wizard backend: support_url + setup_completed_at columns; complete-setup endpoint; claim stamps setup_completed_at.
2026-06-05 — E26: spot_history added to public profile response (live/closed festivals only); always [] not null.
2026-06-01 — E15.4: nullable user_id, prospect profile visibility invariants
2026-06-01 — E15.3: publish/unpublish endpoints, preview_token in ArtistProfile response, PublishBar web component
2026-05-31 — initial spec
