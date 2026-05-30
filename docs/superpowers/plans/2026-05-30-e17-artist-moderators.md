# E17 — Artists as Moderators — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give trusted users an `is_moderator` capability to work a queue of flagged content (profiles/collections/images) and take graded actions (dismiss/hide/restore/escalate); hidden content disappears from every public surface. Anyone can flag.

**Architecture:** `users.is_moderator` (DB-authoritative, admin-granted) guarded by `RequireModerator`, mirroring `is_admin`. Flags are polymorphic (`content_flags(target_type, target_id)`) with a partial unique index killing flag-spam. A `moderation_status` column ('ok'|'hidden'|'removed') on each moderatable table is orthogonal to the artist's own `visibility` — a mod's `hide` overrides public visibility; every public-read query gains `AND moderation_status = 'ok'`. Actions are audited in `moderation_actions`.

**Tech Stack:** Go 1.22 (chi, pgx, sqlc), Postgres, Next.js, Vitest e2e.

**Spec:** `docs/superpowers/specs/2026-05-30-e17-artist-moderators-design.md`
**Tracking epic:** E17 (GitHub issue TBD)

> **Docker dual-edit discipline** (`.claude/rules/e2e-debugging.md`) and **migration number** (`0000NN`, run `ls db/migrations | tail -3` first; this plan assumes `000014`) — same notes as the E16 plan.

> **Child-ticket mapping:** T1–T3 = **E17.1** (role). T1(flags)+T4 = **E17.2** (flagging). T1(status/actions)+T5+T6 = **E17.3** (queue/actions/public-filter). T7 = e2e. T8 = web. T9 = **E17.4** (deferred, needs E15.4).

---

## File Structure

**Created:**
- `db/migrations/000014_moderation.up.sql` / `.down.sql`
- `db/queries/moderation.sql` — flags, queue, actions, status updates
- `api/internal/moderation/middleware.go` — `RequireModerator(pool)`
- `api/internal/moderation/grant.go` — admin grant/revoke `is_moderator`
- `api/internal/moderation/flags.go` — `POST /flags`
- `api/internal/moderation/queue.go` — `GET /mod/queue`, detail, action handler
- `api/internal/moderation/*_test.go`
- `e2e/api/moderation.test.ts`

**Modified:**
- `api/internal/sqlcdb/*` (regenerated)
- public-read query sites — add `AND moderation_status = 'ok'`: profile GET, `/public/profiles`, collections/images public reads, festival map/application joins (audit list in Task 6)
- `api/cmd/api/main.go` — route groups + `RequireModerator`
- web: admin user page (moderator toggle), public content (flag affordance), `/mod` queue page

---

## Task 1: Migration

**Files:** Create `db/migrations/000014_moderation.up.sql` / `.down.sql`

- [ ] **Step 1: Up migration**

```sql
ALTER TABLE users ADD COLUMN is_moderator boolean NOT NULL DEFAULT false;

CREATE TABLE content_flags (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    target_type text NOT NULL,
    target_id   uuid NOT NULL,
    flagged_by  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason      text NOT NULL,
    note        text,
    status      text NOT NULL DEFAULT 'open',
    created_at  timestamptz NOT NULL DEFAULT now(),
    resolved_at timestamptz,
    resolved_by uuid REFERENCES users(id),
    CHECK (target_type IN ('profile','collection','image')),
    CHECK (reason IN ('spam','ai_generated','abuse','off_topic','copyright','other')),
    CHECK (status IN ('open','resolved','dismissed'))
);
CREATE UNIQUE INDEX content_flags_one_open_per_user
  ON content_flags (target_type, target_id, flagged_by) WHERE status = 'open';
CREATE INDEX idx_content_flags_target ON content_flags (target_type, target_id) WHERE status = 'open';

ALTER TABLE artist_profiles   ADD COLUMN moderation_status text NOT NULL DEFAULT 'ok';
ALTER TABLE collections       ADD COLUMN moderation_status text NOT NULL DEFAULT 'ok';
ALTER TABLE collection_images ADD COLUMN moderation_status text NOT NULL DEFAULT 'ok';
ALTER TABLE artist_profiles   ADD CONSTRAINT artist_profiles_modstatus   CHECK (moderation_status IN ('ok','hidden','removed'));
ALTER TABLE collections       ADD CONSTRAINT collections_modstatus       CHECK (moderation_status IN ('ok','hidden','removed'));
ALTER TABLE collection_images ADD CONSTRAINT collection_images_modstatus CHECK (moderation_status IN ('ok','hidden','removed'));

CREATE TABLE moderation_actions (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    moderator_id uuid NOT NULL REFERENCES users(id),
    target_type  text NOT NULL,
    target_id    uuid NOT NULL,
    action       text NOT NULL,
    note         text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    CHECK (action IN ('dismiss','hide','remove','restore','escalate'))
);
CREATE INDEX idx_moderation_actions_target ON moderation_actions (target_type, target_id);
```

> Confirm the real table names are `artist_profiles`, `collections`, `collection_images` (per E15.4 / models.go) before running.

- [ ] **Step 2: Down migration** — drop in reverse (moderation_actions; drop the 3 modstatus columns+constraints; content_flags + indexes; users.is_moderator).

- [ ] **Step 3: Apply** — `task db:migrate`; verify `\d users | grep is_moderator` and `\d artist_profiles | grep moderation_status`.

- [ ] **Step 4: Commit** — `git commit -m "feat(db): moderation schema — flags, status, actions, is_moderator"`

---

## Task 2: sqlc queries + regenerate

**Files:** Create `db/queries/moderation.sql`; regenerate.

- [ ] **Step 1: Queries**

```sql
-- name: SetUserModerator :one
UPDATE users SET is_moderator = $2 WHERE id = $1 RETURNING *;

-- name: CreateFlag :one
INSERT INTO content_flags (target_type, target_id, flagged_by, reason, note)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (target_type, target_id, flagged_by) WHERE status = 'open' DO NOTHING
RETURNING *;

-- name: ListOpenFlagsGrouped :many
SELECT target_type, target_id, count(*) AS flag_count,
       array_agg(reason) AS reasons, max(created_at) AS last_flagged
FROM content_flags WHERE status = 'open'
GROUP BY target_type, target_id ORDER BY flag_count DESC, last_flagged DESC;

-- name: ListFlagsForTarget :many
SELECT * FROM content_flags WHERE target_type = $1 AND target_id = $2 AND status = 'open';

-- name: ResolveFlagsForTarget :exec
UPDATE content_flags SET status = $3, resolved_at = now(), resolved_by = $4
WHERE target_type = $1 AND target_id = $2 AND status = 'open';

-- name: SetProfileModerationStatus :exec
UPDATE artist_profiles SET moderation_status = $2 WHERE id = $1;
-- name: SetCollectionModerationStatus :exec
UPDATE collections SET moderation_status = $2 WHERE id = $1;
-- name: SetImageModerationStatus :exec
UPDATE collection_images SET moderation_status = $2 WHERE id = $1;

-- name: CreateModerationAction :one
INSERT INTO moderation_actions (moderator_id, target_type, target_id, action, note)
VALUES ($1, $2, $3, $4, $5) RETURNING *;
```

- [ ] **Step 2: Regenerate + lockstep** — `task db:generate`; verify `&i\.` counts in `users.sql.go`, `password_reset.sql.go`, and the three content tables' `*.sql.go` equal new column counts (`.claude/rules/sqlc-and-schema.md`).

- [ ] **Step 3: Commit** — `git commit -m "feat(db): sqlc moderation queries"`

---

## Task 3: `RequireModerator` + admin grant/revoke (E17.1)

**Files:** Create `api/internal/moderation/middleware.go`, `grant.go`, tests; modify `main.go`.

- [ ] **Step 1: Failing tests** — `RequireModerator`: no token → 401, non-mod → 403, mod (live DB `is_moderator=true`) → passthrough; a **demoted** mod's token loses access (live read). Grant/revoke (`POST/DELETE /admin/users/{id}/moderator`) admin-only → non-admin 403. Mirror `api/internal/admin/middleware_test.go`.

- [ ] **Step 2: Run → FAIL** — `cd api && go test ./internal/moderation/ -v`

- [ ] **Step 3: Implement** — `RequireModerator(pool)` reads `GetUserByID` and checks live `IsModerator` (copy `RequireAdmin` shape from `api/internal/admin/middleware.go`, which reads live `IsAdmin` per `.claude/rules/auth-changes.md`). `grant.go`: `SetUserModerator` handlers.

- [ ] **Step 4: Register** — in `main.go` admin group: `r.Post("/admin/users/{id}/moderator", ...)`, `r.Delete(...)`. Add the `/mod` group: `r.Group(func(r){ r.Use(auth.Middleware...); r.Use(beta.Gate...); r.Use(moderation.RequireModerator(pool)); ... })`.

- [ ] **Step 5: Run → PASS**; **Step 6: Commit** — `feat(moderation): RequireModerator + admin grant/revoke`

---

## Task 4: Flagging (E17.2)

**Files:** Create `api/internal/moderation/flags.go`, `flags_test.go`; modify `main.go`.

- [ ] **Step 1: Failing tests** — `POST /flags` `{target_type,target_id,reason,note?}`: creates one open flag; second identical flag by same user → idempotent (still one row, partial unique index); flagging a target the caller can't see (draft/non-existent) → 404 (no probe oracle); rate-limited.

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implement** — validate `reason`/`target_type`; verify the target exists AND is publicly reachable for this caller (reuse the public-visibility check) else 404; `CreateFlag` (`ON CONFLICT ... DO NOTHING`) → no row means already-flagged → return 202 idempotently. Mount in a rate-limited authed group (not the `/mod` group — any member can flag).

- [ ] **Step 4: Run → PASS**; **Step 5: Commit** — `feat(moderation): content flagging (polymorphic, deduped, rate-limited)`

---

## Task 5: Queue + actions + audit + self-guard (E17.3)

**Files:** Create `api/internal/moderation/queue.go`, `queue_test.go`; modify `main.go`.

- [ ] **Step 1: Failing tests** — `GET /mod/queue` (mod) returns grouped open flags; `POST /mod/queue/{type}/{id}/action` `{action,note?}`: `dismiss` resolves flags (no content change); `hide` sets `moderation_status='hidden'` + writes a `moderation_actions` row + resolves flags; `restore` → 'ok'; `escalate` marks for admin; `remove` by a plain mod → 403 (admin-only); **self-action guard**: a mod acting on their *own* content → 403/auto-escalate.

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implement** — queue handler (`ListOpenFlagsGrouped` + render target summaries); action handler dispatches on `action`, calls the right `Set*ModerationStatus`, `ResolveFlagsForTarget`, `CreateModerationAction`; owner-notify on `hide` via bounded background work (`.claude/rules/background-work.md`); ownership lookup for the self-guard. `remove` gated to admin (separate `/admin/mod/...` route or an in-handler `is_admin` check).

- [ ] **Step 4: Run → PASS**; **Step 5: Commit** — `feat(moderation): queue + graded actions + audit + self-guard`

---

## Task 6: Public-read filtering (E17.3) — the critical change

**Files:** Modify every public-read query/handler that returns profile/collection/image content.

- [ ] **Step 1: Audit the public-read sites.** Grep for the queries powering: `GET /profiles/{id}` (public path), `/public/profiles`, the E15.2 `/preview/{token}` read, collections/images public reads, the festival map handler, and any festival/application join that surfaces artist content. List them.

- [ ] **Step 2: Add the filter.** To each, add `AND moderation_status = 'ok'` (for joins, filter the joined content table too). Regenerate if sqlc queries changed; grep-verify Scan lockstep.

- [ ] **Step 3: Failing e2e first (canary)** — write the test in Task 7 *before* this change and watch it fail, then make it pass here (TDD across tasks).

- [ ] **Step 4: Commit** — `feat(moderation): filter hidden content from all public surfaces`

---

## Task 7: e2e canaries

**Files:** Create `e2e/api/moderation.test.ts`

- [ ] **Step 1: Tests**
- Role wiring: `GET /mod/queue` no token → 401; non-mod token → 403; grant `is_moderator` (admin) then access → 200. Grant endpoint non-admin → 403.
- **Public-filtering canary (critical):** create a `public` profile (+ collection + image); confirm visible on `/public/profiles`, `/preview/{token}`, festival map. `hide` it via a mod action → assert **absent/404** on *all* those surfaces; `restore` → reappears. (This catches a missed `AND moderation_status='ok'` anywhere.)
- Flag dedup: same user flags twice → one open row. Flag unseeable target → 404.
- Self-action guard: mod cannot action own content.
- `remove` by plain mod → 403.

- [ ] **Step 2: Run** — `npx vitest run e2e/api/moderation.test.ts` → all pass.

- [ ] **Step 3: Commit** — `test(e2e): moderation role, flagging, public-filtering canary`

---

## Task 8: Web UI

- [ ] **Step 1:** Admin user page — "Moderator" toggle (admin-gated) calling the grant/revoke endpoints.
- [ ] **Step 2:** Flag affordance — "⚑ Report" on public profile/collection/image, reason picker + note → `POST /flags`, confirmation toast, no public flag count.
- [ ] **Step 3:** `/mod` queue page (moderator-gated) — flagged items with reason chips + counts, detail pane, action buttons (Dismiss/Hide/Restore/Escalate). "Moderator" badge in chrome. Design system per `CLAUDE.md`.
- [ ] **Step 4: Commit** — `feat(web): moderator toggle, flag affordance, /mod queue`

---

## Task 9: E17.4 — moderators can build prospect pages (DEFERRED, needs E15.4)

> **Do not start until E15.4 (`POST /admin/prospects`) exists.** Then: widen its auth from admin-only to `is_moderator OR is_admin` (reuse all its machinery), add an e2e test that a moderator (non-admin) can create a prospect and an ordinary member cannot. Small, self-contained.

---

## Self-Review

- **Spec coverage:** role (T3) · flagging polymorphic+dedup (T1,T2,T4) · queue+actions+audit+self-guard (T5) · moderation_status + public filtering (T1,T6) · owner notify (T5) · E17.4 (T9, deferred) · canaries incl. public-filtering (T7). ✅
- **Placeholders:** middleware/handlers reference `admin/middleware.go` patterns to confirm signatures (deliberate "match codebase"), not TODOs.
- **Types:** `content_flags` columns, `target_type` enum values, `moderation_status` values, and `Set*ModerationStatus`/`CreateModerationAction`/`ResolveFlagsForTarget` names are consistent across T2/T4/T5.

---

## Out of scope (this plan)

- Automated AI-slop detection, appeals workflow, moderator/flagger reputation, chat moderation, public transparency reports (all in spec §Out-of-scope).
