# E20 — Refer-an-Artist — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let artists and organisers bring new artists onto Render — a personal referral link drops the new artist into E19's build flow and, on a *qualified* conversion, rewards the referrer with comp months (E15.5); plus a direct organiser→artist→festival invite. Reward integrity (qualified-only, dedup, no self-referral) is the whole game.

**Architecture:** `referral_codes` (one per referrer, reuses the `auth/invite.go` token idiom). `users.referred_by` is first-touch + write-once, set atomically at the E15.4 claim. A `referral_events` ledger drives rewards + the dashboard, with a partial unique index `(referred_id)` guaranteeing one reward per referred artist. Rewards fire only when the referred artist **claims and goes public**, issuing an E15.5 comp grant to the referrer in one race-safe transaction. Direct festival invites ride `referral_events.festival_id`.

**Tech Stack:** Go 1.22 (chi, pgx, sqlc), Postgres, Next.js, Vitest e2e.

**Spec:** `docs/superpowers/specs/2026-05-30-e20-refer-an-artist-design.md`
**Tracking epic:** E20 (GitHub issue TBD)
**Dependencies:** E19 (onboarding entry), E15.4 (claim binding), E15.5 (comp grants — the reward currency), reuses E16's `invited_by` graph. Capstone — build last.

> **Docker dual-edit + migration number** (`0000NN`, assume `000017`) — same notes as prior plans.

> **Child-ticket mapping:** T1–T3 = **E20.1** (attribution). T4 = **E20.2** (rewards, needs E15.5). T5 = **E20.3** (festival invite). T6 = **E20.4** (dashboard). T7 = e2e. T8 = web.

---

## File Structure

**Created:**
- `db/migrations/000017_referrals.up.sql` / `.down.sql`
- `db/queries/referrals.sql`
- `api/internal/referral/codes.go` — get/create my code
- `api/internal/referral/attribution.go` — resolve code + set referred_by at claim
- `api/internal/referral/rewards.go` — qualify → E15.5 comp grant
- `api/internal/referral/festival_invite.go` — organiser → artist → festival
- `api/internal/referral/dashboard.go`
- `api/internal/referral/*_test.go`
- `e2e/api/referrals.test.ts`

**Modified:**
- `api/internal/sqlcdb/*` (regenerated)
- E15.4 claim handler — call referral attribution
- E15.3/E15.5 publish path — call referral qualify hook
- E19 `POST /onboarding/build` — accept `referral_code`
- `api/cmd/api/main.go` — routes; web dashboards

---

## Task 1: Migration (E20.1)

**Files:** Create `db/migrations/000017_referrals.up.sql` / `.down.sql`

- [ ] **Step 1: Up**

```sql
CREATE TABLE referral_codes (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    referrer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code        text NOT NULL UNIQUE,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX referral_codes_one_active_per_user ON referral_codes (referrer_id);

ALTER TABLE users
  ADD COLUMN referred_by         uuid REFERENCES users(id),
  ADD COLUMN referral_code_used  text;

CREATE TABLE referral_events (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    referrer_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    referred_id   uuid REFERENCES users(id) ON DELETE SET NULL,
    code          text NOT NULL,
    festival_id   uuid REFERENCES festivals(id),
    status        text NOT NULL DEFAULT 'pending',
    rewarded_grant_id uuid,
    created_at    timestamptz NOT NULL DEFAULT now(),
    qualified_at  timestamptz,
    CHECK (status IN ('pending','claimed','qualified','rewarded','void'))
);
CREATE UNIQUE INDEX referral_events_one_per_referred ON referral_events (referred_id) WHERE referred_id IS NOT NULL;
CREATE INDEX idx_referral_events_referrer ON referral_events (referrer_id);
```

- [ ] **Step 2: Down** — drop `referral_events`; drop the two `users` columns; drop `referral_codes`.
- [ ] **Step 3: Apply** — `task db:migrate`; verify columns/tables.
- [ ] **Step 4: Commit** — `feat(db): referrals schema — codes, attribution, event ledger`

---

## Task 2: sqlc queries + regenerate (E20.1)

**Files:** Create `db/queries/referrals.sql`; regenerate.

- [ ] **Step 1: Queries**

```sql
-- name: GetOrCreateReferralCode :one
INSERT INTO referral_codes (referrer_id, code) VALUES ($1, $2)
ON CONFLICT (referrer_id) DO UPDATE SET referrer_id = EXCLUDED.referrer_id
RETURNING *;

-- name: GetReferralCode :one
SELECT * FROM referral_codes WHERE code = $1;

-- name: SetReferredByIfNull :execrows
UPDATE users SET referred_by = $2, referral_code_used = $3
WHERE id = $1 AND referred_by IS NULL;

-- name: CreateReferralEvent :one
INSERT INTO referral_events (referrer_id, referred_id, code, festival_id, status)
VALUES ($1, $2, $3, $4, 'claimed')
ON CONFLICT (referred_id) WHERE referred_id IS NOT NULL DO NOTHING
RETURNING *;

-- name: QualifyReferralEvent :one
UPDATE referral_events SET status='rewarded', qualified_at=now(), rewarded_grant_id=$2
WHERE referred_id = $1 AND status IN ('claimed','qualified')
RETURNING *;

-- name: ListReferralEventsByReferrer :many
SELECT * FROM referral_events WHERE referrer_id = $1 ORDER BY created_at DESC;
```

> `SetReferredByIfNull` is first-touch write-once. `QualifyReferralEvent`'s `WHERE … status IN ('claimed','qualified')` + the `one_per_referred` index make double-reward impossible.

- [ ] **Step 2: Regenerate + lockstep** — `task db:generate`; verify `users.sql.go` + `password_reset.sql.go` Scan counts.
- [ ] **Step 3: Commit** — `feat(db): sqlc referral queries`

---

## Task 3: Codes + attribution-at-claim (E20.1)

**Files:** Create `api/internal/referral/codes.go`, `attribution.go`, tests; modify the E15.4 claim handler + E19 build endpoint + `main.go`.

- [ ] **Step 1: Failing tests**
- `POST /referrals/my-code` returns a stable code + `/start?ref=CODE` link (idempotent).
- Attribution at claim: claim carrying a code sets `referred_by` once + creates a `claimed` `referral_events` row.
- **Self-referral:** resolved referrer == claiming user → no attribution, no event (silently dropped).
- **First-touch write-once:** a second code on re-claim does not overwrite `referred_by`.

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implement**
- `codes.go`: `MyCodeHandler` — `GetOrCreateReferralCode` (generate via `crypto/rand` base62, reuse `auth/invite.go` idiom).
- `attribution.go`: `AttributeClaim(ctx, q, referredUserID, code)` — resolve code → referrer; if referrer == referred → return (self-referral no-op); `SetReferredByIfNull`; `CreateReferralEvent` (ON CONFLICT DO NOTHING). Call it from the **E15.4 claim handler** inside the claim transaction.
- E19: `POST /onboarding/build` stores `referral_code` → `referral_id`/code carried to the eventual claim.

- [ ] **Step 4: Run → PASS**; **Step 5: Commit** — `feat(referral): codes + first-touch attribution at claim`

---

## Task 4: Rewards — qualify → comp grant (E20.2) — needs E15.5

> **Do not start until E15.5 (`comp_grants`, #180) exists.**

**Files:** Create `api/internal/referral/rewards.go`, test; modify the publish path (E15.3/E15.5).

- [ ] **Step 1: Failing tests**
- A referred artist who only *claims* (not public) → no comp grant.
- Referred artist **claims and goes public** → exactly one comp grant issued to the referrer; event → `rewarded`.
- **One-per-referred / race:** two concurrent qualify events via `Promise.all` → exactly one grant (the `one_per_referred` index + `status` guard).
- Void/self-referral/already-rewarded → no grant.

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implement** — `QualifyReferral(ctx, referredUserID)`: in one tx, `QualifyReferralEvent` (no row → already rewarded/none → return); issue an **E15.5 comp grant** to `referrer_id`; set `rewarded_grant_id`. Call it from the **publish/go-public hook** (E15.3) when the referred artist's profile goes live.

- [ ] **Step 4: Run → PASS**; **Step 5: Commit** — `feat(referral): qualified-conversion reward via E15.5 comp grant`

---

## Task 5: Direct festival invite (E20.3)

**Files:** Create `api/internal/referral/festival_invite.go`, test; modify `main.go`.

- [ ] **Step 1: Failing tests** — `POST /festivals/{festivalID}/invites {artist_email, message?}`: **festival owner only** (non-owner → 403); creates a `referral_events` row with `festival_id`; sends the invite email (reuse `auth/invite.go` token idiom + mailer); on join/claim the artist is linked to that festival (a streamlined "invited to apply" — organiser still reviews, no auto-accept). Unauth → 401.

- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement** — owner check (festivals by id+owner); create event; email via bounded background work; the festival link is read on claim (extend the attribution path to set the festival "invited" marker per spec §1b).
- [ ] **Step 4: Run → PASS**; **Step 5: Commit** — `feat(referral): organiser direct festival invite`

---

## Task 6: Referrer dashboard (E20.4)

**Files:** Create `api/internal/referral/dashboard.go`, test; web panel.

- [ ] **Step 1: Failing test** — `GET /referrals/dashboard` returns the caller's code/link + their `referral_events` + rewards; **only the caller's own** rows (IDOR: A can't see B's).
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement** — `ListReferralEventsByReferrer(callerID)` + the code; web Referrals panel (link, copy, status chips: invited → claimed → live, rewards earned).
- [ ] **Step 4: Run → PASS**; **Step 5: Commit** — `feat(referral): referrer dashboard (IDOR-safe)`

---

## Task 7: e2e canaries

**Files:** Create `e2e/api/referrals.test.ts`

- [ ] **Step 1: Tests**
- Self-referral → no attribution, no event.
- First-touch write-once: re-claim with a different code does not overwrite `referred_by`; two concurrent claims with different codes → exactly one attribution.
- **Reward integrity:** claim-but-not-public → no grant; claims+public → exactly one grant; two concurrent qualifies → one grant; void → no grant.
- **Festival-invite authenticity:** non-owner `POST /festivals/{id}/invites` → 403; unauth → 401; invited artist linked to the correct festival, still requires review.
- Dashboard IDOR: A's dashboard excludes B's referrals.

- [ ] **Step 2: Run** — `npx vitest run e2e/api/referrals.test.ts`.
- [ ] **Step 3: Commit** — `test(e2e): referral attribution, reward integrity, festival-invite auth`

---

## Task 8: Web UI

- [ ] **Step 1:** "Refer an artist" / "Invite an artist" affordance in artist + organiser dashboards — personal link + copy + warm framing; `/start?ref=CODE` landing pre-tagged with the referrer's name.
- [ ] **Step 2:** Organiser festival page — "Invite an artist to this festival" form (email + note).
- [ ] **Step 3:** Referrals panel (Task 6).
- [ ] **Step 4: Commit** — `feat(web): referral + festival-invite UI + dashboard`

---

## Self-Review

- **Spec coverage:** codes + first-touch attribution + self-referral guard (T1–T3) · qualified-only reward via E15.5, one-per-referred (T4) · direct festival invite owner-gated (T5) · dashboard IDOR (T6) · integrity canaries (T7) · web (T8). ✅
- **Placeholders:** T4 gated on E15.5 (real dependency). Attribution/qualify hooks call into E15.4/E15.3 handlers (named integration points, not TODOs).
- **Types:** `referral_events` columns + statuses, `SetReferredByIfNull`/`CreateReferralEvent`/`QualifyReferralEvent` names, and the `AttributeClaim`/`QualifyReferral` integration functions are consistent across T2/T3/T4.

---

## Out of scope (this plan)

- Cash/affiliate payouts, public leaderboards, organiser-referral, multi-level rewards, the comp-grant currency itself (E15.5 owns it), editing the AI-built page (E19/E15.3) — spec §Out-of-scope.
