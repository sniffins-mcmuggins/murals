# E17 — Artists as Moderators — Design Spec

**Date:** 2026-05-30
**Status:** Draft
**Epic:** E17 (new)
**Scope:** Keep the platform genuine art — not AI slop, spam, or abuse — by giving trusted users (mostly artists) a **moderator** capability. Anyone can **flag** content; moderators work a **queue** and take graded actions (dismiss / hide / remove / escalate). A new `is_moderator` boolean grants the role, mirroring `is_admin`. Optionally, trusted moderators can also run the prospect-page flow to help recruit sign-ups.

---

## Overview

The mission constraint (`CLAUDE.md`) is "genuine art." This epic is the immune system for that: a lightweight community-moderation loop layered over the content that already exists — artist profiles, collections, and images.

Four moving parts, each its own child ticket so different people can build them in parallel once the role lands:

1. **Role** (`users.is_moderator`) — DB-authoritative, admin-granted, guarded by `RequireModerator`. Same shape and same security rules as `is_admin` (`auth-changes.md`: read the *live* DB value, never the JWT claim).
2. **Flagging** — any authenticated member reports a piece of content with a reason. Rate-limited, deduped per `(flagger, target)`.
3. **Queue + actions** — moderators see flagged content grouped by target, and take a graded action. A `moderation_status` on each moderatable table makes "hide" actually remove it from every public surface. All actions audited.
4. **(Optional) Mods help recruit** — widen E15.4's prospect-page creation from admin-only to moderators, so trusted artists can build "this could be yours" pages too.

**Why community moderation, not admin-only:** it scales with the artist base, builds the sense of a self-governing creative community (which feeds the anti-churn goal alongside E18), and keeps the founders close to quality. The admin path still exists for escalations.

---

## Child tickets (build order)

| # | Ticket | Depends on | Areas | Notes |
|---|--------|-----------|-------|-------|
| **E17.1** | Moderator role — `is_moderator` + `RequireModerator` + admin grant/revoke | — *(foundation)* | api, db, web, e2e, **security** | Wiring canary: unauth → 401, non-mod token → 403. Grant/revoke is admin-only. |
| **E17.2** | Content flagging — `content_flags` (polymorphic target), `POST /flags`, rate-limited, deduped | — | api, db, web, e2e, **security** | Can be built in parallel with E17.1; the queue (E17.3) consumes it. |
| **E17.3** | Moderation queue + actions — `moderation_status` on moderatable tables, queue, dismiss/hide/remove/escalate, audit, public-read filtering, owner notify | E17.1, E17.2 | api, db, web, e2e, **security** | The heart of it. Hidden content must vanish from **every** public surface. |
| **E17.4** | *(optional)* Moderators can build prospect pages — widen E15.4 prospect creation to `is_moderator` | E17.1, **E15.4** | api, e2e, **security** | Small auth-widening on existing machinery. Deferred until E15.4 lands. |

**Sequencing:** E17.1 and E17.2 are independent — build in parallel. E17.3 needs both (the role to guard actions, the flags to populate the queue). E17.4 is a stretch goal gated on E15.4 existing.

---

## 1. Database

Migration numbers are placeholders (`0000NN`) — check the highest existing migration first. Per `sqlc-and-schema.md`, the `users` column add ripples into every `users.*` Scan (incl. `password_reset.sql.go`); grep-verify counts after `task db:generate`.

### 1a. Role (E17.1)

```sql
ALTER TABLE users ADD COLUMN is_moderator boolean NOT NULL DEFAULT false;
```

`is_moderator` is read live from the DB by `RequireModerator` — a demoted mod's outstanding JWT (up to 7d TTL) must lose access immediately, exactly as with `is_admin`. Down migration drops the column.

### 1b. Flags (E17.2)

```sql
CREATE TABLE content_flags (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    target_type text        NOT NULL,   -- 'profile' | 'collection' | 'image'
    target_id   uuid        NOT NULL,
    flagged_by  uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason      text        NOT NULL,   -- spam | ai_generated | abuse | off_topic | copyright | other
    note        text,
    status      text        NOT NULL DEFAULT 'open',  -- open | resolved | dismissed
    created_at  timestamptz NOT NULL DEFAULT now(),
    resolved_at timestamptz,
    resolved_by uuid        REFERENCES users(id),
    CHECK (target_type IN ('profile','collection','image')),
    CHECK (reason IN ('spam','ai_generated','abuse','off_topic','copyright','other'))
);

-- One OPEN flag per user per target — re-flagging is a no-op, not a duplicate.
CREATE UNIQUE INDEX content_flags_one_open_per_user
  ON content_flags (target_type, target_id, flagged_by)
  WHERE status = 'open';

CREATE INDEX idx_content_flags_target ON content_flags (target_type, target_id) WHERE status = 'open';
```

`target_type/target_id` is polymorphic on purpose: one queue spans profiles, collections, and images without a table per type. The partial unique index (note the `WHERE status = 'open'`, per `sqlc-and-schema.md`) prevents flag-spam while still allowing a fresh flag after a previous one was resolved. The `INSERT` uses `ON CONFLICT … WHERE status = 'open' DO NOTHING` and treats "no row" as "already flagged" → idempotent 200/202.

### 1c. Moderation status on moderatable tables (E17.3)

```sql
ALTER TABLE artist_profiles   ADD COLUMN moderation_status text NOT NULL DEFAULT 'ok';
ALTER TABLE collections       ADD COLUMN moderation_status text NOT NULL DEFAULT 'ok';
ALTER TABLE collection_images ADD COLUMN moderation_status text NOT NULL DEFAULT 'ok';
-- CHECK (moderation_status IN ('ok','hidden','removed')) on each.
```

`moderation_status` is **orthogonal to the artist's own `visibility`** (draft/public from E15.1). A moderator's `hidden` overrides the artist: even a `public` profile with `moderation_status != 'ok'` is invisible publicly. Every public-read query gains `AND moderation_status = 'ok'`. This is the highest-risk change — see the public-filtering canary in §4.

> Per `sqlc-and-schema.md`, adding a column to three content tables means **every** SELECT/Scan over them updates in lockstep. Grep-verify each `*.sql.go` after `task db:generate`. This is exactly the "new column silently returns zero values / breaks public visibility" footgun — the e2e canary (§4) is mandatory.

### 1d. Moderation actions audit (E17.3)

```sql
CREATE TABLE moderation_actions (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    moderator_id uuid       NOT NULL REFERENCES users(id),
    target_type text        NOT NULL,
    target_id   uuid        NOT NULL,
    action      text        NOT NULL,  -- dismiss | hide | remove | restore | escalate
    note        text,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_moderation_actions_target ON moderation_actions (target_type, target_id);
```

Append-only audit. `remove` is the admin-reserved hard state; `hide` and `restore` are reversible and available to moderators.

---

## 2. API surface

**E17.1 — role**
- `POST /admin/users/{id}/moderator` / `DELETE …/moderator` *(admin)* — grant/revoke `is_moderator`.
- `RequireModerator(pool)` middleware reads the live `users.is_moderator`; mounts the `/mod/*` group.

**E17.2 — flagging**
- `POST /flags` `{ target_type, target_id, reason, note? }` *(any authed member, rate-limited)* — idempotent per open flag. Validates the target exists and is itself publicly-reachable (you can't flag a draft you can't see — prevents probing).
- *(No public read of flags — only moderators see them, via the queue.)*

**E17.3 — queue + actions**
- `GET  /mod/queue` *(moderator)* — open flags grouped by target, newest/most-flagged first, with reason breakdown + a render of the target (name, thumbnail).
- `GET  /mod/queue/{target_type}/{target_id}` *(moderator)* — full detail: the content + all open flags.
- `POST /mod/queue/{target_type}/{target_id}/action` `{ action, note? }` *(moderator)* — `dismiss` (resolve flags, no content change) / `hide` / `restore` / `escalate`. `remove` is admin-only (returns 403 for a plain moderator; surfaced as "escalate to admin").
- `GET/POST /admin/mod/...` *(admin)* — admin sees the same queue plus `remove`, and an escalations view.

Routing: `/mod/*` behind `auth.Middleware` + (during beta) `beta.Gate` + `RequireModerator`. `/admin/mod/*` behind `RequireAdmin`. Literal sub-paths before `{param}` routes; unauth e2e probe per new group (`api-handler-checklist.md`).

---

## 3. Frontend (web)

- **E17.1:** admin user-management page gains a "Moderator" toggle (admin-only, already-gated page).
- **E17.2:** a **Flag** affordance (small "⚑ Report" link) on public profile / collection / image views, opening a reason picker + optional note. Confirmation toast; no public flag count shown.
- **E17.3:** `/mod` queue page (moderator-gated) — list of flagged items with reason chips and counts, a detail pane showing the content, and action buttons (Dismiss / Hide / Restore / Escalate). A "Moderator" badge in the chrome when `is_moderator`.
- Design system per `CLAUDE.md`; DM Mono for the moderation status/reason chips.

---

## 4. Security & testing

Per `auth-changes.md`, `api-handler-checklist.md`, `sqlc-and-schema.md`:

**Role wiring canary (E17.1):** `GET /mod/queue` without a token → `401`; with a **non-moderator** token → `403`; grant/revoke is admin-only (`POST /admin/users/{id}/moderator` by a non-admin → `403`). A **demoted** moderator's existing token loses queue access on the next request (live DB read, not JWT — the `is_admin` regression, applied to mods).

**Public-filtering canary (E17.3) — the critical one:** take a `public` profile, `hide` it via a mod action, then assert it **404s / is absent** on *every* public surface: `/public/profiles`, `/preview/{token}` (E15.2), the festival map, and any festival/application join. Restore → reappears. This is the test that catches a missed `AND moderation_status = 'ok'` in any one query (the "new column silently breaks visibility" footgun).

**Flag abuse / dedup (E17.2):** flag the same target twice as the same user → exactly one open `content_flags` row (partial unique index). Flagging is rate-limited (reuse `auth.RateLimitMiddleware`). You cannot flag content you cannot see (flagging a draft you don't own → `404`, not a probe oracle).

**Self-action guard (E17.3):** a moderator cannot `dismiss`/`hide` flags on **their own** content — that routes to other moderators/admin (assert `403` or auto-escalate). Prevents a mod burying complaints about their own work.

**Privilege boundary:** `remove` by a plain moderator → `403` (admin-only). `escalate` marks for admin without deleting. Audit row written for every action.

**Schema lockstep:** after the `users` and three content-table column adds, grep `&i\.` counts per `*.sql.go` equal the new column counts; the public-filtering canary above is the behavioural proof.

---

## 5. Open decisions (for review — defaults chosen)

1. **Moderatable scope (v1).** Default: profiles, collections, images. Endorsements (E18) and AI-built pages (E19) become flaggable later by adding `target_type` values — no schema change beyond the CHECK.
2. **Reason taxonomy.** Default: `spam | ai_generated | abuse | off_topic | copyright | other`. `ai_generated` is first-class because "no AI slop" is the explicit goal.
3. **Who can flag.** Default: any authenticated member (during beta, that's any founding member). Could later require account standing/age to flag.
4. **Hide vs remove.** Default: `hide` = reversible, moderator-available; `remove` = hard, admin-only; `restore` undoes a hide. Owners are emailed (bounded background work, `background-work.md`) when their content is hidden, with the reason.
5. **Mod-built prospect pages (E17.4).** Default: include as an optional stretch ticket that widens E15.4's `POST /admin/prospects` auth to `is_moderator OR is_admin` — reusing all its machinery. Confirm you want trusted mods doing recruitment, vs keeping it admin-only.
6. **Can moderators grant moderators?** Default: **no** — only admins grant/revoke `is_moderator`, to keep privilege escalation controlled.

---

## Out of scope

- Automated AI-slop detection (image classifiers, etc.). This epic is human-in-the-loop flagging; an automated pre-filter could *feed* the queue later but is its own project.
- Appeals workflow for hidden content beyond the owner email + "contact us". A structured appeal/dispute flow is a follow-up.
- Reputation/scoring for moderators or flaggers (trust levels, auto-actioning on enough flags). Start manual; add thresholds once we see real flag volume.
- Moderating chat/messages — chat isn't built (`CLAUDE.md` outstanding decision).
- Public transparency reports of moderation actions.
