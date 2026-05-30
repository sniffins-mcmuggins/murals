# E18 — Artist & Organiser Endorsements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let artists endorse other artists (peer) and festival organisers endorse any artist badged with a festival they own (organiser). Endorsements show as social proof on the artist's profile; the endorsee controls what's shown; the endorser owns the words.

**Architecture:** One `endorsements` table keyed unique on `(endorser_id, endorsee_id)` (upsert on repeat, no self-endorse via CHECK). `kind` ('peer'|'organiser') is validated at write time: peer → endorser has an `artist_profile`; organiser → endorser **owns** `festival_id` (no appearance check — decided 2026-05-30). Endorsee toggles `hidden_by_endorsee`; `moderation_status` plugs into E17. Public reads filter both.

**Tech Stack:** Go 1.22 (chi, pgx, sqlc), Postgres, Next.js, Vitest e2e.

**Spec:** `docs/superpowers/specs/2026-05-30-e18-endorsements-design.md`
**Tracking epic:** E18 (GitHub issue TBD)

> **Docker dual-edit + migration number** (`0000NN`, assume `000015`) — same notes as E16/E17 plans.

> **Child-ticket mapping:** T1–T3 = **E18.1** (core). T4 = **E18.2** (display + endorsee controls). T6 = **E18.3** (E17 integration, needs E17). T5 = e2e. T7 = web.

---

## File Structure

**Created:**
- `db/migrations/000015_endorsements.up.sql` / `.down.sql`
- `db/queries/endorsements.sql`
- `api/internal/endorsement/endorsement.go` — create/withdraw/list handlers
- `api/internal/endorsement/visibility.go` — endorsee hide/show
- `api/internal/endorsement/*_test.go`
- `e2e/api/endorsements.test.ts`

**Modified:**
- `api/internal/sqlcdb/*` (regenerated)
- `api/cmd/api/main.go` — routes
- the public profile read — include endorsements (filtered)
- web: profile endorsements section + composer + endorsee toggles

---

## Task 1: Migration

**Files:** Create `db/migrations/000015_endorsements.up.sql` / `.down.sql`

- [ ] **Step 1: Up**

```sql
CREATE TABLE endorsements (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    endorser_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endorsee_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind          text NOT NULL,
    festival_id   uuid REFERENCES festivals(id) ON DELETE SET NULL,
    body          text,
    skills        text[] NOT NULL DEFAULT '{}',
    hidden_by_endorsee boolean NOT NULL DEFAULT false,
    moderation_status  text   NOT NULL DEFAULT 'ok',
    created_at    timestamptz NOT NULL DEFAULT now(),
    CHECK (endorser_id <> endorsee_id),
    CHECK (kind IN ('peer','organiser')),
    CHECK (kind = 'peer' OR festival_id IS NOT NULL),
    CHECK (moderation_status IN ('ok','hidden','removed'))
);
CREATE UNIQUE INDEX endorsements_one_per_pair ON endorsements (endorser_id, endorsee_id);
CREATE INDEX idx_endorsements_endorsee ON endorsements (endorsee_id) WHERE moderation_status = 'ok';
```

- [ ] **Step 2: Down** — `DROP TABLE IF EXISTS endorsements;`
- [ ] **Step 3: Apply** — `task db:migrate`; verify `\d endorsements`.
- [ ] **Step 4: Commit** — `feat(db): endorsements schema`

---

## Task 2: sqlc queries + regenerate

**Files:** Create `db/queries/endorsements.sql`; regenerate.

- [ ] **Step 1: Queries**

```sql
-- name: UpsertEndorsement :one
INSERT INTO endorsements (endorser_id, endorsee_id, kind, festival_id, body, skills)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (endorser_id, endorsee_id)
DO UPDATE SET body = EXCLUDED.body, skills = EXCLUDED.skills, kind = EXCLUDED.kind, festival_id = EXCLUDED.festival_id
RETURNING *;

-- name: DeleteEndorsement :execrows
DELETE FROM endorsements WHERE id = $1 AND endorser_id = $2;

-- name: SetEndorsementVisibility :execrows
UPDATE endorsements SET hidden_by_endorsee = $3 WHERE id = $1 AND endorsee_id = $2;

-- name: ListPublicEndorsements :many
SELECT * FROM endorsements
WHERE endorsee_id = $1 AND moderation_status = 'ok' AND hidden_by_endorsee = false
ORDER BY (kind = 'organiser') DESC, created_at DESC;

-- name: ListOwnEndorsements :many
SELECT * FROM endorsements WHERE endorsee_id = $1 ORDER BY created_at DESC;

-- name: GetEndorsementByID :one
SELECT * FROM endorsements WHERE id = $1;
```

> `DeleteEndorsement`/`SetEndorsementVisibility` use `:execrows` so the handler can return 404/403 when 0 rows match (wrong owner).

- [ ] **Step 2: Regenerate + lockstep** — `task db:generate`; verify endorsements Scan count.
- [ ] **Step 3: Commit** — `feat(db): sqlc endorsement queries`

---

## Task 3: Core API — create/withdraw/list (E18.1)

**Files:** Create `api/internal/endorsement/endorsement.go`, `endorsement_test.go`; modify `main.go`.

- [ ] **Step 1: Failing tests**
- Self-endorse (`endorsee_id == caller`) → 400.
- Endorsee must be an artist + publicly reachable → else 404.
- `kind='peer'`: caller has an `artist_profile` → 201; caller without one → 403.
- `kind='organiser'`: caller **owns** `festival_id` → 201 (no appearance check); caller does **not** own it → 403.
- Repeat POST same pair → upsert (one row, updated body), not duplicate.
- `DELETE /endorsements/{id}` by endorser → 200; by someone else → 403/404.

- [ ] **Step 2: Run → FAIL** — `cd api && go test ./internal/endorsement/ -v`

- [ ] **Step 3: Implement**
- `CreateEndorsementHandler` — validate self-endorse, endorsee-is-artist (lookup `artist_profile` by user, public-reachable), branch on `kind`: peer → caller has artist_profile; organiser → `festival_id` present AND caller owns it (query festivals by id+owner). Then `UpsertEndorsement`. Fire endorsee notification via bounded background work (`.claude/rules/background-work.md`).
- `WithdrawEndorsementHandler` — `DeleteEndorsement(id, callerID)`; 0 rows → 404.
- `ListEndorsementsHandler` — `GET /profiles/{id}/endorsements` → `ListPublicEndorsements`.

- [ ] **Step 4: Register routes** (literal before param):
```go
r.Post("/endorsements", endorsement.CreateEndorsementHandler(pool, mailer))
r.Delete("/endorsements/{id}", endorsement.WithdrawEndorsementHandler(pool))
r.Get("/profiles/{id}/endorsements", endorsement.ListEndorsementsHandler(pool)) // public
```

- [ ] **Step 5: Run → PASS**; **Step 6: Commit** — `feat(endorsement): create/withdraw/list with peer/organiser validation`

---

## Task 4: Endorsee visibility control (E18.2)

**Files:** Create `api/internal/endorsement/visibility.go`, test; modify `main.go`.

- [ ] **Step 1: Failing tests** — `PATCH /endorsements/{id}/visibility {hidden}` by the **endorsee** → toggles, hidden ones drop from `ListPublicEndorsements`; by the endorser or a third party → 403/404; endorser cannot un-hide what the endorsee hid; endorsee cannot edit `body` (no field exposed).

- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement** — `SetEndorsementVisibility(id, calleeID, hidden)`; 0 rows → 404.
- [ ] **Step 4: Register** — `r.Patch("/endorsements/{id}/visibility", ...)`.
- [ ] **Step 5: Run → PASS**; **Step 6: Commit** — `feat(endorsement): endorsee hide/show control`

---

## Task 5: e2e canaries

**Files:** Create `e2e/api/endorsements.test.ts`

- [ ] **Step 1: Tests**
- Auth: `POST /endorsements` no token → 401.
- Self-endorse → 400 (handler) — CHECK is the backstop.
- **One-per-pair race:** two concurrent POSTs same pair via `Promise.all` → one create + one upsert-merge, never a duplicate.
- **Organiser authenticity:** A badges X with a festival A owns → 201 `kind='organiser'` (no appearance needed); A badges X with a festival A does NOT own → 403.
- IDOR: only endorser deletes; only endorsee patches visibility; cross-user → 403/404.
- Public filtering: a `hidden_by_endorsee` (or `moderation_status!='ok'`) endorsement never appears in `GET /profiles/{id}/endorsements`.

- [ ] **Step 2: Run** — `npx vitest run e2e/api/endorsements.test.ts` → pass.
- [ ] **Step 3: Commit** — `test(e2e): endorsement authenticity + IDOR + filtering`

---

## Task 6: E17 moderation integration (E18.3) — needs E17

> **Do not start until E17.2/E17.3 exist.**

- [ ] **Step 1:** Add `'endorsement'` to the E17 `content_flags` `target_type` CHECK (a new migration `ALTER ... DROP/ADD CONSTRAINT`). Add `endorsement` handling to the moderation action dispatch (a `SetEndorsementModerationStatus` query).
- [ ] **Step 2:** The public endorsements query already filters `moderation_status='ok'` (Task 2) — add an e2e canary: flag + hide an endorsement → absent from the profile.
- [ ] **Step 3: Commit** — `feat(endorsement): flaggable + moderated via E17`

---

## Task 7: Web UI (E18.2)

- [ ] **Step 1:** Endorsements section on the public profile — organiser endorsements highlighted with the festival name + badge (DM Mono); peer endorsements as avatar/name grid; testimonials (Cormorant Garamond); `skills` chips.
- [ ] **Step 2:** "Endorse" button on *other* artists' profiles (hidden on own) → composer (optional blurb + skill tags); organisers get "Endorse as [Festival]" listing festivals **they own** (API enforces).
- [ ] **Step 3:** Endorsee's own profile view — hide/show toggle per endorsement.
- [ ] **Step 4: Commit** — `feat(web): profile endorsements section + composer + toggles`

---

## Self-Review

- **Spec coverage:** table + one-per-pair + no-self (T1) · peer/organiser validation, ownership-only guard (T3) · withdraw/list (T3) · endorsee hide (T4) · public filtering (T2,T5) · E17 integration (T6) · web (T7). ✅
- **Placeholders:** none — handlers and queries are concrete.
- **Types:** `endorsements` columns, `kind` values, and query names (`UpsertEndorsement`, `DeleteEndorsement`, `SetEndorsementVisibility`, `ListPublicEndorsements`) consistent across T2/T3/T4.

---

## Out of scope (this plan)

- Endorsement-as-ranking-input, endorsement requests, brand endorsing, endorsing organisers, aggregated skill-count UI (spec §Out-of-scope).
