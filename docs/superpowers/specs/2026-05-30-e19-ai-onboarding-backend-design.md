# E19 — AI Onboarding Backend (artist profile auto-build) — Design Spec

**Date:** 2026-05-30
**Status:** Draft
**Epic:** E19 (new)
**Scope:** When an artist first arrives (cold, or via an E20 referral link), they give us a name + a link or two, and within a couple of minutes we've **built them a profile** from their public work — bio in Render's voice, work grouped into collections, images re-hosted. They review it, tell us how we did, then claim it. The magic-feeling, friction-killing front door. **"AI plans, deterministic tools build"** — the LLM only does intake, copy, and structure; a deterministic pipeline does the fetching, uploading, and DB writes.
**v1 scope: artists only** (organiser AI-setup is a separate, later epic).

---

## Overview

This epic productises the `artist-preview-builder` skill into a self-serve, in-app flow. The skill is a human-operator workflow today; E19 turns its three intelligent steps (write the bio, group the work, pick the images) into a single bounded LLM call, and its mechanical steps (harvest images, re-upload, seed the DB) into deterministic Go.

The output is **not** a new bespoke artifact — it's an **unclaimed E15.4 prospect profile** (draft, `user_id NULL`) with a preview token (E15.2) and a claim token (E15.4). So E19 is "self-serve prospect creation, planned by Claude." A "yes" converts through the exact same claim flow the operator-built pages already use.

**The token economics (your core constraint):** the LLM never touches image bytes, never runs the upload dance, never sees the DB. It receives the harvested page text + a list of *candidate image descriptors* (URL + dimensions) and returns one **structured build-plan** (the `seed.json` shape). That's the whole inference cost — planning + copy. Everything expensive-but-dumb is deterministic. Prompt caching (per the `claude-api` skill) makes the static voice/brand/schema system prompt nearly free on repeat.

**The safety architecture is the same move:** because the LLM can only *select images from the harvested candidate set* (by index/URL, validated against the set before download), it cannot inject an arbitrary URL — closing SSRF-via-LLM and hallucinated-image holes in one design choice.

```
intake (name + links + consent)
   │  info-first gate · rate-limit · global budget cap
   ▼
ai_build_jobs row (queued) ──poll──► "building your page, ~2 min"
   │
   ▼  in-process worker (bounded ctx per stage)
 [1] HARVEST  (deterministic, SSRF-hardened)  → page text + image candidates
 [2] PLAN     (Claude, structured output)     → build-plan (seed.json shape)
 [3] BUILD    (deterministic)                 → E15.4 prospect + collections + re-uploaded images
   │
   ▼  job=ready → reveal the built page → "how did we do?" feedback → claim (E15.4)
```

**Dependencies:** E19 is gated on **E15** — specifically E15.1 (visibility), E15.2 (preview token), and E15.4 (prospect + claim). It cannot fully land before those. It also assumes E16's beta allowlist (the intake endpoint is *public*, like `/preview` and `/claim` — a prospect isn't a member yet).

---

## Child tickets (build order)

| # | Ticket | Depends on | Areas | Notes |
|---|--------|-----------|-------|-------|
| **E19.1** | Build-job model + worker + status API + Anthropic client wiring | E16 allowlist | api, db, e2e, **security** | `ai_build_jobs`, info-first create endpoint (rate-limited, budget-capped), goroutine worker pool stubbing the 3 stages, status polling, feature flag + fail-loud client (`prod-fail-loud.md`). |
| **E19.2** | SSRF-hardened site harvester | — | api, e2e, **security** | Go-native fetch of page text + image candidates with the full SSRF guard. Pure & independently testable; plugs into stage [1]. |
| **E19.3** | LLM planner (Claude, structured build-plan) | E19.2 *(fixtures ok)* | api, e2e | System prompt (voice/brand/schema, prompt-cached), input assembly, structured output, **plan validation** (images ∈ candidates; schema), model tiering, token budget. Tested against a mocked client. |
| **E19.4** | Deterministic page builder | **E15.4**, E19.1 | api, db, e2e, **security** | Execute a build-plan → E15.4 prospect + collections + image re-upload (download→presign→PUT→confirm), idempotent, bounded background work. |
| **E19.5** | Onboarding UI + feedback capture | E19.1, E19.4 | web, api, db, e2e | Intake form (name + links + consent), "building…" progress (poll), reveal, pre-edit feedback (`ai_build_feedback`). |

**Sequencing:** E19.1 (plumbing) and E19.2 (harvester) are independent — start both. E19.3 builds against E19.2's output (or fixtures) in parallel. E19.4 needs E15.4 + E19.1. E19.5 ties it together. Five disparate tickets, parallelisable across people.

---

## 1. Database

Migration numbers are placeholders — check the highest existing first.

### 1a. Build jobs (E19.1)

```sql
CREATE TABLE ai_build_jobs (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id    text        NOT NULL,                 -- anonymous client session (cookie/UUID), pre-account
    status        text        NOT NULL DEFAULT 'queued',-- queued|harvesting|planning|building|ready|failed
    intake        jsonb       NOT NULL,                 -- {name, links[], location?, consent_contact bool}
    harvested     jsonb,                                -- page text refs + image candidate descriptors
    plan          jsonb,                                -- the LLM build-plan (seed.json shape) — TRAINING DATA
    model         text,                                 -- e.g. 'claude-opus-4-8'
    input_tokens  int,
    output_tokens int,
    prospect_id   uuid        REFERENCES artist_profiles(id) ON DELETE SET NULL,  -- the built E15.4 prospect
    error         text,                                 -- failure reason when status='failed'
    referral_id   uuid,                                 -- set when entered via E20 referral link
    ip_hash       text        NOT NULL,                 -- hashed source IP for rate accounting (GDPR: hash, don't store raw)
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CHECK (status IN ('queued','harvesting','planning','building','ready','failed'))
);
CREATE INDEX idx_ai_build_jobs_status ON ai_build_jobs (status) WHERE status IN ('queued','harvesting','planning','building');
CREATE INDEX idx_ai_build_jobs_ip ON ai_build_jobs (ip_hash, created_at);
```

`plan`, `intake`, `harvested`, and token counts are the **training substrate** — kept (anonymisable) so we can periodically improve the model and, for consented contacts, follow up. Raw IP is never stored (only `ip_hash`), per the GDPR-clean stance in `CLAUDE.md`.

### 1b. Feedback (E19.5)

```sql
CREATE TABLE ai_build_feedback (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id      uuid        NOT NULL REFERENCES ai_build_jobs(id) ON DELETE CASCADE,
    rating      int,                                    -- 1..5 "how did we do"
    liked       text,
    changed     text,                                   -- "what would you change" — high-value training signal
    created_at  timestamptz NOT NULL DEFAULT now()
);
```

A second implicit training signal comes post-claim: diffing what the artist *edited* against what we generated. That's read from the existing profile edit history, no new table here.

### 1c. Global budget counter (E19.1)

A race-safe daily build counter so a spend cap is actually enforceable under concurrency:

```sql
CREATE TABLE ai_build_budget (
    day         date    PRIMARY KEY,
    count       int     NOT NULL DEFAULT 0
);
-- Atomic admit: returns a row only if under cap.
INSERT INTO ai_build_budget (day, count) VALUES (current_date, 1)
ON CONFLICT (day) DO UPDATE SET count = ai_build_budget.count + 1
WHERE ai_build_budget.count < $1            -- AI_BUILD_DAILY_CAP
RETURNING count;
```

No row returned → cap hit → `429` / waitlist. This is the hard ceiling on inference spend.

---

## 2. Config & client wiring (E19.1)

Per `prod-fail-loud.md`, the Anthropic client is an external service:

- `AI_BUILD_ENABLED bool` (default `false`) — master switch. When off, onboarding falls back to manual signup; the intake endpoints 404/redirect.
- `AI_BUILD_REQUIRED bool` — when `AI_BUILD_ENABLED && AI_BUILD_REQUIRED`, a missing/invalid `ANTHROPIC_API_KEY` → `os.Exit(1)` at boot (fail loud). When enabled-but-not-required (dev), a missing key logs `slog.Warn` and the planner stage uses a stub.
- `AI_BUILD_DAILY_CAP int`, `AI_BUILD_PER_IP_DAILY int`, plus model + token-budget envs.

Implementation uses the **`claude-api` skill** — prompt caching on the system prompt is mandatory (it's the same ~2k-token voice/brand/schema block every call). Model (locked 2026-05-30): **Sonnet** (`claude-sonnet-4-6`) for the plan/bio — strong copy at a cost that lets us run a higher daily cap for the same spend. The model id is an env var (`AI_BUILD_MODEL`) so an Opus arm can be A/B'd later without code change.

---

## 3. The build-plan contract (E19.3 ↔ E19.4)

The single interface between "AI plans" and "tools build". Shape mirrors the skill's `seed.json`, with the **critical difference that images are references into the harvested candidate set**, never free URLs:

```jsonc
{
  "artist":   { "tagline", "location?", "bio", "medium_tags[]", "stats[]",
                "hero_image_ref": <candidate index>, "avatar_ref": <candidate index|null> },
  "collections": [
    { "name", "description?", "image_refs": [<candidate index>, ...] }   // strongest-first
  ]
}
```

**Validation before build (E19.3 emits, E19.4 re-checks):**
- Every `*_ref` is a valid index into `harvested.candidates`. Any out-of-range / invented URL → reject the plan (job `failed`, fall back to manual). The LLM literally cannot smuggle a URL through.
- Schema-valid, non-empty bio, ≥1 collection with ≥1 image — else `failed`.
- Bio fact-safety is a *prompt* constraint (the skill's rule: never fabricate shows/clients/awards), reinforced by keeping the bio anchored to harvested text; we don't claim to verify facts, but we never invent image content and we surface "review before claiming" to the artist.

---

## 4. The harvester (E19.2) — SSRF is the whole job

Go-native fetch (not a subprocess of the Python script — the SSRF guard must live in one auditable place). Reuses the Python heuristics (rank `<img>`/`srcset`/`data-src`/`og:image`/CSS-bg by size, drop logos/icons/thumbnails) but every outbound request goes through a guard:

- **Scheme allowlist:** `http`/`https` only.
- **DNS-resolve then IP-block:** reject loopback (`127/8`, `::1`), private (`10/8`, `172.16/12`, `192.168/16`), link-local (`169.254/16` incl. the `169.254.169.254` cloud-metadata endpoint), and ULA. Re-check on **every redirect hop** (a public URL can 302 to an internal one).
- **Caps:** max redirects, max response bytes, per-request + total wall-clock timeout, max pages on crawl. Content-type check before treating a response as an image.
- Custom `http.Client` with a `DialContext` that enforces the IP block at connect time (defeats DNS-rebinding).

This ticket is pure and heavily unit/e2e tested — it's where a mistake becomes a server-side request forgery against our own infra.

---

## 5. API surface

The intake/build endpoints are **public but not auth-required** (a prospect has no account yet) — like `/preview/{token}` and `/promo/redeem`, the guards are *handler-level* (info-first + rate-limit + budget), not auth middleware. During beta they sit on the E16 public allowlist. Document this on the route registration line (`api-handler-checklist.md`).

- `POST /onboarding/build` `{ name, links[], location?, consent_contact }` *(public, rate-limited, info-first)* — validates name + ≥1 link present, checks per-IP + global budget atomically, creates the `ai_build_jobs` row, returns `{ job_id }`. No info → `400`. Over limit → `429`.
- `GET /onboarding/build/{job_id}` *(public, by job_id which is the unguessable handle)* — status + (when `ready`) the `preview_token` to view the built page. Only the holder of the `job_id` sees it.
- `POST /onboarding/build/{job_id}/feedback` `{ rating, liked?, changed? }` *(public)* — one feedback per job; tied to the job handle (no cross-job access).
- Claim is the **existing E15.4** `/claim/{claim_token}` flow — E19 doesn't add a claim endpoint, it produces a claim token.

Worker stages use bounded `context.WithTimeout` per `background-work.md` (harvest ~20s, plan ~60s, build minutes for image re-upload) — never a bare `context.Background()`, errors logged at the right level, no request context captured.

---

## 6. Frontend (web) — E19.5

- A `/start` (or referral-landing) intake: name, one-or-more links, location, and an explicit **"OK to contact me about my page" consent checkbox** (GDPR — drives the recontact list).
- Submit → "We're building your page — about two minutes ☕" with live status from polling `GET /onboarding/build/{job_id}`. Honest progress (harvesting → writing → assembling).
- On `ready`: reveal the built page via the preview token, framed as *theirs* ("Here's what we made — every word and image is yours to change").
- **Feedback before edit:** a light "How did we do?" (1–5 + "what would you change?") posting to the feedback endpoint — captured *before* they start editing so it's clean signal.
- Then the existing claim CTA. On `failed`: graceful fallback to manual signup, no dead end.
- Design system per `CLAUDE.md`. The reveal moment is the conversion — make it feel like magic.

---

## 7. Security & testing

Per `api-handler-checklist.md`, `prod-fail-loud.md`, `background-work.md`, and E15.4's prospect-isolation rules:

**SSRF matrix (E19.2) — the critical suite.** Submit/harvest links targeting: `localhost`, `127.0.0.1`, `169.254.169.254`, a `10.x`/`192.168.x` host, a non-http scheme (`file://`, `gopher://`), a public URL that **302-redirects to an internal IP**, an oversized response, a slow-loris endpoint, and a DNS name that resolves to a private IP. **Every one rejected/bounded**; none reaches our network. This is non-negotiable before E19 ships.

**LLM-output guard (E19.3).** A build-plan referencing an image index out of range, or (in a crafted fixture) a fabricated URL → plan rejected, job `failed`, no fetch attempted. Malformed/oversized model output → graceful `failed`, never a 500 or a partial profile.

**Cost guards (E19.1).** Info-first: `POST /onboarding/build` with no name or no link → `400`. Per-IP daily limit exceeded → `429`. **Global cap race:** fire `AI_BUILD_DAILY_CAP + 5` concurrent builds via `Promise.all` → at most `cap` admitted (the atomic `ON CONFLICT … WHERE count < cap` proves it), the rest `429`. This is the test that protects the bank account.

**Prospect isolation (E19.4, inherits E15.4).** The AI-built prospect is `draft`, not in `/public/profiles`, not fetchable by a random authed user, viewable only via its preview token; claimable only via its claim token. Re-running a build for the same session is idempotent (no duplicate prospects).

**Handle-scoping (no IDOR on jobs).** `GET`/feedback for a `job_id` you don't hold → not enumerable (the `job_id` UUID is the capability). Feedback is one-per-job and cannot read another job.

**Fail-loud (E19.1).** With `AI_BUILD_ENABLED=true && AI_BUILD_REQUIRED=true` and no API key → boot exits non-zero (canary test in the build pipeline / config test).

**Schema lockstep.** New tables only (no `users` change), but verify `ai_build_jobs` Scan counts after `task db:generate`.

---

## 8. Open decisions (for review — defaults chosen)

1. **Model.** **Locked 2026-05-30:** **Sonnet** (`claude-sonnet-4-6`) for the plan/bio, via `AI_BUILD_MODEL` env so it's swappable/A-B-able. Token budget capped per job.
2. **Global daily cap.** **Locked 2026-05-30:** **env-configurable** (`AI_BUILD_DAILY_CAP`), default 50, tuned at deploy — not a fixed spec number. Over-cap → waitlist capture, not a hard "no".
3. **Per-IP / per-session limits.** Default: **1 active build per session, 3/day per IP**. Tune.
4. **Consent-to-contact (GDPR).** Default: explicit opt-in checkbox at intake; the recontact list includes **only** opt-ins; raw IP never stored (hash only). Confirm this is the bar you want.
5. **Harvester: Go-native vs Python subprocess.** Default: **Go-native** so the SSRF guard is one auditable code path (the existing Python script has no SSRF guard and sandboxing a subprocess is harder). The Python script stays the operator/skill tool; E19 reimplements its heuristics in guarded Go.
6. **"Info-first" strictness.** Default (matches your note): no build without name + ≥1 link; the cold "we'll build it from just a name" path is **not** in v1 — we always require the artist to give us something first. Confirm.
7. **Referral entry (E20 seam).** Default: `POST /onboarding/build` accepts an optional `referral_code`; E19 stores `referral_id` and E20 owns the rewards. Just the seam here.

---

## Out of scope

- Organiser / festival AI-setup (different builder; separate later epic — decided).
- A full conversational chat agent / visitor Q&A widget (we chose plan-and-build, not converse-and-build).
- Consented Instagram Graph API import (a proper post-signup feature, per the skill's note) — v1 harvests the artist's *own* public site only.
- Auto-publishing. The AI builds a **draft** prospect; going public is still the artist's explicit act (E15.3) gated on pay/comp (E15.5).
- Fine-tuning / training pipeline itself. E19 *captures* the training substrate (`plan`, `intake`, `feedback`, edit-diffs); the training job is a separate future effort.
- Real-time streaming of the build to the UI. Polling is sufficient for a ~2-minute job.
- Image generation / enhancement. We re-host the artist's *real* work; we never synthesise images.
