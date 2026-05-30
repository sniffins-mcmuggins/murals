# E20 — Refer-an-Artist — Design Spec

**Date:** 2026-05-30
**Status:** Draft
**Epic:** E20 (new)
**Scope:** Let existing artists and festival organisers **bring new artists onto Render** — either as a generic platform referral or as a direct **invite to a specific festival**. The seamless version: the new artist clicks a referral link, lands straight in the E19 AI onboarding ("name + website → we'll build your page in two minutes"), claims it, and the referrer gets credited (and rewarded). The capstone of the growth loop.

---

## Overview

E20 is the demand side of the same engine E16 and E19 built the supply for:

- **E16** gave us the invite graph (`users.invited_by`) and the beta gate.
- **E19** gave us the magic "give us a link, get a built page" onboarding.
- **E20** points a *referrer* at that onboarding and attributes + rewards the conversion.

Two mechanisms, related but distinct:

1. **Platform referral** (artist *or* organiser → new artist). A personal referral link drops the new artist into E19's build flow (`/start?ref=CODE`). On claim, attribution is recorded (`referred_by`) and — on a **qualified** conversion — the referrer earns a reward (comp months via E15.5). This is the anti-churn / word-of-mouth loop.
2. **Direct festival invite** (organiser → named artist → *their* festival). The organiser invites a specific artist (by email) to *their* festival; the same seamless onboarding runs, and on join the artist is **linked to that festival** (a streamlined "invited to apply"), reusing the reviewer-invite email idiom in `auth/invite.go`.

**Reward integrity is the whole game.** Rewards trigger only on a *qualified* conversion (the referred artist actually claims and goes live), never on a click or a bare signup — otherwise referral becomes a fraud farm. Self-referral is blocked, attribution is first-touch and atomic, and each referred artist rewards a referrer at most once.

**Dependencies:** E20 is the capstone — it needs **E19** (the seamless build entry), **E15.4** (claim binding), **E15.5** (comp grants, the reward currency), and reuses **E16**'s `invited_by` graph. Spec'd last for exactly this reason.

---

## Child tickets (build order)

| # | Ticket | Depends on | Areas | Notes |
|---|--------|-----------|-------|-------|
| **E20.1** | Referral links + attribution — `referrals` table, `referred_by`, generate-my-link, landing → E19, first-touch attribution at claim | E19, E15.4 | api, db, web, e2e, **security** | Foundation. Self-referral blocked; attribution atomic + first-touch. |
| **E20.2** | Referral rewards — qualified-conversion → E15.5 comp grant; anti-abuse (dedup, milestone-gated, race-safe) | E20.1, **E15.5** | api, db, e2e, **security** | The fraud-sensitive part. Reward once per referred artist, only on a real milestone. |
| **E20.3** | Direct festival invite — organiser invites a named artist to *their* festival; links artist↔festival on join | E20.1, E19, festival domain | api, db, web, e2e, **security** | Owner-only; can't invite to a festival you don't own (cf. E18 authenticity). |
| **E20.4** | Referrer dashboard — your link, who you've brought, status, rewards earned | E20.1, E20.2 | web, api, e2e | The visibility surface that makes referrers keep sharing. |

**Sequencing:** E20.1 first (attribution substrate). E20.2 (rewards) and E20.3 (festival invite) build on it in parallel. E20.4 surfaces both.

---

## 1. Database

Migration numbers are placeholders — check the highest existing first. The `users` column add ripples into every `users.*` Scan (`password_reset.sql.go`) per `sqlc-and-schema.md`.

### 1a. Referrals + attribution (E20.1)

```sql
-- One referral code per referrer (regenerable). Reuses the auth/invite.go token idiom.
CREATE TABLE referral_codes (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    referrer_id uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code        text        NOT NULL UNIQUE,        -- unguessable, in the share link
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX referral_codes_one_active_per_user ON referral_codes (referrer_id);

-- Attribution: who brought whom. First-touch, immutable once set.
ALTER TABLE users
  ADD COLUMN referred_by   uuid REFERENCES users(id),     -- the referrer (set once, at claim)
  ADD COLUMN referral_code_used text;                     -- the code, for audit

-- A referral event ledger — drives rewards + the dashboard, and is fraud-auditable.
CREATE TABLE referral_events (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    referrer_id   uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    referred_id   uuid        REFERENCES users(id) ON DELETE SET NULL,  -- set on claim
    code          text        NOT NULL,
    festival_id   uuid        REFERENCES festivals(id),    -- set for direct festival invites (E20.3)
    status        text        NOT NULL DEFAULT 'pending',  -- pending|claimed|qualified|rewarded|void
    rewarded_grant_id uuid,                                -- the E15.5 comp_grant issued (E20.2)
    created_at    timestamptz NOT NULL DEFAULT now(),
    qualified_at  timestamptz,
    CHECK (status IN ('pending','claimed','qualified','rewarded','void'))
);
CREATE UNIQUE INDEX referral_events_one_per_referred ON referral_events (referred_id) WHERE referred_id IS NOT NULL;
CREATE INDEX idx_referral_events_referrer ON referral_events (referrer_id);
```

`referred_by` is **first-touch and write-once**: set atomically during the E15.4 claim binding, never overwritten (a conditional `UPDATE … WHERE referred_by IS NULL`). The partial unique index `referral_events_one_per_referred` guarantees a referred artist can credit at most one referrer — the structural anti-double-reward guard.

### 1b. Direct festival invite (E20.3)

The festival binding rides on `referral_events.festival_id` (above) plus a lightweight invited-application marker. Rather than a new table, E20.3 reuses the existing application domain: on join, create an application in an `invited` pre-state (or set an `invited_by_organiser` flag on the application) so the artist lands with a streamlined "you've been invited to apply" rather than a cold form. Exact column vs. table is an implementation choice for that ticket; the spec's requirement is: **the artist ends up linked to the right festival, and the organiser still reviews** (no auto-acceptance).

---

## 2. API surface

**E20.1 — links + attribution**
- `POST /referrals/my-code` *(authed artist or organiser)* — get-or-create the caller's referral code; returns the share link `…/start?ref=CODE`. Regenerate rotates it.
- `GET  /referrals/my-code` — the caller's current code + link.
- The **landing** is E19's `POST /onboarding/build` accepting `referral_code` (the seam noted in E19 §8.7). On the resulting **E15.4 claim**, the bind handler resolves the code → sets `referred_by` (first-touch) + creates/advances the `referral_events` row to `claimed`. Self-referral (resolved referrer == claiming user) → attribution silently dropped (no event, no error).

**E20.2 — rewards**
- No new public endpoint; a **reward step** runs when a referred artist hits the qualifying milestone (see Open Decisions — default: claims *and* goes public). It:
  - Advances the `referral_events` row `claimed → qualified`, then issues an **E15.5 comp grant** to the **referrer** and sets `rewarded`, recording `rewarded_grant_id`. All in one transaction, race-safe (the `one_per_referred` index + a `WHERE status='qualified'` guard make double-reward impossible).
  - Self-referral, void (referred account deleted/flagged), or already-rewarded → no grant.
- `GET /admin/referrals` *(admin)* — fraud review: events, statuses, reward audit.

**E20.3 — direct festival invite**
- `POST /festivals/{festivalID}/invites` `{ artist_email, message? }` *(festival owner only)* — owner-gated like the existing reviewer invite. Creates a `referral_events` row with `festival_id` set + sends the invite email (reuse `auth/invite.go` token idiom + mailer, bounded background work). On join/claim, the artist is linked to that festival per §1b.
- Owner-only: inviting to a festival you don't own → `403` (the E18 authenticity rule, applied to invites).

**E20.4 — dashboard**
- `GET /referrals/dashboard` *(authed)* — the caller's code/link, their `referral_events` (who, status, festival if any), and rewards earned. Returns **only the caller's own** rows.

Routing: `/referrals/*` and the dashboard behind `auth.Middleware` (+ `beta.Gate` during beta). The build *landing* stays public (E19 — a prospect has no account). Literal paths before `{id}`; unauth e2e probe per new group; regenerate OpenAPI client.

---

## 3. Frontend (web)

- **E20.1:** an **"Invite an artist"** / **"Refer an artist"** affordance in the artist + organiser dashboards — shows the personal link, copy-to-clipboard, with warm "bring someone whose work you love" framing. The `/start?ref=CODE` landing is E19's intake, pre-tagged with the referrer's name ("[Referrer] thought you'd love Render — let's build your page").
- **E20.3:** on the organiser's festival page, an **"Invite an artist to this festival"** form (email + optional note), alongside the existing reviewer invite.
- **E20.4:** a **Referrals** panel — your link, a list of artists you've brought (status chips: invited → claimed → live), and rewards earned (free months credited). This visibility is what keeps referrers sharing.
- Design system per `CLAUDE.md`; status chips in DM Mono.

---

## 4. Security & testing

Per `api-handler-checklist.md`, `auth-changes.md`, and E15.4/E15.5's rules:

**Self-referral (E20.1):** a user completing onboarding via *their own* code earns no attribution and no reward — `referred_by` stays null, no `referral_events` row. Test the resolved-referrer-equals-claimer path explicitly.

**First-touch, write-once attribution (E20.1):** claim with a code sets `referred_by` once; a later attempt to re-attribute (second code, re-claim) does **not** overwrite it (`WHERE referred_by IS NULL`). Two concurrent claims with different codes → exactly one attribution (race-safe), the other a no-op.

**Reward integrity (E20.2) — the fraud suite:**
- Reward fires **only** at the qualifying milestone, never on click or bare signup (drive a referred user to *claimed* but not *qualified* → assert no comp grant).
- **One reward per referred artist:** `referral_events_one_per_referred` + the `WHERE status='qualified'` transition guarantee it. Fire two concurrent qualify events via `Promise.all` → exactly one comp grant issued.
- A **voided** referral (referred account deleted/abuse-flagged) issues no reward; an already-rewarded event re-qualifying is a no-op.

**Festival-invite authenticity (E20.3):** only the festival **owner** can `POST /festivals/{id}/invites`; a non-owner → `403`; you cannot attribute an invite to a festival you don't own. The invited artist ends up linked to the **correct** festival, and acceptance still requires organiser review (no auto-appearance). Unauth probe on the new route group → `401`.

**Dashboard IDOR (E20.4):** `GET /referrals/dashboard` returns only the caller's events; user A can never see user B's referrals or rewards.

**Rate-limit / abuse:** code generation and invite-send are rate-limited (reuse `auth.RateLimitMiddleware`); the public build landing inherits E19's per-IP + global caps, so a referral link can't be used to bypass E19's cost ceiling.

**Schema lockstep:** after the `users` column adds, `&i\.` counts in `users.sql.go` and `password_reset.sql.go` equal the new column count.

---

## 5. Open decisions (for review — defaults chosen)

1. **Reward type.** Default: **comp months via E15.5** (e.g. 1 free month per qualified referral). Reuses the gift/comp machinery — no new billing path. Alternatives: E16 invite-quota top-ups, or status/leaderboard only (no material reward).
2. **Qualifying milestone.** Default: referred artist **claims and goes public** (going public is itself gated on pay/comp via E15.5, so "live" is a real, low-fraud signal). Alternatives: claim-only (higher fraud), or referred artist *pays* (highest bar, lowest volume).
3. **Reward magnitude + cap.** Default: a small per-referral reward with a per-referrer monthly cap to bound cost and farming. Pick the numbers.
4. **Two-sided?** Default: **one-sided** (referrer rewarded) for v1 — the referred artist already gets the comp/founder perks from E16/E15.5. Alternative: also credit the new artist (two-sided) for stronger pull, at higher cost.
5. **Attribution window.** Default: first-touch, attributed at claim, no expiry on the pending state (a prospect can claim weeks later). Alternative: a 30-day attribution window.
6. **Direct-invite outcome (E20.3).** Default: a streamlined **"invited to apply"** state — pre-fills/fast-tracks the application but the organiser still reviews. Alternative: auto-create a draft application; (explicitly **not** auto-accept).
7. **Who can refer / invite.** Default: artists + organisers can both *refer to platform*; only organisers can *invite to a festival* (they own festivals). Confirm.

---

## Out of scope

- Cash / payout rewards or affiliate-style commissions. Rewards are in-product comp value, not money out.
- Public referral leaderboards / viral mechanics beyond the personal dashboard.
- Referral for **organisers** (bringing new *organisers* onto the platform). v1 refers *artists*; an organiser-referral programme is a separate later effort.
- Multi-level / chain rewards (rewarding the referrer's referrer). Single hop only.
- The reward *currency* itself — E15.5 owns comp grants; E20 only issues them.
- Editing/curating the AI-built page during the referral flow — that's E19/E15.3; E20 just gets the artist to the door.
