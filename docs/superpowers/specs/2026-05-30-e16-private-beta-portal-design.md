# E16 — Private Beta Portal + Naming ("Project [Codename]") — Design Spec

**Date:** 2026-05-30
**Status:** Draft
**Epic:** E16 (new)
**Scope:** Ship the platform under a working codename to a hand-picked cohort of artists and organisers *before* public launch. The whole site sits behind invite-only access. Trialists feel like founders, share invites to drum up hype, and help **name** and **direct** the product. Inspired by the "Project Kotlin" technique — release under a placeholder name and let the real one emerge from the people who'll use it.

---

## Overview

Three jobs, one epic:

1. **Gate** — during beta, there is no anonymous access. Every route requires an authenticated session, and accounts can only be created by **redeeming an invite** (Approach A, decided). A tight allowlist keeps the recruitment funnel open: the E15 `/preview/{token}` and `/claim/{token}` pages, auth, health, and legal stay public so we can still pitch artists who aren't members yet.
2. **Hype loop** — founding members get a personal, shareable invite link with a small quota. Inviting friends *is* the growth mechanism, and the invite graph (`invited_by`) is the seed for E20 (refer-an-artist).
3. **Co-creation** — members submit and vote on **names**, and file lightweight **direction/feedback** notes. The platform is theirs; this is the feature that makes them feel it.

**Mission alignment** (`CLAUDE.md`): this serves artists — it gives them ownership and a voice in the product they'll build their careers on. The whole gate is feature-flagged behind `BETA_MODE`; flipping it off at public launch opens signup and drops the wall with **no code rip-out**.

**Why a table-per-concern, not one big "beta" blob:** membership is a flag (`users.is_beta`, mirrors `is_admin`/`is_moderator`), invites are their own table (codes, quotas, redemption races), naming is its own table-pair (suggestions + votes), feedback is its own inbox. Each child ticket owns one of these and can be built by a different person in parallel once the gate (E16.1) lands.

---

## Child tickets (build order)

| # | Ticket | Depends on | Areas | Notes |
|---|--------|-----------|-------|-------|
| **E16.1** | Beta access gate — `BETA_MODE` global gate + invite-gated signup + `is_beta` membership | — *(foundation)* | api, db, web, e2e, **security** | The canary epic: unauth → blocked on every non-allowlisted route; signup without a valid invite → rejected. |
| **E16.2** | Invite & cohort management — admin-issued + member-issued shareable invites, quotas, cohort labels, race-safe redemption | E16.1 | api, db, web, e2e, **security** | Personal invite links = the hype loop. Redemption must be atomic (`ON CONFLICT` / conditional `UPDATE`). |
| **E16.3** | Name suggestions + voting — submit, approval-vote, admin shortlist + declare winner | E16.1 | api, db, web, e2e | One vote per `(user, suggestion)`. Admin curates a shortlist, then declares the winner. |
| **E16.4** | Beta feedback inbox + founding-member UX — feedback table + widget, "Founding member" badge, invite panel | E16.1, E16.2 | api, db, web | The exclusivity surface. Ties the invite link from E16.2 into the dashboard. |

**Sequencing:** E16.1 first — everything sits on the gate + `is_beta`. Then E16.2, E16.3, E16.4 can proceed in parallel (E16.4 wires in E16.2's invite link near the end). Disparate enough for three or four people once the foundation is in.

---

## 1. Database

All migrations after the current highest-numbered file (check `db/migrations/` before assigning a number; placeholders below). Per `sqlc-and-schema.md`: each new column on `users` ripples into **every** `row.Scan(&i.…)` that returns `users.*` (notably `password_reset.sql.go`) — grep-verify counts after `task db:generate`.

### 1a. Membership flag (E16.1)

```sql
-- 0000NN_beta_membership.up.sql
ALTER TABLE users
  ADD COLUMN is_beta       boolean NOT NULL DEFAULT false,
  ADD COLUMN beta_cohort   text,                 -- e.g. 'cpf-founders'; NULL until invited
  ADD COLUMN invited_by    uuid REFERENCES users(id),  -- the member whose invite they redeemed
  ADD COLUMN invited_via   uuid REFERENCES beta_invites(id);
```

> **Migration ordering note:** `invited_via` references `beta_invites`, so the `beta_invites` table (1b) must be created in the same migration *before* this `ALTER`, or in an earlier-numbered one. Keep them in one migration file for a coherent diff.

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

### 1c. Name suggestions + votes (E16.3)

```sql
CREATE TABLE name_suggestions (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    name         text        NOT NULL,
    rationale    text,                              -- optional "why this name"
    submitted_by uuid        NOT NULL REFERENCES users(id),
    status       text        NOT NULL DEFAULT 'suggested',  -- suggested | shortlisted | rejected
    is_winner    boolean     NOT NULL DEFAULT false,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE name_votes (
    suggestion_id uuid       NOT NULL REFERENCES name_suggestions(id) ON DELETE CASCADE,
    user_id       uuid       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (suggestion_id, user_id)            -- one vote per user per suggestion
);
```

**Voting model (proposed):** approval voting — a member may upvote *several* suggestions they like (`INSERT ... ON CONFLICT (suggestion_id, user_id) DO NOTHING`; un-vote = `DELETE`). Admin marks the best as `shortlisted`, then flips one `is_winner = true`. No generic poll engine — YAGNI.

### 1d. Direction feedback (E16.4)

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

---

## 2. The gate (E16.1)

### 2a. Config

`api/internal/config/config.go` gains `BetaMode bool` (env `BETA_MODE`, default `false`). Per `prod-fail-loud.md` this is a behaviour flag, not an external service, so no `_REQUIRED` companion — but log the active mode loudly at boot (`slog.Info("beta mode", "enabled", cfg.BetaMode)`) so it's obvious in prod logs which mode is live.

### 2b. API middleware

A `beta.Gate(cfg, pool)` middleware mounted **after** `auth.Middleware` on the protected router groups. When `BETA_MODE` is on:

- No principal in context → `401` (already the case for auth-required groups; the gate's job is the next line).
- Principal present but `user.is_beta == false` (live DB read, not the JWT) → `403` with a clear "beta access required" body.

Routes that must stay public during beta are simply **not** wrapped by the gate (the allowlist is structural — defined by which router groups get `beta.Gate`, not a string match):

| Public during beta | Why |
|---|---|
| `/healthz`, `/readyz` | infra |
| `/auth/*` (login, signup, password reset, OAuth callbacks) | you must be able to get in |
| `/claim/{token}` + claim API (E15.4) | prospects bind their pre-built page |
| `/preview/{token}` + preview-read API (E15.2) | we pitch non-members the hidden page |
| legal pages (`/privacy`, `/terms`) | compliance |
| landing + request-access/waitlist endpoint | the only marketing surface (see Open Decisions) |

> **Wiring canary (per `auth-changes.md`):** the gate is a route-group middleware, so unit tests that inject `auth.WithUserForTest()` bypass it. The first e2e test for E16.1 must be an unauthenticated HTTP probe of a gated route asserting the block, exactly like the `RequireAdmin` canary.

### 2c. Invite-gated signup

When `BETA_MODE` is on, `POST /auth/signup` requires `invite_code` in the body. The handler:

1. Calls `RedeemBetaInvite` (1b) **inside the same transaction** as the user `INSERT`, so a failed/raced redemption rolls back the account.
2. On a returned row, creates the user with `is_beta = true`, `beta_cohort = invite.cohort`, `invited_via = invite.id`, and `invited_by = invite.created_by`.
3. Missing/invalid/exhausted code → `403` (or `409` for the concurrent loser of a single-use code).

When `BETA_MODE` is off, `invite_code` is ignored and signup behaves as today — that's the launch exit path.

### 2d. Web middleware

`web/src/middleware.ts` (Next.js): when beta mode is active (exposed via a public env flag or a `/public/beta-status` probe), any request to a non-allowlisted path without a valid session cookie redirects to `/login`. Allowlist mirrors 2b (`/login`, `/signup`, `/claim/*`, `/preview/*`, `/privacy`, `/terms`, landing). Server components that fetch must use `API_URL` (`http://api:8080`) not `NEXT_PUBLIC_API_URL` inside the container (see `e2e-debugging.md`).

---

## 3. API surface (by ticket)

**E16.2 — invites**
- `POST /admin/beta/invites` *(admin)* — create an invite (cohort, max_uses, expires_at). Returns code + shareable link.
- `GET  /admin/beta/invites` *(admin)* — list/usage.
- `POST /beta/invites` *(beta member)* — member mints their **own** personal invite from their remaining quota; returns their shareable link. Quota enforced server-side (see Open Decisions for default).
- `GET  /beta/me/invites` *(beta member)* — their codes + remaining quota + who they've brought in (`invited_by = me`).

**E16.3 — naming**
- `GET  /beta/names` — suggestions with vote counts + `my_vote` flag (beta member).
- `POST /beta/names` — submit a suggestion `{ name, rationale? }`.
- `PUT  /beta/names/{id}/vote` / `DELETE …/vote` — approval vote / un-vote (idempotent via PK + `ON CONFLICT DO NOTHING`).
- `POST /admin/beta/names/{id}/status` *(admin)* — set `shortlisted`/`rejected`/`is_winner`.

**E16.4 — feedback**
- `POST /beta/feedback` `{ kind, body }` *(beta member)*.
- `GET  /beta/feedback` *(beta member)* — **only the caller's own** rows (IDOR-safe).
- `GET/PATCH /admin/beta/feedback` *(admin)* — triage inbox.

All `/admin/*` routes go in the existing `RequireAdmin` group; all `/beta/*` member routes go behind `auth.Middleware` + `beta.Gate`. Register literal sub-paths before any `{id}` routes (`api-handler-checklist.md`). Regenerate the OpenAPI client after each ticket's endpoints land.

---

## 4. Frontend (web)

- **E16.1:** `middleware.ts` gate; a "you need an invite" state on `/signup` when no code is present; invite-code field prefilled from `/signup?invite=CODE`.
- **E16.2:** admin invite table (`/admin/beta/invites`); the member-facing **Invite panel** is built here as a component, mounted by E16.4.
- **E16.3:** `/beta/name` page — submit box + a list of suggestions with vote toggles and live counts; admin shortlist controls behind the admin guard.
- **E16.4:** a persistent **"Founding member"** badge in the app chrome (uses `is_beta`); a dashboard **Invite friends** card (personal link + `invites_remaining`, copy-to-clipboard, "drum up hype" copy); a lightweight **Feedback** widget (kind selector + textarea) posting to `/beta/feedback`.

Use the demo design system (`CLAUDE.md`): ink/amber/clay palette, Cormorant Garamond headings, DM Mono for the beta badge/labels. The "founding member" treatment should feel earned — this is the exclusivity surface.

---

## 5. Security & testing

Per `api-handler-checklist.md`, `auth-changes.md`, `sqlc-and-schema.md`:

**Gate canary (E16.1) — the must-have:**
- With `BETA_MODE=on`: GET a gated route (e.g. `/public/festivals` if moved behind the gate, or `/me`) **without** a token → `401`.
- Token for a **non-beta** user → `403`.
- Allowlisted route (`/preview/{token}`, `/claim/{token}`) without a token → still works (`200`/normal) — proves the funnel stays open.
- `POST /auth/signup` without `invite_code` while `BETA_MODE=on` → `403`/`422`.

**Invite redemption race (E16.2):** two concurrent signups with the **same single-use code** via `Promise.all` → exactly one `201`, one `409` (`CHECK (used_count <= max_uses)` + conditional `UPDATE` guarantee it). Re-using an exhausted code → `403`.

**Schema canary (E16.1):** redeem an invite at signup → read the user back via API → assert `is_beta=true`, `beta_cohort` and `invited_by` populated (catches a missed Scan on the new nullable `users` columns — the classic `password_reset.sql.go` gotcha).

**Naming (E16.3):** double-vote the same suggestion → second call idempotent (no duplicate, `PK` holds). One member's vote counted once. Admin-only `status` change → non-admin `403`.

**Feedback IDOR (E16.4):** user A's `GET /beta/feedback` never returns user B's rows; A cannot read/patch B's feedback by id.

**Schema lockstep:** after any `users` column add, both `grep -c '&i\.' api/internal/sqlcdb/users.sql.go` and `…/password_reset.sql.go` must equal the new column count.

---

## 6. Open decisions (for review — I picked defaults, change any)

1. **Landing/waitlist surface.** Default: one minimal allowlisted landing page + a "request access" form that drops into a waitlist table; everything else behind login. Alternative: nothing public but `/login` (harder to capture inbound interest).
2. **Personal invite quota.** Default: **3** invites per founding member, admin-overridable, separate from admin-minted bulk codes. Enough to "share with friends" without uncapped growth.
3. **Voting model.** Default: approval voting (upvote many) + admin shortlist + admin-declared winner. Alternative: single-choice ("back one name").
4. **Cohort mixing.** Default: artists and organisers share one cohort and one naming vote, with votes tagged by role so we can segment results. Alternative: separate cohorts/votes per audience.
5. **Launch exit.** Default: flipping `BETA_MODE=false` opens public signup and removes the gate with no code changes; `is_beta` members keep a "founding member" badge forever. Confirm that's the intended end-state (vs. a hard cutover that strips beta tables).

---

## Out of scope

- A generic polling/survey engine. Naming is a single, bespoke vote; direction is free-text feedback. Build the general thing only if a second use appears.
- The E20 referral *rewards* mechanics (credits, free months for referring). E16's invite graph (`invited_by`) is the substrate; E20 builds incentives on top.
- The AI onboarding flow (E19) — a redeemed invite still lands in today's manual signup; E19 later swaps in the assisted build.
- Public-facing analytics of the naming vote. Admin sees counts; a public reveal is a launch-moment decision, not a feature here.
- Email delivery of invites beyond reusing the existing SES mailer for the invite link (no new templating system).
