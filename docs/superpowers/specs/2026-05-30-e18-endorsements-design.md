# E18 — Artist & Organiser Endorsements — Design Spec

**Date:** 2026-05-30
**Status:** Draft
**Epic:** E18 (new)
**Scope:** Let artists endorse other artists, and festival organisers endorse artists who appeared at their festival. Endorsements show as peer/organiser social proof on the artist's profile. Goal: build community and reduce churn — artists who feel recognised and connected stay.

---

## Overview

Endorsements are a small, high-leverage trust signal. Two kinds, derived from **context**, not a role column (the `user_role` enum was dropped in migration 5, and a user can be both artist and organiser):

- **Peer endorsement** — any artist (a user with an `artist_profile`) vouches for another artist. Optional short testimonial + "endorsed for" skill tags.
- **Organiser endorsement** — the owner of a festival endorses an artist **who actually appeared at it**. Higher-trust, badged with the festival name ("Endorsed by the Cheltenham Paint Festival team"). Gated on a real, verifiable festival relationship so it can't be faked.

The endorsee always controls their own page: they can hide any individual endorsement; the endorser can withdraw. Endorsements are public content, so they plug into E17 moderation (flaggable, `moderation_status`).

**Mission + anti-churn:** this serves artists directly (recognition, community, a richer profile = better careers) and feeds the same retention goal as E16's founding-member belonging. Cheap to build, compounding in value as the graph fills in.

---

## Child tickets (build order)

| # | Ticket | Depends on | Areas | Notes |
|---|--------|-----------|-------|-------|
| **E18.1** | Endorsements core — table, create/withdraw, peer-vs-organiser validation, one-per-pair, no self-endorse, endorsee notify | — *(foundation)* | api, db, e2e, **security** | Authenticity is the hard part: organiser endorsements must prove festival ownership + appearance. |
| **E18.2** | Profile display + endorsee controls — render on profile, organiser highlight, hide/show individual endorsements | E18.1 | api, web, e2e | The visible payoff. Endorsee owns what shows. |
| **E18.3** | *(integration)* Flaggable + moderated endorsements — add `endorsement` target to E17 | E18.1, **E17.2/E17.3** | api, db, e2e | Adds `endorsement` as an E17 `target_type` + the `moderation_status` public filter. |

**Sequencing:** E18.1 first. E18.2 (UI) follows. E18.3 is a thin integration once both E18.1 and E17's flag/queue exist.

---

## 1. Database

Migration number is a placeholder — check the highest existing first.

### 1a. Endorsements (E18.1)

```sql
CREATE TABLE endorsements (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    endorser_id   uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endorsee_id   uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- always an artist
    kind          text        NOT NULL,                 -- 'peer' | 'organiser'
    festival_id   uuid        REFERENCES festivals(id) ON DELETE SET NULL,      -- required when kind='organiser'
    body          text,                                  -- optional short testimonial
    skills        text[]      NOT NULL DEFAULT '{}',     -- optional "endorsed for" tags
    hidden_by_endorsee boolean NOT NULL DEFAULT false,   -- endorsee controls their page
    moderation_status  text   NOT NULL DEFAULT 'ok',     -- E17 integration ('ok'|'hidden'|'removed')
    created_at    timestamptz NOT NULL DEFAULT now(),
    CHECK (endorser_id <> endorsee_id),                  -- no self-endorsement
    CHECK (kind IN ('peer','organiser')),
    CHECK (kind = 'peer' OR festival_id IS NOT NULL)     -- organiser endorsement must name a festival
);

-- One endorsement per (endorser, endorsee) — re-endorsing edits, never duplicates.
CREATE UNIQUE INDEX endorsements_one_per_pair ON endorsements (endorser_id, endorsee_id);
CREATE INDEX idx_endorsements_endorsee ON endorsements (endorsee_id) WHERE moderation_status = 'ok';
```

`kind` is stored (not derived on read) because organiser-vs-peer drives display + weighting and we validate it once at write time. `skills` defaults to `'{}'` per `sqlc-and-schema.md` (text-array Scan must be in lockstep across queries).

---

## 2. API surface

**E18.1 — core**
- `POST /endorsements` `{ endorsee_id, kind, festival_id?, body?, skills? }` *(authed member)*. Server-side validation does the real work:
  - **Self-endorse** → `400` (also DB-CHECKed).
  - **Endorsee must be an artist** (has an `artist_profile`) and that profile must be publicly reachable → else `404`/`400` (no probing drafts).
  - **`kind='peer'`:** endorser must have an `artist_profile`. `festival_id` ignored/must be null.
  - **`kind='organiser'`:** endorser must **own** `festival_id` *and* the endorsee must have an **accepted/appeared** application at that festival (verifiable relationship). Fail either → `403`. This is the authenticity gate — it's what makes an organiser endorsement worth more than a peer one.
  - **Upsert semantics:** second `POST` for the same pair updates `body`/`skills` (`ON CONFLICT (endorser_id, endorsee_id) DO UPDATE`), never duplicates.
  - Fires an endorsee notification (bounded background work, `background-work.md`) — email + (future) in-app.
- `DELETE /endorsements/{id}` *(endorser only)* — withdraw.
- `GET /profiles/{id}/endorsements` — public list, **filtered** to `moderation_status='ok' AND hidden_by_endorsee=false`, organiser endorsements first.

**E18.2 — endorsee controls**
- `PATCH /endorsements/{id}/visibility` `{ hidden: bool }` *(endorsee only)* — show/hide an endorsement on their own profile. (Endorser can't force-show; endorsee can't edit the words, only hide.)

Routing: all behind `auth.Middleware` (+ `beta.Gate` during beta). Literal paths before `{id}`; unauth e2e probe per group (`api-handler-checklist.md`). Regenerate OpenAPI client.

---

## 3. Frontend (web)

- **E18.2:** an **Endorsements** section on the public artist profile —
  - Organiser endorsements highlighted with the festival name + a verified-style badge.
  - Peer endorsements as a grid of endorser avatars/names; testimonial text where present; "endorsed for: murals, portraits" chips from `skills`.
  - An **"Endorse"** button on *other* artists' profiles (hidden on your own), opening a small composer (optional blurb + skill tags). Organisers get an "Endorse as [Festival]" option only for artists who appeared at a festival they own (the API enforces it; the UI just offers it).
  - The endorsee's own profile view shows hide/show toggles per endorsement (E18.2 control).
- Design system per `CLAUDE.md`; organiser badge in DM Mono, testimonials in Cormorant Garamond (it's a quote).

---

## 4. Security & testing

Per `api-handler-checklist.md`, `auth-changes.md`:

**Auth + wiring (E18.1):** `POST /endorsements` without a token → `401`. Endorse a non-existent / draft / non-artist target → `404`/`400` (no oracle for hidden profiles).

**Self-endorse:** `endorser_id == endorsee_id` → `400` (handler) and the DB `CHECK` is the backstop.

**One-per-pair race:** two concurrent `POST`s for the same pair via `Promise.all` → exactly one create, one upsert-merge (no duplicate; `endorsements_one_per_pair` + `ON CONFLICT` guarantee it) — the concurrent pattern from `api-handler-checklist.md`.

**Organiser-endorsement forgery (the key authenticity test):**
- Organiser A endorses artist X **for festival A owns and X appeared at** → `201`, `kind='organiser'`.
- A endorses X **for a festival A does NOT own** → `403`.
- A endorses X **for A's festival where X never had an accepted application** → `403`.
- A non-owner tries to attribute an endorsement to someone else's festival → `403`.

**Ownership of mutations (IDOR):** only the endorser can `DELETE`; only the endorsee can `PATCH …/visibility`. Cross-user attempts → `403`. The endorser cannot un-hide what the endorsee hid; the endorsee cannot edit the endorser's words.

**Public filtering:** an endorsement that is `hidden_by_endorsee` or `moderation_status != 'ok'` (E17) never appears in `GET /profiles/{id}/endorsements` or any profile render. (Mirrors the E17 public-filtering canary; verify when E18.3 lands.)

**Anti-farming:** endorsement creation is rate-limited (reuse `auth.RateLimitMiddleware`); see Open Decisions for an optional per-day cap.

---

## 5. Open decisions (for review — defaults chosen)

1. **Organiser-endorsement gating.** Default: **require** a real relationship (endorser owns the festival AND endorsee has an accepted/appeared application there). Strong authenticity, but means organisers can only endorse artists who actually showed up. Alternative: allow any organiser to endorse any artist (looser, less trustworthy badge).
2. **Testimonial length / required?** Default: optional, short (≤ 280 chars). A pure one-click vouch is valid (no text). Alternative: require a sentence to make endorsements meaningful.
3. **"Endorsed for" skill tags.** Default: optional free-to-pick tags reusing the artist's existing `medium`/skill vocabulary. Alternative: drop tags in v1, just a vouch + blurb.
4. **Reciprocity highlight.** Default: if A and B endorse each other, show a subtle "mutual" marker. Cheap, nice community signal. Alternative: ignore directionality.
5. **Per-day cap.** Default: rate-limit only (no hard cap) for v1; revisit if we see farming. Alternative: cap peer endorsements (e.g. 10/day) from the start.
6. **Mobile surface.** Default: endorsements render read-only on the React Native public app (display only); creating/managing them is browser-first (consistent with the platform split in `CLAUDE.md`). Confirm.

---

## Out of scope

- Weighted/ranked endorsement scoring that feeds search or festival selection. Endorsements are display-only social proof here; using them as a ranking input is a separate, sensitive decision.
- Endorsement *requests* ("ask X to endorse me"). Could be a nice nudge later; not v1.
- Organisations/brands endorsing (only individual artists and festival organisers in scope).
- Endorsing organisers or festivals (endorsement targets are always artists).
- LinkedIn-style "skill + N endorsements" aggregation UI. Start with a flat list + organiser highlight; aggregate later if the volume warrants.
