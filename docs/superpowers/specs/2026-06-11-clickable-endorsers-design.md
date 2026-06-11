# Clickable Endorsers on the Artist Page — Design

**Date:** 2026-06-11
**Status:** Approved for implementation
**Area:** `api/internal/endorsement`, `db/`, `openapi/`, `web/(public)/artists/[id]`

## Problem

On a public artist page (`/artists/{id}`), endorsements show the endorser's avatar
and display name as static text. A visitor who wants to see who endorsed an artist
has no way to navigate to that person. The endorsement is a discovery signal — it
should be a hyperlink into the endorser.

Example: <http://localhost:3000/artists/1c6f5f64-6eb3-4c8d-9f60-8aef6a979d7a>

## Goal

Make the author of each endorsement clickable:

- **Peer (artist) endorsers** link to their own public artist page,
  `/artists/{endorser_profile_id}`.
- **Organiser endorsers** link to the endorsing festival's public page,
  `/festivals/{festival_id}`.
- **Unpublished peer endorsers** (no published profile snapshot) render as plain
  text — never produce a link that would land on a 404.

## Constraints / current state

- `GET /profiles/{id}/endorsements` (public list) returns `endorser_id` — a
  `users.id`, **not** an `artist_profiles.id`. Public artist pages are keyed by
  profile id, so the frontend cannot build a peer link from the current DTO. This
  is the only real gap.
- `ListPublicEndorsements` already `LEFT JOIN artist_profiles ap ON ap.user_id =
  e.endorser_id`, so `ap.id` (the endorser's profile id) is one column away.
- Public artist pages (`GET /profiles/{id}`) are gated on
  `artist_profiles.visibility = 'public'` — draft profiles `notFound()` for
  non-owners. A peer endorser is therefore only safely linkable when their
  profile visibility is `public`. (Snapshots freeze the *content* of a public
  profile but are not the visibility gate; a public profile renders via
  live-assembly even before its first snapshot.)
- Organiser endorsements always carry `festival_id` (DB `CHECK (kind = 'peer' OR
  festival_id IS NOT NULL)`), so the organiser link target always exists.
- The DTO already exposes `festival_id` and `festival_name`.

## Design

### 1. DB query — `db/queries/endorsements.sql` (`ListPublicEndorsements`)

Add a visibility-gated endorser profile id. The `artist_profiles` join already
exists; emit `ap.id` only when the endorser's profile is public:

```sql
(CASE WHEN ap.visibility = 'public' THEN ap.id END)::uuid AS endorser_profile_id
```

The `::uuid` cast is required so sqlc infers `pgtype.UUID` rather than
`interface{}`. `endorser_profile_id` is therefore `NULL` for organisers (no
artist profile) and for draft peers. "Not public → plain text" becomes a server
guarantee, not a client guess.

Only `ListPublicEndorsements` changes. `ListReceivedEndorsements` (endorsee
management view) is untouched — it does not render public links.

Regenerate with `task db:generate`; grep-verify the scan column count on
`endorsements.sql.go` per the sqlc-and-schema rule.

### 2. API DTO — `api/internal/endorsement/endorsement.go`

Add to the **public** response struct only (built by `toRowResponse`):

```go
EndorserProfileID *string `json:"endorser_profile_id,omitempty"`
```

`nil` for organisers and unpublished peers. `toReceivedRowResponse` (management
view) does not get the field.

### 3. OpenAPI — `openapi/openapi.yaml`

Add `endorser_profile_id` (nullable string) to the public endorsement schema.
Not added to `required`. Regenerate the TS client and Go via `task openapi:gen`
from the repo root; commit both generated files (CI's "OpenAPI — no drift" job).

### 4. Web — `web/src/app/(public)/artists/[id]/page.tsx`

- **Peer block:** when `e.endorser_profile_id` is set, wrap the avatar + name in
  `<Link href={`/artists/${e.endorser_profile_id}`}>`; otherwise render the
  existing plain `<span>`.
- **Organiser block:** wrap the festival badge / "via {name}" cluster in
  `<Link href={`/festivals/${e.festival_id}`}>` when `festival_id` is present.
- Hover affordance using design tokens only (`hover:text-clay`, underline on
  hover). No new colours or fonts.
- The avatar/name extraction may move into a tiny local helper/component if the
  JSX duplication across the two blocks warrants it, but no broader refactor.

## Testing

- **API (Go) test** in `endorsement_test.go`: a public peer endorser yields
  `endorser_profile_id` equal to their profile id; a draft peer endorser
  (profile exists, visibility != public) yields `endorser_profile_id`
  absent/nil; an organiser endorser yields it absent.
- **Web (Vitest)** render test under `__tests__/app-public-artists/`: a peer
  endorsement with `endorser_profile_id` renders a link to `/artists/{id}`; one
  without renders no link; an organiser endorsement renders a link to
  `/festivals/{festival_id}`.
- **E2E:** the existing endorsement/public-visitor browser flow is extended only
  if cheap; the API + Vitest layers are the primary guard. Full `task e2e:clean`
  must pass before the PR.

## Out of scope

- No change to who can endorse, moderation, or the endorsee management view.
- No change to `ListReceivedEndorsements` or the create/withdraw/visibility flows.
- No linking of organiser endorsers to a user profile (organisers have no public
  artist page) — they link to the festival instead.

## Spec maintenance

`api/internal/endorsement/endorsement.spec.md` Contract + Changelog updated in the
implementation PR to record the new public field and its publish-gated semantics.
