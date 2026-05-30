# E19 — AI Onboarding Backend (artist profile auto-build) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **When implementing the LLM planner (Task 6), also load the `claude-api` skill** — prompt caching on the system prompt is mandatory.

**Goal:** A visitor gives us a name + a link or two; within ~2 minutes we've built them a draft artist profile from their public work (bio in Render's voice, work grouped into collections, images re-hosted) as an unclaimed E15.4 prospect they can review, rate, and claim. "AI plans, deterministic tools build."

**Architecture:** `POST /onboarding/build` (public, info-first, rate-limited, atomically budget-capped) creates an `ai_build_jobs` row; an in-process worker runs three bounded stages — **harvest** (SSRF-hardened Go fetch → page text + image candidates), **plan** (Sonnet → a structured build-plan whose images are *references into the candidate set*), **build** (deterministic → E15.4 prospect + image re-upload). The visitor polls status, reviews the result, leaves feedback, and claims via the existing E15.4 flow.

**Tech Stack:** Go 1.22 (chi, pgx, sqlc), Anthropic Claude API (Sonnet `claude-sonnet-4-6`, prompt caching), Postgres, Next.js, Vitest e2e.

**Spec:** `docs/superpowers/specs/2026-05-30-e19-ai-onboarding-backend-design.md`
**Tracking epic:** E19 (GitHub issue TBD)
**Hard dependency:** E15 — visibility (E15.1), preview token (E15.2), prospect+claim (E15.4). Task 7 (builder) cannot land until E15.4 exists.

> **Docker dual-edit + migration number** (`0000NN`, assume `000016`) — same notes as prior plans.

> **Child-ticket mapping:** T1–T4 = **E19.1** (jobs/worker/status/client). T5 = **E19.2** (harvester). T6 = **E19.3** (planner). T7 = **E19.4** (builder, needs E15.4). T8 = **E19.5** (UI + feedback). T9 = e2e.

---

## File Structure

**Created:**
- `db/migrations/000016_ai_onboarding.up.sql` / `.down.sql`
- `db/queries/ai_build.sql`
- `api/internal/aibuild/jobs.go` — create/status handlers
- `api/internal/aibuild/worker.go` — worker pool + stage dispatch
- `api/internal/aibuild/budget.go` — atomic daily-cap admit + per-IP limit
- `api/internal/aibuild/harvest.go` — SSRF-hardened fetch + candidate extraction
- `api/internal/aibuild/harvest_test.go` — the SSRF matrix
- `api/internal/aibuild/planner.go` — Claude call + build-plan validation
- `api/internal/aibuild/planner_test.go` — mocked client
- `api/internal/aibuild/builder.go` — execute plan → E15.4 prospect (needs E15.4)
- `api/internal/aibuild/feedback.go` — feedback capture
- `api/internal/llm/anthropic.go` — thin Anthropic client wrapper (fail-loud)
- `e2e/api/ai-onboarding.test.ts`

**Modified:**
- `api/internal/config/config.go` — `AI_BUILD_*` envs
- `api/cmd/api/main.go` — boot-wire client (fail-loud) + worker + routes
- `api/internal/sqlcdb/*` (regenerated)
- web: `/start` intake + progress + reveal + feedback

---

## Task 1: Migration (E19.1)

**Files:** Create `db/migrations/000016_ai_onboarding.up.sql` / `.down.sql`

- [ ] **Step 1: Up**

```sql
CREATE TABLE ai_build_jobs (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id    text NOT NULL,
    status        text NOT NULL DEFAULT 'queued',
    intake        jsonb NOT NULL,
    harvested     jsonb,
    plan          jsonb,
    model         text,
    input_tokens  int,
    output_tokens int,
    prospect_id   uuid REFERENCES artist_profiles(id) ON DELETE SET NULL,
    error         text,
    referral_id   uuid,
    ip_hash       text NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CHECK (status IN ('queued','harvesting','planning','building','ready','failed'))
);
CREATE INDEX idx_ai_build_jobs_active ON ai_build_jobs (status)
  WHERE status IN ('queued','harvesting','planning','building');
CREATE INDEX idx_ai_build_jobs_ip ON ai_build_jobs (ip_hash, created_at);

CREATE TABLE ai_build_feedback (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id     uuid NOT NULL REFERENCES ai_build_jobs(id) ON DELETE CASCADE,
    rating     int,
    liked      text,
    changed    text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ai_build_budget (
    day   date PRIMARY KEY,
    count int  NOT NULL DEFAULT 0
);
```

- [ ] **Step 2: Down** — drop the three tables (feedback, budget, jobs — jobs last).
- [ ] **Step 3: Apply** — `task db:migrate`.
- [ ] **Step 4: Commit** — `feat(db): AI onboarding schema — jobs, feedback, budget`

---

## Task 2: sqlc queries + regenerate (E19.1)

**Files:** Create `db/queries/ai_build.sql`; regenerate.

- [ ] **Step 1: Queries** (key ones)

```sql
-- name: AdmitDailyBuild :one
INSERT INTO ai_build_budget (day, count) VALUES (current_date, 1)
ON CONFLICT (day) DO UPDATE SET count = ai_build_budget.count + 1
WHERE ai_build_budget.count < $1
RETURNING count;

-- name: CountRecentJobsByIP :one
SELECT count(*) FROM ai_build_jobs WHERE ip_hash = $1 AND created_at > now() - interval '1 day';

-- name: CreateBuildJob :one
INSERT INTO ai_build_jobs (session_id, intake, ip_hash, referral_id)
VALUES ($1, $2, $3, $4) RETURNING *;

-- name: GetBuildJob :one
SELECT * FROM ai_build_jobs WHERE id = $1;

-- name: UpdateBuildJobStage :one
UPDATE ai_build_jobs SET status=$2, harvested=COALESCE($3,harvested), plan=COALESCE($4,plan),
       model=COALESCE($5,model), prospect_id=COALESCE($6,prospect_id), error=COALESCE($7,error),
       updated_at=now() WHERE id=$1 RETURNING *;

-- name: ClaimQueuedJob :one
UPDATE ai_build_jobs SET status='harvesting', updated_at=now()
WHERE id = (SELECT id FROM ai_build_jobs WHERE status='queued' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
RETURNING *;

-- name: CreateBuildFeedback :one
INSERT INTO ai_build_feedback (job_id, rating, liked, changed) VALUES ($1,$2,$3,$4) RETURNING *;
```

> `AdmitDailyBuild` is the atomic spend ceiling (no row → over cap). `ClaimQueuedJob` uses `FOR UPDATE SKIP LOCKED` so multiple workers don't grab the same job.

- [ ] **Step 2: Regenerate** — `task db:generate`; Scan lockstep on the new tables.
- [ ] **Step 3: Commit** — `feat(db): sqlc AI-build queries (atomic budget, job claim)`

---

## Task 3: Config + fail-loud Anthropic client (E19.1)

**Files:** Modify `config.go`; create `api/internal/llm/anthropic.go`; modify `main.go`.

- [ ] **Step 1: Config fields** — add to `Config` + loader:
```go
	AIBuildEnabled  bool   // envBool("AI_BUILD_ENABLED", false)
	AIBuildRequired bool   // envBool("AI_BUILD_REQUIRED", false)
	AIBuildModel    string // envStr("AI_BUILD_MODEL", "claude-sonnet-4-6")
	AIBuildDailyCap int    // envInt("AI_BUILD_DAILY_CAP", 50)
	AIBuildPerIPDay int    // envInt("AI_BUILD_PER_IP_DAILY", 3)
	AnthropicAPIKey string // envStr("ANTHROPIC_API_KEY", "")
```

- [ ] **Step 2: Client wrapper** — `api/internal/llm/anthropic.go`: a small interface `Planner interface { Plan(ctx, sys, user string) (raw string, inTok, outTok int, err error) }` with an Anthropic-backed impl (prompt caching on `sys`) and a `StubPlanner` for dev/tests.

- [ ] **Step 3: Fail-loud wiring** (`prod-fail-loud.md`) in `main.go`:
```go
if cfg.AIBuildEnabled && cfg.AIBuildRequired {
    if cfg.AnthropicAPIKey == "" { slog.Error("AI_BUILD_REQUIRED but ANTHROPIC_API_KEY missing"); os.Exit(1) }
}
```
Enabled-but-not-required + no key → `slog.Warn` + use `StubPlanner`. Disabled → onboarding routes 404.

- [ ] **Step 4: Build** — `cd api && go build ./...`.
- [ ] **Step 5: Commit** — `feat(aibuild): config + fail-loud Anthropic client wrapper`

---

## Task 4: Job create + status + worker skeleton (E19.1)

**Files:** Create `api/internal/aibuild/jobs.go`, `budget.go`, `worker.go`, tests; modify `main.go`.

- [ ] **Step 1: Failing tests** — `POST /onboarding/build`: no name or no link → 400; over per-IP limit → 429; over global cap → 429 (atomic). `GET /onboarding/build/{id}` returns status by the (unguessable) job id only. Feedback one-per-job.

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implement**
- `jobs.go`: `CreateBuildHandler` — validate `name` + ≥1 `link` (info-first → 400); hash IP (`ip_hash`); `CountRecentJobsByIP ≥ cap` → 429; `AdmitDailyBuild(cap)` no row → 429; `CreateBuildJob`; enqueue (signal the worker); return `{job_id}`. `StatusHandler` — `GetBuildJob`, expose status + (when ready) the prospect's preview token.
- `worker.go`: a small pool that loops `ClaimQueuedJob` (`FOR UPDATE SKIP LOCKED`) and runs `harvest → plan → build` (stubs for now, each a no-op advancing status), each stage in its own `context.WithTimeout` (`background-work.md`: harvest 20s, plan 60s, build minutes), errors → `status='failed'` + `error`.
- Routes (public, handler-level guards — document like `/promo/redeem`, `api-handler-checklist.md`): `r.Post("/onboarding/build", ...)`, `r.Get("/onboarding/build/{id}", ...)`, `r.Post("/onboarding/build/{id}/feedback", ...)`. These join the E16 public allowlist.

- [ ] **Step 4: Run → PASS**; **Step 5: Commit** — `feat(aibuild): job create + status + worker skeleton + budget guards`

---

## Task 5: SSRF-hardened harvester (E19.2)

**Files:** Create `api/internal/aibuild/harvest.go`, `harvest_test.go`.

- [ ] **Step 1: Failing SSRF matrix tests** — `Harvest(ctx, urls)` must reject/bound: `http://localhost`, `http://127.0.0.1`, `http://169.254.169.254`, `10.x`/`192.168.x` hosts, `file://`/`gopher://`, a public URL that 302s to an internal IP, an oversized body, a slow endpoint, and a DNS name resolving to a private IP. Use `httptest` servers + a stub resolver.

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implement** — a custom `http.Client` whose `DialContext` resolves the host and **rejects** loopback/private/link-local/ULA IPs at connect time (defeats DNS-rebinding); scheme allowlist; max redirects with re-check each hop; `MaxBytesReader` cap; per-request + total timeout; content-type check. Extraction reuses the Python heuristics (`<img>`/`srcset`/`data-src`/`og:image`/CSS-bg, rank by size, drop logos/icons/thumbs) → returns `[]Candidate{URL, W, H}` + page text. **No LLM here.**

- [ ] **Step 4: Run → PASS** — `cd api && go test ./internal/aibuild/ -run Harvest -v`.
- [ ] **Step 5: Commit** — `feat(aibuild): SSRF-hardened site harvester`

---

## Task 6: LLM planner (E19.3)

**Files:** Create `api/internal/aibuild/planner.go`, `planner_test.go`. **Load the `claude-api` skill.**

- [ ] **Step 1: Failing tests (mocked `Planner`)** — given harvested text + candidates, `BuildPlan(...)`:
  - produces a valid plan (tagline, bio, ≥1 collection with ≥1 image ref).
  - **rejects** a plan whose `*_ref` is out of range / not in the candidate set (job → failed, no fetch).
  - rejects malformed/oversized model output → graceful failed, never a panic.

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implement** — assemble the prompt: a static, **prompt-cached** system prompt = Render voice/brand + the strict build-plan JSON schema (images are *indices into the candidate list*); user message = intake + numbered candidate descriptors + harvested text. Call `Planner.Plan`. Parse + **validate every `*_ref` against the candidate set** (the SSRF-via-LLM guard) + schema + non-empty bio. Record `model`, token counts on the job.

- [ ] **Step 4: Run → PASS**; **Step 5: Commit** — `feat(aibuild): Sonnet planner + build-plan validation (refs ∈ candidates)`

---

## Task 7: Deterministic builder (E19.4) — needs E15.4

> **Do not start until E15.4 (`POST /admin/prospects`) exists** — reuse its prospect-creation + image re-upload machinery.

**Files:** Create `api/internal/aibuild/builder.go`, test.

- [ ] **Step 1: Failing tests** — `Build(plan, job)` creates an E15.4 prospect (`draft`, `user_id NULL`) + collections; for each selected candidate, downloads `source_url` → presign → PUT → confirm → `collection_images`; sets `prospect_id` on the job → `ready`. Idempotent: re-running for the same job/session doesn't duplicate.

- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement** — translate the validated plan into the E15.4 prospect-create call; image re-upload reuses the existing presign→PUT→confirm helper (the same one E15.4/the skill conversion uses); bounded background work; set preview + claim tokens (from E15.2/E15.4). Wire this into the worker's build stage (replacing the Task 4 stub).
- [ ] **Step 4: Run → PASS**; **Step 5: Commit** — `feat(aibuild): deterministic builder → E15.4 prospect`

---

## Task 8: Onboarding UI + feedback (E19.5)

**Files:** Create `api/internal/aibuild/feedback.go` (handler); web `/start` flow.

- [ ] **Step 1:** `CreateBuildFeedbackHandler` — `POST /onboarding/build/{id}/feedback {rating, liked?, changed?}`, one per job, scoped to the job handle (no cross-job access).
- [ ] **Step 2:** web `/start` (also the referral landing): intake form (name, links[], location, **consent-to-contact checkbox** — GDPR), submit → `{job_id}` → "building your page ~2 min ☕" polling `GET /onboarding/build/{id}` (harvesting → writing → assembling).
- [ ] **Step 3:** on `ready` reveal the page via the preview token ("every word and image is yours to change"); a **"How did we do?"** (1–5 + "what would you change?") posting feedback *before* edit; then the E15.4 claim CTA. On `failed`: graceful fallback to manual signup.
- [ ] **Step 4: Commit** — `feat(aibuild,web): onboarding intake + progress + reveal + feedback`

---

## Task 9: e2e canaries

**Files:** Create `e2e/api/ai-onboarding.test.ts` (run with `AI_BUILD_ENABLED=true`, `AI_BUILD_REQUIRED=false` so the stub planner runs deterministically).

- [ ] **Step 1: Tests**
- **Info-first:** `POST /onboarding/build` no name / no link → 400.
- **Per-IP limit:** exceed `AI_BUILD_PER_IP_DAILY` → 429.
- **Global cap race (protects spend):** fire `cap+5` concurrent builds via `Promise.all` → at most `cap` admitted, rest 429 (atomic `AdmitDailyBuild`).
- **Handle-scoping:** status/feedback for a random `job_id` → not enumerable; feedback one-per-job.
- **(when E19.4 lands) prospect isolation:** the built prospect is `draft`, absent from `/public/profiles`, viewable only via its preview token, claimable only via its claim token; re-build idempotent.
- **Fail-loud (config/boot test):** `AI_BUILD_ENABLED=true && AI_BUILD_REQUIRED=true` + no key → boot exits non-zero.

- [ ] **Step 2: Run** — `npx vitest run e2e/api/ai-onboarding.test.ts`.
- [ ] **Step 3: Commit** — `test(e2e): AI onboarding cost guards + handle-scoping + isolation`

> **SSRF matrix lives in Go unit tests (Task 5)** — it's faster and more thorough there than over HTTP.

---

## Self-Review

- **Spec coverage:** jobs/worker/status (T1,T2,T4) · config + fail-loud client (T3) · SSRF harvester (T5) · planner + ref-validation (T6) · builder → E15.4 (T7) · UI + feedback + consent (T8) · cost guards + isolation + fail-loud canaries (T9). ✅
- **Placeholders:** Task 7 explicitly gated on E15.4 (a real dependency, not a TODO); the `Planner` interface + `StubPlanner` make T6/T9 deterministic without live API calls.
- **Types:** `ai_build_jobs` columns, `AdmitDailyBuild`/`ClaimQueuedJob`/`UpdateBuildJobStage` names, the `Candidate{URL,W,H}` + build-plan `*_ref` contract, and the `Planner` interface are consistent across T2/T4/T5/T6/T7.

---

## Out of scope (this plan)

- Organiser AI-setup, conversational chat agent, Instagram import, auto-publish, the training pipeline itself, streaming UI, image generation (spec §Out-of-scope).
