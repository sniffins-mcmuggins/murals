# E16 — Private Beta Portal ("Project [Codename]") — Design Spec

**Date:** 2026-05-30
**Status:** Draft (decisions locked 2026-05-30)
**Epic:** E16 (new)
**Scope:** Ship the platform under a working codename to a hand-picked cohort of artists and organisers *before* public launch. The whole site sits behind invite-only access. Trialists feel like founders, share invites to drum up hype, and give us direction feedback. Inspired by the "Project Kotlin" technique — release under a placeholder name and let the real one emerge from the people who'll use it.

> **Naming is deliberately out-of-product.** We gather name ideas and direction over email / chat / direct conversation with the cohort, **not** through an in-app voting feature (decision 2026-05-30). The codename framing stays; there is no `name_suggestions`/voting subsystem. Lightweight in-product **feedback** capture remains (it's cheap and useful beyond naming).

---

## Overview

Three jobs, one epic:

1. **Gate** — during beta, there is no anonymous access. Every route requires an authenticated session, and accounts can only be created by **redeeming an invite** (Approach A, decided). A tight allowlist keeps the recruitment funnel open: the E15 `/preview/{token}` and `/claim/{token}` pages, auth, health, legal, and a minimal landing/waitlist stay public so we can still pitch artists who aren't members yet.
2. **Hype loop** — founding members get a personal, shareable invite link with a small quota. Inviting friends *is* the growth mechanism, and the invite graph (`invited_by`) is the seed for E20 (refer-an-artist).
3. **Founding-member experience + feedback** — a "founding member" identity, the invite panel, and a lightweight feedback inbox so the cohort can tell us where to take the product. This is what makes them feel it's theirs.

**Mission alignment** (`CLAUDE.md`): this serves artists — it gives them ownership and a voice in the product they'll build their careers on. The whole gate is feature-flagged behind `BETA_MODE`; flipping it off at public launch opens signup and drops the wall with **no code rip-out**.

**Why a table-per-concern:** membership is a flag (`users.is_beta`, mirrors `is_admin`/`is_moderator`), invites are their own table (codes, quotas, redemption races), feedback is its own inbox. Each child ticket owns one and can be built by a different person in parallel once the gate (E16.1) lands.

---

## Child tickets (build order)

| # | Ticket | Depends on | Areas | Notes |
|---|--------|-----------|-------|-------|
| **E16.1** | Beta access gate — `BETA_MODE` global gate + invite-gated signup + `is_beta` membership + minimal landing/waitlist | — *(foundation)* | api, db, web, e2e, **security** | The canary epic: unauth → blocked on every non-allowlisted route; signup without a valid invite → rejected. |
| **E16.2** | Invite & cohort management — admin-issued + member-issued shareable invites, quotas, cohort labels, race-safe redemption | E16.1 | api, db, web, e2e, **security** | Personal invite links = the hype loop. Redemption must be atomic (`ON CONFLICT` / conditional `UPDATE`). |
| **E16.3** | Founding-member UX + feedback inbox — "Founding member" badge, invite panel, feedback widget + admin triage | E16.1, E16.2 | api, db, web | The exclusivity surface. Ties E16.2's invite link into the dashboard. |

**Sequencing:** E16.1 first — everything sits on the gate + `is_beta`. Then E16.2, then E16.3 (which mounts E16.2's invite link + the feedback widget). Three disparate tickets.

---

## 1. Database

All migrations after the current highest-numbered file (check `db/migrations/` before assigning a number; placeholders below). Per `sqlc-and-schema.md`: each new column on `users` ripples into **every** `row.Scan(&i.…)` that returns `users.*` (notably `password_reset.sql.go`) — grep-verify counts after `task db:generate`.

### 1a. Membership flag (E16.1)

```sql
-- 0000NN_beta_membership.up.sql  (create beta_invites in the SAME migration, before this ALTER)
ALTER TABLE users
  ADD COLUMN is_beta       boolean NOT NULL DEFAULT false,
  ADD COLUMN beta_cohort   text,                 -- e.g. 'cpf-founders'; NULL until invited
  ADD COLUMN invited_by    uuid REFERENCES users(id),  -- the member whose invite they redeemed
  ADD COLUMN invited_via   uuid REFERENCES beta_invites(id);
```

> **Migration ordering:** `invited_via` references `beta_invites`, so the `beta_invites` table (1b) must be created in the same migration *before* this `ALTER`. Keep them in one file for a coherent diff.

`is_beta` is the live, DB-authoritative membership signal — never trust a JWT claim for it (same rule as `is_admin`, see `auth-changes.md`). The down migration drops all four columns in reverse.

### 1b. Invites (E16.1 creates the table; E16.2 adds member-issuance)

```sql
CREATE TABLE beta_invites (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    code        text        NOT NULL UNIQUE,        -- unguessable (crypto/rand, ~22 chars base62)
    created_by  uuid        REFERENCES users(id),   -- NULL = system/admin-seeded
    cohort      text,                               -- copied onto the redeemer's users.beta_cohort
    max_uses    int         NOT NULL DEFAULT 1,
    used_count  int         NOT NULL DEFAULT 0,
    expires_at  timestamptz,                        -- NULL = no expiry
    created_at  timestamptz NOT NULL DEFAULT now(),
    CHECK (used_count <= max_uses)
);
CREATE INDEX idx_beta_invites_created_by ON beta_invites (created_by);
```

Redemption is a **race-safe conditional update**, not check-then-act (`api-handler-checklist.md`):

```sql
-- RedeemBetaInvite: returns the row only if a use was available.
UPDATE beta_invites
   SET used_count = used_count + 1
 WHERE code = $1
   AND used_count < max_uses
   AND (expires_at IS NULL OR expires_at > now())
RETURNING id, cohort;
```

No row returned → invalid / exhausted / expired → signup rejected (or 409 on the concurrent loser).

### 1c. Direction feedback (E16.3)

```sql
CREATE TABLE beta_feedback (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind       text        NOT NULL,                -- idea | bug | direction | praise
    body       text        NOT NULL,
    status     text        NOT NULL DEFAULT 'new',  -- new | triaged | done
    admin_note text,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_beta_feedback_user_id ON beta_feedback (user_id);
```

### 1d. Waitlist (E16.1)

A minimal capture for the public landing's "request access" form:

```sql
CREATE TABLE waitlist_requests (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    email      text        NOT NULL,
    role_hint  text,                                -- 'artist' | 'organiser' | NULL (self-declared)
    note       text,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX waitlist_requests_email ON waitlist_requests (lower(email));
```

---

## 2. The gate (E16.1)

### 2a. Config

`api/internal/config/config.go` gains `BetaMode bool` (env `BETA_MODE`, default `false`). It's a behaviour flag, not an external service, so no `_REQUIRED` companion — but log the active mode loudly at boot (`slog.Info("beta mode", "enabled", cfg.BetaMode)`).

### 2b. API middleware

A `beta.Gate(cfg, pool)` middleware mounted **after** `auth.Middleware` on the protected router groups. When `BETA_MODE` is on:

- No principal in context → `401`.
- Principal present but `user.is_beta == false` (live DB read, not the JWT) → `403` with a clear "beta access required" body.

Routes that stay public during beta are simply **not** wrapped by the gate (the allowlist is structural — defined by which router groups get `beta.Gate`):

| Public during beta | Why |
|---|---|
| `/healthz`, `/readyz` | infra |
| `/auth/*` (login, signup, password reset, OAuth callbacks) | you must be able to get in |
| `/claim/{token}` + claim API (E15.4) | prospects bind their pre-built page |
| `/preview/{token}` + preview-read API (E15.2) | we pitch non-members the hidden page |
| landing + `POST /waitlist` | the one marketing surface + inbound capture |
| legal pages (`/privacy`, `/terms`) | compliance |

> **Wiring canary (per `auth-changes.md`):** the gate is route-group middleware, so unit tests that inject `auth.WithUserForTest()` bypass it. The first e2e test for E16.1 must be an unauthenticated HTTP probe of a gated route asserting the block, exactly like the `RequireAdmin` canary.

### 2c. Invite-gated signup

When `BETA_MODE` is on, `POST /auth/signup` requires `invite_code` in the body. The handler:

1. Calls `RedeemBetaInvite` (1b) **inside the same transaction** as the user `INSERT`, so a failed/raced redemption rolls back the account.
2. On a returned row, creates the user with `is_beta = true`, `beta_cohort = invite.cohort`, `invited_via = invite.id`, `invited_by = invite.created_by`.
3. Missing/invalid/exhausted code → `403` (or `409` for the concurrent loser of a single-use code).

When `BETA_MODE` is off, `invite_code` is ignored and signup behaves as today — the launch exit path.

### 2d. Web middleware

`web/src/middleware.ts`: when beta mode is active (exposed via a public env flag or a `/public/beta-status` probe), any request to a non-allowlisted path without a valid session cookie redirects to `/login`. Allowlist mirrors 2b (`/login`, `/signup`, `/claim/*`, `/preview/*`, `/privacy`, `/terms`, landing). Server components that fetch must use `API_URL` (`http://api:8080`) not `NEXT_PUBLIC_API_URL` inside the container (`e2e-debugging.md`).

---

## 3. API surface (by ticket)

**E16.1 — gate + waitlist**
- `POST /auth/signup` extended with `invite_code` (see 2c).
- `POST /waitlist` `{ email, role_hint?, note? }` *(public)* — inbound capture; idempotent on email.
- `GET  /public/beta-status` *(public)* — `{ beta_mode: bool }` so the web middleware/landing know the mode.

**E16.2 — invites**
- `POST /admin/beta/invites` *(admin)* — create an invite (cohort, max_uses, expires_at). Returns code + shareable link.
- `GET  /admin/beta/invites` *(admin)* — list/usage.
- `POST /beta/invites` *(beta member)* — member mints their **own** personal invite from their remaining quota; returns their shareable link. Quota enforced server-side (default **3/member**).
- `GET  /beta/me/invites` *(beta member)* — their codes + remaining quota + who they've brought in (`invited_by = me`).

**E16.3 — feedback**
- `POST /beta/feedback` `{ kind, body }` *(beta member)*.
- `GET  /beta/feedback` *(beta member)* — **only the caller's own** rows (IDOR-safe).
- `GET/PATCH /admin/beta/feedback` *(admin)* — triage inbox.

All `/admin/*` routes go in the existing `RequireAdmin` group; all `/beta/*` member routes go behind `auth.Middleware` + `beta.Gate`. Register literal sub-paths before any `{id}` routes (`api-handler-checklist.md`). Regenerate the OpenAPI client after each ticket's endpoints land.

---

## 4. Frontend (web)

- **E16.1:** `middleware.ts` gate; a minimal public **landing** with a "request access" form (→ `POST /waitlist`); a "you need an invite" state on `/signup` when no code is present; invite-code field prefilled from `/signup?invite=CODE`.
- **E16.2:** admin invite table (`/admin/beta/invites`); the member-facing **Invite panel** component (built here, mounted by E16.3).
- **E16.3:** a persistent **"Founding member"** badge in the app chrome (uses `is_beta`); a dashboard **Invite friends** card (personal link + `invites_remaining`, copy-to-clipboard, "drum up hype" copy); a lightweight **Feedback** widget (kind selector + textarea) posting to `/beta/feedback`.

Use the demo design system (`CLAUDE.md`): ink/amber/clay palette, Cormorant Garamond headings, DM Mono for the beta badge/labels. The "founding member" treatment should feel earned.

---

## 5. Security & testing

Per `api-handler-checklist.md`, `auth-changes.md`, `sqlc-and-schema.md`:

**Gate canary (E16.1) — the must-have:**
- With `BETA_MODE=on`: GET a gated route (e.g. `/me`) **without** a token → `401`.
- Token for a **non-beta** user → `403`.
- Allowlisted route (`/preview/{token}`, `/claim/{token}`, landing, `/public/beta-status`) without a token → still works — proves the funnel stays open.
- `POST /auth/signup` without `invite_code` while `BETA_MODE=on` → `403`/`422`.

**Invite redemption race (E16.2):** two concurrent signups with the **same single-use code** via `Promise.all` → exactly one `201`, one `409` (`CHECK (used_count <= max_uses)` + conditional `UPDATE`). Re-using an exhausted code → `403`. Member quota enforced (a member can't mint past their allowance).

**Schema canary (E16.1):** redeem an invite at signup → read the user back via API → assert `is_beta=true`, `beta_cohort` and `invited_by` populated (catches a missed Scan on the new nullable `users` columns — the `password_reset.sql.go` gotcha).

**Feedback IDOR (E16.3):** user A's `GET /beta/feedback` never returns user B's rows; A cannot read/patch B's feedback by id.

**Waitlist (E16.1):** `POST /waitlist` is public, idempotent on email, rate-limited (no flooding).

**Schema lockstep:** after any `users` column add, both `grep -c '&i\.' …/users.sql.go` and `…/password_reset.sql.go` must equal the new column count.

---

## 6. Decisions (locked 2026-05-30)

1. **Gate mechanism:** Approach A — application-layer invite-only, tight structural allowlist. ✅
2. **Public surface:** a minimal landing + waitlist; everything else behind login. ✅
3. **In-product name voting:** **cut.** Naming/direction handled over email/chat; only lightweight feedback capture stays in-product. ✅
4. **Personal invite quota:** **3** per founding member, admin-overridable, separate from admin-minted bulk codes. ✅
5. **Cohort mixing:** artists and organisers share one cohort; `beta_cohort` + the user's role context let us segment later. ✅
6. **Launch exit:** flipping `BETA_MODE=false` opens public signup and removes the gate with no code changes; `is_beta` members keep a "founding member" badge forever. ✅

---

## Out of scope

- Any in-product naming/voting/poll engine (decided out — handled over email/chat).
- The E20 referral *rewards* mechanics (credits, free months for referring). E16's invite graph (`invited_by`) is the substrate; E20 builds incentives on top.
- The AI onboarding flow (E19) — a redeemed invite still lands in today's manual signup; E19 later swaps in the assisted build.
- Email delivery of invites beyond reusing the existing SES mailer for the invite link (no new templating system).
- Anything done to the waitlist beyond capture (no automated drip; operators work the list).
