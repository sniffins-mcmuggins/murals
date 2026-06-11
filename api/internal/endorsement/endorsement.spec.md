# Endorsement Spec
**Path:** `api/internal/endorsement/`
**Last updated:** 2026-06-01

## Contract

- `POST /endorsements` — create or upsert a peer or organiser endorsement; 201 on success.
- `DELETE /endorsements/{id}` — endorser withdraws; 204 on success.
- `GET /profiles/{id}/endorsements` — public list, filtered to `moderation_status='ok'` and `hidden_by_endorsee=false`, organiser-first. Each row carries `endorser_profile_id` (the endorser's public artist-profile id) **only when that profile's `visibility='public'`**, so the web page can link a peer endorser to `/artists/{id}` without risking a 404; `null`/absent for organisers and draft peers.
- `PATCH /endorsements/{id}/visibility` — endorsee hides or shows; 200 with updated endorsement.
- `GET /endorsements/received` — endorsee management: all received endorsements including hidden and moderated.

## Boundaries

- Does NOT implement moderation admin UI or content flagging (that is E17).
- Does NOT expose `SetEndorsementModerationStatus` as an HTTP route — it is a DB-only query for E17 to call.
- Does NOT allow endorsees to edit the endorser's words — only visibility toggling.

## Key Decisions

- `endorser_id` → `users.id`; `endorsee_id` → `artist_profiles.id`.
- One endorsement per `(endorser_id, endorsee_id)` pair; upsert on repeat (ON CONFLICT DO UPDATE).
- Peer requires caller to have an `artist_profile`. Organiser requires ownership of `festival_id`. No festival appearance requirement.
- Endorser owns the words (create/withdraw); endorsee controls visibility (hide/show only, no edit).
- Notification: background email on create, 30s timeout, errors logged and swallowed.
- `moderation_status` column present from migration day one; public list always filters on it. E17 provides the admin UI and flag queue.

## Invariants

- No self-endorsement: the **handler** is the real guard — it loads the endorsee's
  `artist_profiles` row and rejects with 400 when `endorsee.user_id == caller.user_id`.
  The DB `CHECK (endorser_id <> endorsee_id)` does NOT prevent this: `endorser_id` is a
  `users.id` and `endorsee_id` is an `artist_profiles.id`, so the two are never equal even
  for a true self-endorsement — the CHECK only blocks the degenerate equal-UUID case. The
  UI also hides the "Endorse" affordance on the viewer's own profile, and the
  `/endorse/[profileID]` form short-circuits when it's the caller's own profile.
- Organiser kind always has festival_id: DB `CHECK (kind = 'peer' OR festival_id IS NOT NULL)`.
- `moderation_status` is one of `'ok'`, `'hidden'`, `'removed'`.
- Public list (`ListPublicEndorsements`) never exposes `hidden_by_endorsee=true` or `moderation_status != 'ok'` rows.
- `endorser_profile_id` is exposed on the public list **only** when the endorser's profile `visibility='public'` (SQL `CASE WHEN ap.visibility = 'public' THEN ap.id END`). It must stay aligned with the public-profile visibility gate in `artist.GetProfileHandler` — if that gate changes, this CASE changes with it, or the page links to a 404. It is omitted from the received-management response (`toReceivedRowResponse`).

## AI Context

- `CreateHandler(pool)` passes `nil` mailer — use for tests to suppress email goroutines.
- `CreateHandlerWithMailer(pool, mailer)` is the production variant, wired in `main.go`.
- `toRowResponse` and `toReceivedRowResponse` accept different sqlc-generated types (`ListPublicEndorsementsRow` vs `ListReceivedEndorsementsRow`) even though the structs have identical fields — sqlc generates them as separate named types.
- `isCheckViolation` in `errors.go` catches the DB self-endorse CHECK as a 400 backstop.
- The endorsee identity check in `SetVisibilityHandler` uses `GetArtistProfileByID` then compares `profile.UserID` to the principal — the endorsee table is `artist_profiles`, not `users`.

## Changelog

2026-06-11 — Added `endorser_profile_id` to the public list response (`ListPublicEndorsements` + `toRowResponse`), visibility-gated on `ap.visibility='public'`, so the web artist page can link peer endorsers to `/artists/{id}` and organiser endorsers to `/festivals/{festival_id}`. Plain-text fallback when absent.
2026-06-11 — Clarified the self-endorsement invariant: the handler guard (endorsee profile `user_id` vs caller), not the DB CHECK, is what prevents it; the UI now hides the endorse affordance on the owner's own profile and the endorse form guards the self case.
2026-06-01 — initial spec
