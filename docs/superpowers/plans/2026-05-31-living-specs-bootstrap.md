# Living Specs Bootstrap — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish colocated living specs for all meaningful packages, path-triggered Claude rule loading, and CLAUDE.md updates to enforce the new methodology permanently.

**Architecture:** Each package gets a `<package>.spec.md` colocated in its directory. A minimal `.claude/rules/spec-<package>.md` stub with YAML `paths` frontmatter loads the spec automatically when Claude reads any file in that directory. One unconditional rule (`spec-maintenance.md`) instructs Claude to propose spec updates in-flight when code changes drift from the spec. CLAUDE.md documents the convention for future sessions.

**Tech Stack:** Markdown, YAML frontmatter (Claude Code path-scoped rules), no code changes.

---

## Task 1: CLAUDE.md update + spec-maintenance rule

**Files:**
- Modify: `CLAUDE.md`
- Create: `.claude/rules/spec-maintenance.md`

- [ ] **Step 1: Add the Living Specs section to CLAUDE.md**

Open `CLAUDE.md` and append this section before the final `## Mission Constraint` heading:

```markdown
## Living Specs

Every meaningful package has a colocated `<package>.spec.md` describing its contract, boundaries, key decisions, invariants, and AI context. A `.claude/rules/spec-<package>.md` stub loads the spec automatically when Claude enters that directory.

### Spec sections (fixed headings — referenced by rules and skills)

| Section | Purpose |
|---------|---------|
| `## Contract` | What the package promises to do — public surface, inputs/outputs, guarantees |
| `## Boundaries` | What it deliberately does NOT do — prevents misdirected work |
| `## Key Decisions` | Locked-in design choices with rationale; what was rejected and why |
| `## Invariants` | Rules the code must always maintain; things that if broken break callers or security |
| `## AI Context` | What to know before touching this package — gotchas, read order, cross-file deps |
| `## Changelog` | Brief log of spec updates: `YYYY-MM-DD — description` |

### Obligations when working in a package

1. **Before touching code**: the spec is already in context (loaded by the path rule). Use it.
2. **After changing behaviour**: if your change adds, removes, or alters the package's observable behaviour, propose a spec update inline — not as a separate step, not in a follow-up PR.
3. **New package**: write the spec before or alongside the first PR. Add the rule stub too.

### Packages with specs

| Package | Spec |
|---------|------|
| `api/internal/auth/` | `auth.spec.md` |
| `api/internal/billing/` | `billing.spec.md` |
| `api/internal/festival/` | `festival.spec.md` |
| `api/internal/artist/` | `artist.spec.md` |
| `api/internal/beta/` | `beta.spec.md` |
| `api/internal/admin/` | `admin.spec.md` |
| `api/internal/analytics/` | `analytics.spec.md` |
| `api/internal/image/` | `image.spec.md` |
| `api/internal/email/` | `email.spec.md` |
| `api/internal/me/` | `me.spec.md` |
| `api/cmd/api/` | `api.spec.md` |
| `db/` | `db.spec.md` |
| `web/src/app/(artist)/` | `artist.spec.md` |
| `web/src/app/dashboard/` | `dashboard.spec.md` |
| `web/src/app/(public)/` | `public.spec.md` |
| `web/src/lib/` | `lib.spec.md` |

### Packages without specs (thin/generated — not worth maintaining)

`sqlcdb` (auto-generated), `config` (env vars only), `httperr`, `health`, `metrics`, `middleware`, `testutil`, `openapi`.
```

- [ ] **Step 2: Write `.claude/rules/spec-maintenance.md`**

```markdown
# Spec Maintenance

This rule has no `paths` frontmatter — it loads every session.

## Before touching any package

If the package has a `*.spec.md` file (see the Living Specs table in CLAUDE.md), it is
already loaded in context via its path-scoped rule. Read it before making changes.

## After making any change that alters behaviour

If your change adds, removes, or modifies:
- An endpoint's request/response shape
- A function's contract or callers' guarantees
- A security invariant
- A design decision that affects future work

Then propose a spec update as part of the same work. Show the before/after for the
affected section(s) and get user approval before writing it.

Do NOT defer spec updates to a follow-up PR. Do NOT skip them because the change
"feels small". Invariants and AI Context sections go stale fastest — check those first.

## Creating a spec for a new package

Use this template:

```markdown
# <Package> Spec
**Path:** `path/to/package/`
**Last updated:** YYYY-MM-DD

## Contract
## Boundaries
## Key Decisions
## Invariants
## AI Context
## Changelog
YYYY-MM-DD — initial spec
```

After writing the spec, create `.claude/rules/spec-<package>.md`:

```markdown
---
paths:
  - "path/to/package/**"
---

@path/to/package/package.spec.md
```

Then add the package to the Living Specs table in CLAUDE.md.
```

- [ ] **Step 3: Verify the files look right**

```bash
grep -c "Living Specs" CLAUDE.md
# Expected: 1

head -5 .claude/rules/spec-maintenance.md
# Expected: # Spec Maintenance
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md .claude/rules/spec-maintenance.md
git commit -m "feat(specs): add Living Specs methodology to CLAUDE.md and spec-maintenance rule"
```

---

## Task 2: auth spec

**Files:**
- Create: `api/internal/auth/auth.spec.md`
- Create: `.claude/rules/spec-auth.md`

- [ ] **Step 1: Write `api/internal/auth/auth.spec.md`**

```markdown
# auth Spec
**Path:** `api/internal/auth/`
**Last updated:** 2026-05-31

## Contract
- Issues and verifies HS256 JWTs (7-day TTL for full sessions, 5-min for `mfa_pending`)
- `Middleware(pool, secret)` establishes sessions from cookie (`session`) or `Authorization: Bearer` header; injects `Principal` into context
- `auth.User(ctx)` lets handlers retrieve the authenticated principal
- Handles: signup, login, password reset (forgot + reset), TOTP MFA (enrol/confirm/verify), Google OAuth, Apple OAuth
- Rate-limits login, forgot-password, and MFA verify at 5/min per IP (configurable for CI)

## Boundaries
- Does NOT decide what users can do after authentication — that is `admin.RequireAdmin`, `billing.RequirePlan`, `beta.Gate`, or handler-level entitlement checks
- Does NOT store session state — revocation works via `session_version` counter on the user row, not a session table
- Does NOT send emails directly — hands off to the `auth.EmailSender` interface; production uses `email.Sender`, local dev uses `auth.NoopMailer{}`

## Key Decisions
- **HS256 not RS256**: symmetric signing keeps key management simple at this scale; no public key distribution needed
- **7-day TTL + session_version**: tokens are long-lived for UX but revocable via a counter bump (password reset, explicit logout); the middleware checks the counter on every authenticated request (one indexed PK lookup)
- **`mfa_pending` scope token**: login with MFA enabled issues a short-lived scoped token rather than blocking or returning a partial response — the client exchanges it via `POST /auth/mfa/verify`. `mfa_pending` tokens never get a principal attached in middleware.
- **OAuth `email_verified` enforcement**: Google: `email_verified` must be `true` (bool). Apple: `email_verified` must be `"true"` (string) and may be absent for returning users — only enforce when the email claim is non-empty
- **Timing-attack mitigation on forgot-password**: handler returns 202 immediately; all DB work happens in a detached goroutine so response time doesn't leak whether the email exists
- **Rate limiter reads `r.RemoteAddr` only**: `chi.RealIP` middleware (registered in `main.go`) already rewrites `RemoteAddr` from XFF — the limiter must never read XFF itself or the two will diverge

## Invariants
- Every call to `IssueToken` MUST pass `user.SessionVersion` — there is no zero default; callers must have fetched the user row
- `Middleware` MUST NOT attach a principal for `mfa_pending`-scoped tokens — those holders must only reach `POST /auth/mfa/verify`
- The JWT's `sv` claim MUST match `users.session_version` in the DB before a principal is attached — this is what makes password reset invalidate outstanding sessions
- `is_admin` in issued tokens is informational only — `admin.RequireAdmin` re-reads from DB to guard against stale tokens after demotion (TTL up to 7 days)
- OAuth inserts MUST use `ON CONFLICT (oauth_provider, oauth_subject) WHERE oauth_provider IS NOT NULL DO UPDATE SET oauth_provider = EXCLUDED.oauth_provider RETURNING *` — bare INSERT and `DO NOTHING` both cause races or empty-scan panics

## AI Context
- `jwt.go`: `IssueToken`, `IssueMFAPendingToken`, `ParseToken`, `Claims` struct — start here to understand the token shape
- `middleware.go`: session establishment — reads cookie/Bearer, validates `session_version` against DB, attaches `Principal`
- `ctx.go`: `Principal` type, `User(ctx)`, `WithUserForTest` (used in every unit test to bypass the middleware) — also defines `EmailSender` interface
- `ratelimit.go`: token bucket per IP — `ConfigureRateLimit(perMin, burst)` is called from `main.go` to loosen limits for CI
- `reset.go`: forgot-password / reset-password — canonical example of the detached goroutine pattern (see `.claude/rules/background-work.md`)
- `oauth.go`: Google + Apple callbacks — `email_verified` check lives here; easy to accidentally remove when adding a new provider
- `totp.go`: TOTP enrol/confirm/verify — `mfa_pending` token exchange in `TOTPVerifyHandler`
- Unit tests inject context via `auth.WithUserForTest()` — this bypasses middleware, so `task api:test` passing does NOT confirm route wiring (see `.claude/rules/api-handler-checklist.md`)

## Changelog
2026-05-31 — initial spec
```

- [ ] **Step 2: Write `.claude/rules/spec-auth.md`**

```markdown
---
paths:
  - "api/internal/auth/**"
---

@api/internal/auth/auth.spec.md
```

- [ ] **Step 3: Verify**

```bash
cat .claude/rules/spec-auth.md
# Expected: frontmatter + @-reference

head -3 api/internal/auth/auth.spec.md
# Expected: # auth Spec
```

- [ ] **Step 4: Commit**

```bash
git add api/internal/auth/auth.spec.md .claude/rules/spec-auth.md
git commit -m "feat(specs): add auth package spec"
```

---

## Task 3: billing spec

**Files:**
- Create: `api/internal/billing/billing.spec.md`
- Create: `.claude/rules/spec-billing.md`

- [ ] **Step 1: Write `api/internal/billing/billing.spec.md`**

```markdown
# billing Spec
**Path:** `api/internal/billing/`
**Last updated:** 2026-05-31

## Contract
- Creates Stripe Checkout Sessions for artist subscriptions (basic/pro, monthly/annual) via `ArtistCheckoutHandler`
- Creates Stripe Checkout Sessions for organiser setup and festival activation via `OrganiserCheckoutHandler`
- Opens Stripe billing portal sessions via `ArtistPortalHandler`
- Handles Stripe webhook events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
- `billing.CanPublish(ctx, pool, userUUID) (bool, error)` — returns true when the user has a qualifying artist entitlement (paid subscription or access grant)
- `billing.RequirePlan(plan string)` middleware — gates a route to users with an active subscription or grant for `plan`

## Boundaries
- Does NOT manage admin access grants directly — `admin.GrantHandler` creates rows in `access_grants`; billing reads them
- Does NOT manage promo code redemption — that is `admin.RedeemPromoHandler`
- Does NOT handle refunds — managed in the Stripe dashboard
- Does NOT decide what product features each plan unlocks beyond access gating

## Key Decisions
- **Subscriptions AND grants**: `CanPublish` and `RequirePlan` check both `subscriptions` and `access_grants` tables so admin comps and promo codes work identically to paid plans without special-casing
- **`RequirePlan` middleware vs handler-level check**: use middleware when the entire route is plan-gated; call `CanPublish` directly in handlers when only part of the response is gated (e.g. analytics window size)
- **Festival activation = one-off charge**: `FestivalActivation` price is a single payment (`mode: payment`), not a subscription; festivals also have an annual listing subscription (`FestivalAnnual`)
- **Stripe customer creation is get-or-create**: `getOrCreateStripeCustomer` looks up `users.stripe_customer_id` before calling the Stripe API; concurrent requests must not create two customers — the DB unique constraint on `stripe_customer_id` is the hard guard
- **Webhook events drive subscription state**: the DB subscription row is only created/updated from webhook events, never from the checkout response — this handles async payment methods (BACS, bank transfers)

## Invariants
- `RequirePlan` MUST read entitlement from DB — never from JWT claims — so downgrades/upgrades take effect on the next request
- Webhook handlers MUST verify the Stripe signature via `stripe.ConstructEvent` before processing — return 400 on failure
- Webhook handlers MUST be idempotent — Stripe replays events on timeout/failure
- Plan names in the DB are: `artist_basic`, `artist_pro`, `festival_annual` — never Stripe Price IDs, never display names
- `subscriptions.stripe_subscription_id` has a unique constraint — INSERT must use `ON CONFLICT DO UPDATE` to handle replayed `checkout.session.completed` events

## AI Context
- `stripe.go`: `NewStripeClient`, `Prices` struct, `PlanFromPriceID`, `IntervalFromPriceID` — utility mapping between Stripe price IDs and internal plan names
- `artist.go`: `ArtistCheckoutHandler`, `ArtistPortalHandler` — artist subscription flows
- `organiser.go`: `OrganiserCheckoutHandler` — organiser/festival billing flows
- `webhook.go`: all Stripe webhook handling — idempotency logic and subscription state transitions live here
- `middleware.go`: `RequirePlan(plan)` — route-level billing gate
- `entitlement.go`: `CanPublish` — the handler-level entitlement check used when you need a bool not a middleware
- `festival.go`: festival billing helpers
- `Prices` is constructed in `api/cmd/api/main.go` from env vars — if a price ID is blank, `PlanFromPriceID` returns `"unknown"` and the checkout will fail with a Stripe 400

## Changelog
2026-05-31 — initial spec
```

- [ ] **Step 2: Write `.claude/rules/spec-billing.md`**

```markdown
---
paths:
  - "api/internal/billing/**"
---

@api/internal/billing/billing.spec.md
```

- [ ] **Step 3: Commit**

```bash
git add api/internal/billing/billing.spec.md .claude/rules/spec-billing.md
git commit -m "feat(specs): add billing package spec"
```

---

## Task 4: festival spec

**Files:**
- Create: `api/internal/festival/festival.spec.md`
- Create: `.claude/rules/spec-festival.md`

- [ ] **Step 1: Write `api/internal/festival/festival.spec.md`**

```markdown
# festival Spec
**Path:** `api/internal/festival/`
**Last updated:** 2026-05-31

## Contract
- CRUD for festivals (organisers only): create, get, patch, list-mine
- Public read: `ListPublicHandler` (status `open` or `live`), `GetMapDataHandler` (slug, status `live`)
- Application lifecycle: submit, patch, withdraw, waitlist, status transitions
- Spot management: organiser assigns artists to map spots
- Review workflow: panellist accounts, rubric scoring, anonymous review, multi-round selection, notes, reorder
- Appearance tracking: maps confirmed applications to artist profiles for public display
- Form builder: organiser defines per-festival application questions; artist submits answers

## Boundaries
- Does NOT handle payments for festival activation — that is `billing.OrganiserCheckoutHandler`
- Does NOT send notification emails directly — uses a passed-in `auth.EmailSender`
- Does NOT own artist profiles or collections — reads them via sqlcdb queries

## Key Decisions
- **Status machine for festivals**: `draft` → `open` → `live` → `closed`. Public endpoints gate on `open` OR `live` — artists must see `open` festivals to apply; the map only renders `live` ones
- **Status machine for applications**: `draft` → `submitted` → `under_review` → `accepted` / `rejected` / `waitlisted` / `withdrawn`
- **Spots are independent of applications**: a spot can be pre-created without an application; `spots.application_id` is nullable
- **Route registration order matters**: literal sub-paths (e.g. `/applications/reorder`) MUST be registered before parameterised routes (e.g. `/applications/{applicationID}`) in chi — see api-handler-checklist rule
- **Reviewer anonymity**: panellist usernames in review UI are hidden from organisers until the round closes — stored in DB, masked in response

## Invariants
- Public `GetHandler` returns 404 for any festival with status NOT IN (`open`, `live`) — anonymous callers must never see `draft` or `closed` festivals
- An artist may only have one active (non-withdrawn) application per festival
- `spots.application_id` uniqueness: a confirmed application can only be assigned to one spot
- Reorder endpoints (`/applications/reorder`, `/spots/reorder`) MUST be registered before their `/{id}` siblings in chi

## AI Context
- `festival.go`: festival CRUD — `GetHandler` contains the public-status gate
- `application.go`: application submit/patch/status + most of the review lifecycle
- `review.go`, `score.go`: reviewer scoring and rubric logic
- `reviewers.go`: panellist account management
- `spots.go`: map spot assignment
- `form.go`: dynamic application form builder
- `map.go`: `GetMapDataHandler` — public endpoint returning spot locations + artist previews for the Leaflet map
- `appearances.go`: `POST /appearances` wires confirmed application → artist profile for public display
- `access.go`: the organiser-ownership check — used by most handlers to confirm the caller owns the festival
- `testhelpers_test.go`: shared test helpers (festival/application setup) — check this before writing new tests to avoid duplication

## Changelog
2026-05-31 — initial spec
```

- [ ] **Step 2: Write `.claude/rules/spec-festival.md`**

```markdown
---
paths:
  - "api/internal/festival/**"
---

@api/internal/festival/festival.spec.md
```

- [ ] **Step 3: Commit**

```bash
git add api/internal/festival/festival.spec.md .claude/rules/spec-festival.md
git commit -m "feat(specs): add festival package spec"
```

---

## Task 5: artist spec

**Files:**
- Create: `api/internal/artist/artist.spec.md`
- Create: `.claude/rules/spec-artist.md`

- [ ] **Step 1: Write `api/internal/artist/artist.spec.md`**

```markdown
# artist Spec
**Path:** `api/internal/artist/`
**Last updated:** 2026-05-31

## Contract
- CRUD for artist profiles: create, get-mine, update, public-get (by profile ID)
- Collections: create, get, patch, reorder, delete
- Collection images: add, reorder, delete, set-cover
- QR code: generate branded PNG for the artist's public profile URL
- Public listing: `ListPublicProfilesHandler` — returns only `visibility: public` profiles
- Visibility gating: `GET /profiles/{profileID}` — 404 for non-public profiles
- Preview sharing: `GET /profiles/preview/{token}` — returns any profile (draft or public) matching the `preview_token`; no auth required; token is the secret
- Preview token rotation: `POST /profiles/me/preview-token/rotate` — generates a new token, invalidating any previously shared preview links; owner-only

## Boundaries
- Does NOT own subscription/entitlement logic — calls `billing.CanPublish` to check publish eligibility
- Does NOT own analytics events — fires profile-view events via the analytics package on public profile reads
- Does NOT own festival applications — the festival package manages those

## Key Decisions
- **One profile per user**: `CreateProfileHandler` enforces uniqueness via DB constraint; calling it twice returns 409
- **Visibility states**: `draft` (owner only) and `public` (world-readable). No intermediate state.
- **Publish gate**: `PATCH /profiles/me` with `visibility: public` calls `billing.CanPublish` — fails with 403 if the user has no active subscription or grant
- **Collections have `display_order`**: default `0`; ordered by `(display_order, created_at)`. Tests that assert creation order MUST call the reorder endpoint first — two rows created in the same millisecond under parallel load have a non-deterministic natural order
- **Images have a two-step flow**: presign (→ `image` package), PUT to MinIO (→ client), confirm (→ `image` package), then attach to collection. The `artist` package only handles attach + set-cover
- **Downgrade behaviour**: data exceeding a plan limit is locked (not deleted) when an artist downgrades
- **Preview token is the secret**: opaque UUID-derived string stored on the profile row; not a JWT, carries no claims. Sharing the URL grants access. Rotating revokes all previously shared links immediately.
- **`preview_token` omitted from public responses**: `toProfileResponse(p, public=true)` sets `PreviewToken = nil`; only the rotate response (`public=false`) returns it so the owner can copy the new link

## Invariants
- Public profile read MUST return 404 (not 403) for non-public profiles — information about private profiles must not leak
- `preview_token` MUST NOT appear in any response where `toProfileResponse` is called with `public=true` — the token is the access credential
- QR code encodes the public profile URL — always `/p/{profile_id}`, never a route that might change
- `display_order` must never be assumed unique — ties are broken by `created_at`, and two rows can share the same millisecond
- `/profiles/me` and `/profiles/preview/{token}` are literal sub-paths — they MUST remain registered before `/{profileID}` in `main.go`

## AI Context
- `profile.go`: profile CRUD + visibility management + publish gate + `RotatePreviewTokenHandler` + `PreviewByTokenHandler`
- `collection.go`: collection CRUD + reorder
- `collection_image.go`: image attach/reorder/delete/set-cover — reads `s3_key` from the confirmed image record
- `qr.go`: QR code generation — uses `github.com/skip2/go-qrcode`; output is PNG bytes returned directly
- `errors.go`: package-level sentinel errors used across handlers
- `testhelpers_test.go`: shared helpers for creating profiles, collections, images in tests — check before writing new test setup
- Analytics: `profile.go` fires a `profile_view` event on public reads — this calls into the analytics package; do not remove it accidentally when refactoring the public GET handler

## Changelog
2026-05-31 — initial spec
```

- [ ] **Step 2: Write `.claude/rules/spec-artist.md`**

```markdown
---
paths:
  - "api/internal/artist/**"
---

@api/internal/artist/artist.spec.md
```

- [ ] **Step 3: Commit**

```bash
git add api/internal/artist/artist.spec.md .claude/rules/spec-artist.md
git commit -m "feat(specs): add artist package spec"
```

---

## Task 6: beta spec

**Files:**
- Create: `api/internal/beta/beta.spec.md`
- Create: `.claude/rules/spec-beta.md`

- [ ] **Step 1: Write `api/internal/beta/beta.spec.md`**

```markdown
# beta Spec
**Path:** `api/internal/beta/`
**Last updated:** 2026-05-31

## Contract
- `beta.Gate(cfg, pool)` middleware: when `cfg.BetaMode = true`, rejects authenticated non-beta users with 403; passes through anonymous requests (downstream handlers return 401)
- `beta.BetaStatusHandler(cfg)` — public endpoint `GET /public/beta-status`, returns `{"beta_mode": bool}`
- `beta.WaitlistHandler(pool)` — rate-limited public endpoint `POST /waitlist`, stores email in `beta_waitlist` table
- `beta.HandlersForAdmin(pool)` — admin endpoints to grant/revoke beta membership and list the waitlist

## Boundaries
- Does NOT own beta invite emails — those are handled by the admin workflow externally
- Does NOT gate the `GET /public/*` routes or the Stripe webhook — those are intentionally outside the beta gate in `main.go`

## Key Decisions
- **`BetaMode = false` is a no-op passthrough**: the gate compiles away cleanly at launch; removing it from `main.go` is not required to exit beta
- **`is_beta` is read live from DB**: same pattern as `is_admin` in RequireAdmin — never trust the JWT claim; membership changes take effect on the next request
- **Anonymous requests pass through**: the gate intentionally does not block unauthenticated requests — this allows public routes and the signup/login flow to work during beta without special-casing

## Invariants
- `Gate` MUST pass anonymous requests through (no principal = pass through, not 401/403) — auth is downstream
- `is_beta` MUST be read from the DB user row, not from the JWT — the JWT has no `is_beta` claim

## AI Context
- `gate.go`: the `Gate` middleware — the `!cfg.BetaMode` short-circuit is the launch exit path
- `handlers.go`: waitlist signup + admin handlers
- `helpers.go`: `pgUUIDFromString` utility (package-local copy — each package maintains its own to avoid a shared utils package)
- The beta gate sits inside the outer authenticated route group in `main.go` but wraps everything including routes that don't require auth — this is deliberate

## Changelog
2026-05-31 — initial spec
```

- [ ] **Step 2: Write `.claude/rules/spec-beta.md`**

```markdown
---
paths:
  - "api/internal/beta/**"
---

@api/internal/beta/beta.spec.md
```

- [ ] **Step 3: Commit**

```bash
git add api/internal/beta/beta.spec.md .claude/rules/spec-beta.md
git commit -m "feat(specs): add beta package spec"
```

---

## Task 7: admin spec

**Files:**
- Create: `api/internal/admin/admin.spec.md`
- Create: `.claude/rules/spec-admin.md`

- [ ] **Step 1: Write `api/internal/admin/admin.spec.md`**

```markdown
# admin Spec
**Path:** `api/internal/admin/`
**Last updated:** 2026-05-31

## Contract
- `admin.RequireAdmin(pool)` middleware: gates routes to authenticated admin users who also have MFA enrolled; returns 401 (no principal), 403 (not admin), or 403 (MFA not enrolled)
- User management: list users, get user, set admin flag, set beta flag
- Access grants: create/revoke plan grants for users (comps, overrides)
- Promo codes: create codes, `RedeemPromoHandler` (rate-limited, handler-level auth check)
- Promo `RedeemPromoHandler` is in the rate-limited group but NOT the admin-required group — it is the public redemption endpoint; auth check is inside the handler

## Boundaries
- Does NOT manage festival content — organisers do that via the festival package
- Does NOT manage Stripe subscriptions — billing package owns those; grants are a separate DB-only mechanism

## Key Decisions
- **`RequireAdmin` re-reads `is_admin` from DB**: JWT's `is_admin` claim can be stale after demotion (TTL up to 7 days) — the middleware fetches the live user row and checks `user.IsAdmin`, NOT `principal.IsAdmin`
- **MFA required for admin**: `RequireAdmin` also verifies `user.MfaEnabled` — admin accounts without MFA cannot access any admin route, even with a valid admin JWT
- **Promo redemption is public but auth-gated at handler level**: `RedeemPromoHandler` is registered in the rate-limited group (not the admin group) so artists can redeem codes; the handler calls `auth.User(ctx)` to get the redeemer's identity
- **No `IncrementSessionVersion` on demotion**: demoting an admin does not revoke their session — the live DB check on every request is sufficient and avoids requiring every demotion path to remember to call it

## Invariants
- `RequireAdmin` MUST read `is_admin` from the live DB row — never from `principal.IsAdmin`
- `RequireAdmin` MUST also check `user.MfaEnabled` — admin without MFA is always 403
- Every new admin route group MUST have an unauthenticated e2e probe confirming 401 (see api-handler-checklist rule)

## AI Context
- `middleware.go`: `RequireAdmin` — the DB re-read pattern is the key thing; see auth-changes rule for the security rationale
- `users.go`: user management handlers
- `grants.go`: `GrantHandler`, `RevokeGrantHandler` — creates rows in `access_grants` which billing reads via `CanPublish`/`RequirePlan`
- `promo.go`: promo code CRUD + `RedeemPromoHandler` — note the dual registration (rate-limited group, not admin group) for the redemption endpoint
- `helpers.go`: `pgUUIDFromString` package-local utility

## Changelog
2026-05-31 — initial spec
```

- [ ] **Step 2: Write `.claude/rules/spec-admin.md`**

```markdown
---
paths:
  - "api/internal/admin/**"
---

@api/internal/admin/admin.spec.md
```

- [ ] **Step 3: Commit**

```bash
git add api/internal/admin/admin.spec.md .claude/rules/spec-admin.md
git commit -m "feat(specs): add admin package spec"
```

---

## Task 8: analytics spec

**Files:**
- Create: `api/internal/analytics/analytics.spec.md`
- Create: `.claude/rules/spec-analytics.md`

- [ ] **Step 1: Write `api/internal/analytics/analytics.spec.md`**

```markdown
# analytics Spec
**Path:** `api/internal/analytics/`
**Last updated:** 2026-05-31

## Contract
- `analytics.RecordEvent(ctx, pool, profileID, eventType)` — fire-and-forget: records a `profile_view`, `qr_scan`, or `link_click` event row
- `GET /profiles/me/analytics` — returns `AnalyticsResponse` with counts and `window_days` (90 for free, 730 for pro)
- `POST /profiles/me/links/:linkType/click` — records a link click event for the given social link type

## Boundaries
- Does NOT expose individual user tracking — all data is aggregated by profile; no user IDs are stored against events
- Does NOT gate access by plan — both free and pro users can read their analytics; the window size varies
- GDPR-clean by design: no PII in event rows

## Key Decisions
- **Aggregated only**: event rows store `profile_id` and `event_type` with a timestamp — no user ID, no IP, no device fingerprint
- **Window gating by plan**: free tier gets 90 days, pro gets 730 days — the window is applied at query time, not at write time
- **`hasPro` mirrors `billing.RequirePlan` without blocking**: analytics uses its own `hasPro` helper (not the middleware) so it can return data with a smaller window rather than 403

## Invariants
- Event rows MUST NOT store user IDs or any PII — GDPR compliance depends on this
- `window_days` in the response MUST reflect the caller's actual plan tier — free callers must not receive 730-day data

## AI Context
- `handler.go`: `AnalyticsHandler` (GET) + `LinkClickHandler` (POST) + `hasPro` helper
- `analytics.go`: `RecordEvent` — the write path; called from `artist.profile.go` on public GET and from `LinkClickHandler`
- The `hasPro` function in this package duplicates logic from `billing` — this is intentional to avoid a circular import (billing → analytics would create a cycle)

## Changelog
2026-05-31 — initial spec
```

- [ ] **Step 2: Write `.claude/rules/spec-analytics.md`**

```markdown
---
paths:
  - "api/internal/analytics/**"
---

@api/internal/analytics/analytics.spec.md
```

- [ ] **Step 3: Commit**

```bash
git add api/internal/analytics/analytics.spec.md .claude/rules/spec-analytics.md
git commit -m "feat(specs): add analytics package spec"
```

---

## Task 9: image spec

**Files:**
- Create: `api/internal/image/image.spec.md`
- Create: `.claude/rules/spec-image.md`

- [ ] **Step 1: Write `api/internal/image/image.spec.md`**

```markdown
# image Spec
**Path:** `api/internal/image/`
**Last updated:** 2026-05-31

## Contract
- `POST /images/presign` → returns `{ uploadUrl, s3Key }` — presigned MinIO PUT URL valid for 15 minutes; auth required
- `POST /images/confirm` → writes a row to the `images` table with `s3_key`, `cdn_url`, `content_type`; returns the image record; auth required
- `url.go`: `CDNUrl(cdnBase, s3Key)` utility — constructs the public CDN URL from a base and key

## Boundaries
- Does NOT attach images to collections or profiles — that is the `artist` package (`collection_image.go`)
- Does NOT delete images from MinIO — images are retained; the artist package manages collection attachment/detachment

## Key Decisions
- **Two MinIO clients in `main.go`**: `mc` (internal, `minio:9000`) is used by `ConfirmHandler` for bucket operations; `mcPublic` (public-facing, `localhost:9000` in dev / CDN in prod) is used by `PresignHandler` so the presigned URL's Host matches what the browser sends. Mixing these up causes 403s on the S3 PUT.
- **`Region: "us-east-1"` on `mcPublic` is non-negotiable**: without it, `minio-go` calls `GetBucketLocation` before presigning — that network call uses the public endpoint which is unreachable from inside the API container → 500. Setting the region skips the call.
- **15-minute presign TTL**: long enough for a slow upload; short enough to limit exposure if a URL leaks
- **Accepted content types**: `image/jpeg`, `image/png`, `image/gif`, `image/webp` — return 400 for anything else

## Invariants
- `PresignHandler` MUST use `mcPublic` (not `mc`) — the signature must match the Host header the browser will send
- `ConfirmHandler` MUST use `mc` (not `mcPublic`) — bucket operations from inside the container use the internal network endpoint
- The s3 key passed to `ConfirmHandler` MUST be a key that was returned by a prior `PresignHandler` call — no arbitrary key injection

## AI Context
- `presign.go`: `PresignHandler` — uses `mcPublic`; the 403-on-PUT root cause is almost always using `mc` here by mistake
- `confirm.go`: `ConfirmHandler` — uses `mc`; writes the `images` row; returns the CDN URL constructed via `CDNUrl`
- `url.go`: `CDNUrl` utility
- The dual-client pattern and `Region: "us-east-1"` are documented in `.claude/rules/e2e-debugging.md` under "MinIO PUT returns 403"

## Changelog
2026-05-31 — initial spec
```

- [ ] **Step 2: Write `.claude/rules/spec-image.md`**

```markdown
---
paths:
  - "api/internal/image/**"
---

@api/internal/image/image.spec.md
```

- [ ] **Step 3: Commit**

```bash
git add api/internal/image/image.spec.md .claude/rules/spec-image.md
git commit -m "feat(specs): add image package spec"
```

---

## Task 10: email + me specs

**Files:**
- Create: `api/internal/email/email.spec.md`
- Create: `.claude/rules/spec-email.md`
- Create: `api/internal/me/me.spec.md`
- Create: `.claude/rules/spec-me.md`

- [ ] **Step 1: Write `api/internal/email/email.spec.md`**

```markdown
# email Spec
**Path:** `api/internal/email/`
**Last updated:** 2026-05-31

## Contract
- `email.NewSender(ctx, region, fromAddr) (*Sender, error)` — initialises an SES v2 client
- `(*Sender).Send(ctx, to, subject, bodyHTML string) error` — sends a single transactional email via AWS SES v2
- Implements the `auth.EmailSender` interface (defined in `api/internal/auth/ctx.go`)

## Boundaries
- Does NOT template emails — callers (auth handlers) construct the HTML body
- Does NOT queue or batch — every call is a synchronous single send
- Does NOT have a fallback or retry — callers wrap in a goroutine with timeout if fire-and-forget is needed

## Key Decisions
- **SES v2 not v1**: `sesv2` SDK; `v1` is end-of-life
- **`SES_REQUIRED=true` in production**: if `NewSender` fails and `SES_REQUIRED` is false, `main.go` falls back to `auth.NoopMailer{}` with a WARN log. In prod, `SES_REQUIRED=true` causes `os.Exit(1)` on init failure — see prod-fail-loud rule
- **HTML-only**: all emails are HTML; no plain-text fallback currently

## Invariants
- `NewSender` authenticates via the AWS default credential chain — the caller must ensure `AWS_REGION` and credentials are set before calling
- `Send` logs `slog.Error` on failure but returns the error — callers decide whether to surface it

## AI Context
- `ses.go`: the entire package is one file — `Sender` struct, `NewSender`, `Send`
- `auth.NoopMailer{}` is defined in `api/internal/auth/ctx.go` — used in local dev when `SES_REQUIRED` is false
- See `api/cmd/api/main.go` `buildMailer` function for the `SES_REQUIRED` guard pattern

## Changelog
2026-05-31 — initial spec
```

- [ ] **Step 2: Write `.claude/rules/spec-email.md`**

```markdown
---
paths:
  - "api/internal/email/**"
---

@api/internal/email/email.spec.md
```

- [ ] **Step 3: Write `api/internal/me/me.spec.md`**

```markdown
# me Spec
**Path:** `api/internal/me/`
**Last updated:** 2026-05-31

## Contract
- `GET /me/summary` → `SummaryHandler(pool)` — returns `{ artist_profile?, festivals[] }` for the authenticated user: the user's own artist profile stub (if they have one) and a list of festivals they own as an organiser

## Boundaries
- Does NOT return full profile or full festival objects — stubs only (id, name, slug, status)
- Does NOT paginate — returns all festivals for the organiser; intended for navigation/dashboard bootstrap

## Key Decisions
- **Cross-resource summary endpoint**: the `me` package exists specifically to avoid clients making N+1 calls on first load; it joins across artist profiles and festivals in one query
- **Stub responses not full objects**: the full profile and festival objects are fetched by their respective packages when needed

## Invariants
- `SummaryHandler` MUST require auth — 401 if no principal

## AI Context
- `summary.go`: the single handler; reads artist profile + organiser festivals via sqlcdb in two queries

## Changelog
2026-05-31 — initial spec
```

- [ ] **Step 4: Write `.claude/rules/spec-me.md`**

```markdown
---
paths:
  - "api/internal/me/**"
---

@api/internal/me/me.spec.md
```

- [ ] **Step 5: Commit**

```bash
git add api/internal/email/email.spec.md .claude/rules/spec-email.md \
        api/internal/me/me.spec.md .claude/rules/spec-me.md
git commit -m "feat(specs): add email and me package specs"
```

---

## Task 11: api/cmd/api spec

**Files:**
- Create: `api/cmd/api/api.spec.md`
- Create: `.claude/rules/spec-api-cmd.md`

- [ ] **Step 1: Write `api/cmd/api/api.spec.md`**

```markdown
# api/cmd/api Spec
**Path:** `api/cmd/api/`
**Last updated:** 2026-05-31

## Contract
- Entry point for the Go API server
- Constructs all service clients (DB pool, MinIO ×2, Stripe, SES), the chi router, and all middleware
- Registers every HTTP route with correct middleware groups
- Handles graceful shutdown on SIGTERM/SIGINT (10-second drain)

## Boundaries
- Contains NO business logic — all handler logic lives in `api/internal/*` packages
- Does NOT read config directly in handler closures — config is passed to constructors at startup

## Key Decisions
- **Two MinIO clients**: `mc` (internal `minio:9000`) for `ConfirmHandler`; `mcPublic` (public endpoint + `Region: "us-east-1"`) for `PresignHandler` — see image.spec.md for why
- **Middleware order is significant**: `RealIP` → `Logger` → `Recover` → `Metrics` → `auth.Middleware`. `RealIP` must be first so every subsequent middleware and handler sees the correct client IP in `r.RemoteAddr`
- **CORS allowlist (not wildcard)**: `corsMiddleware` only sets `Access-Control-Allow-Origin` for origins in `CORS_ALLOWED_ORIGINS`; arbitrary origins get no header (credentials-bearing cross-site requests are silently rejected)
- **Beta gate wraps the authenticated group**: `beta.Gate` is a no-op when `BetaMode=false`; it does not need to be removed at launch
- **`SES_REQUIRED` pattern**: `buildMailer` exits with `os.Exit(1)` if SES init fails when `SES_REQUIRED=true` — see prod-fail-loud rule
- **OAuth providers are conditionally registered**: Google and Apple route pairs are only registered when the respective client ID env vars are set — prevents 404s in environments where OAuth isn't configured
- **Rate-limited group covers login, forgot-password, MFA verify, promo redeem, waitlist**: these share one `auth.RateLimitMiddleware` call — adding a new endpoint that needs rate limiting goes in this group
- **`/_test/` probe endpoints**: two test-only routes exist for e2e verification — `/_test/billing/pro-only` (exercises `RequirePlan`) and `/_test/beta/gated` (exercises `beta.Gate` unconditionally regardless of `BETA_MODE`); these expose no real functionality and must not be removed
- **Billing webhook CSRF posture**: the session cookie is `SameSite=Lax`, which blocks cross-site form POSTs. Do not relax to `SameSiteNoneMode` without adding a CSRF token.

## Invariants
- Route registration order: literal sub-paths BEFORE parameterised routes at the same level (chi matches top-to-bottom)
- `RealIP` middleware MUST be the first `r.Use()` call — everything downstream relies on `r.RemoteAddr` being the real client IP
- Protected route groups MUST have at least one unauthenticated e2e probe confirming the middleware is actually wired (unit tests bypass middleware)
- `CORS_ALLOWED_ORIGINS` MUST include every production domain — wildcard is never acceptable

## AI Context
- `main.go`: the whole file — read this when adding routes, middleware, or service clients
- `buildMailer`: SES init with `SES_REQUIRED` guard — canonical example of the prod-fail-loud pattern
- `corsMiddleware`: allowlist-based CORS — add new production origins to `CORS_ALLOWED_ORIGINS` env var, not here
- `warnIfStripeMisconfigured`: logs warnings for blank price IDs at startup — add new price IDs here when adding billing endpoints
- When adding a new route: check the middleware group, check literal-before-param ordering, check if it needs an e2e probe
- `/_test/` routes: test probes — `/_test/billing/pro-only` and `/_test/beta/gated`; keep them, they're load-bearing for e2e billing and beta gate tests

## Changelog
2026-05-31 — initial spec
```

- [ ] **Step 2: Write `.claude/rules/spec-api-cmd.md`**

```markdown
---
paths:
  - "api/cmd/api/**"
---

@api/cmd/api/api.spec.md
```

- [ ] **Step 3: Commit**

```bash
git add api/cmd/api/api.spec.md .claude/rules/spec-api-cmd.md
git commit -m "feat(specs): add api/cmd/api spec"
```

---

## Task 12: db spec

**Files:**
- Create: `db/db.spec.md`
- Create: `.claude/rules/spec-db.md`

- [ ] **Step 1: Write `db/db.spec.md`**

```markdown
# db Spec
**Path:** `db/`
**Last updated:** 2026-05-31

## Contract
- `db/migrations/`: golang-migrate up/down SQL files, numbered `000001_...` through `000016_...`
- `db/queries/`: sqlc input — SQL queries that `task db:generate` compiles to `api/internal/sqlcdb/*.sql.go`
- `db/seed/`: seed data for local development
- `api/internal/db/db.go`: `db.Open(ctx, url)` — creates and validates a pgx connection pool

## Boundaries
- Does NOT contain Go business logic — only SQL
- Migration files once merged are IMMUTABLE — never edit a merged migration; write a new one

## Key Decisions
- **golang-migrate for schema**: migrations run on `task db:migrate`; version tracked in `schema_migrations` table
- **sqlc for queries**: all DB queries go through sqlc-generated code in `api/internal/sqlcdb/` — no raw query strings in handlers; `task db:generate` regenerates after editing `db/queries/*.sql`
- **Partial unique indexes**: several unique indexes use `WHERE` clauses (e.g. `users_oauth_idx WHERE oauth_provider IS NOT NULL`); `ON CONFLICT` clauses in sqlc queries MUST include the same `WHERE` to match the partial index
- **`DO NOTHING` + `RETURNING` returns no row in Postgres**: always use `DO UPDATE SET col = EXCLUDED.col RETURNING *` for upsert-style operations — see sqlc-and-schema rule

## Invariants
- Every `.up.sql` MUST have a matching `.down.sql` that reverses it exactly
- Migration numbers must be strictly sequential — check the highest existing number before creating a new file
- After adding a column: every SELECT/UPDATE/INSERT-RETURNING in the affected `*.sql.go` files must be updated — `task db:generate` handles this automatically; hand-editing requires the grep-count check from sqlc-and-schema rule
- The `dirty` flag in `schema_migrations` indicates a failed partial migration — do not re-run until the state is manually fixed

## AI Context
- `db/migrations/`: numbered SQL files — current highest is `000016`
- `db/queries/`: one file per table or concern — edit here, then `task db:generate`
- `api/internal/sqlcdb/`: generated output — `models.go` has the struct definitions; `*.sql.go` has the query implementations
- `task db:migrate`: applies pending migrations against the running Docker DB
- `task db:generate`: runs sqlc to regenerate `api/internal/sqlcdb/` from `db/queries/`
- The dual concern (sqlc-generated code + migration SQL) is fully documented in `.claude/rules/sqlc-and-schema.md` — read that rule when touching anything here

## Changelog
2026-05-31 — initial spec
```

- [ ] **Step 2: Write `.claude/rules/spec-db.md`**

```markdown
---
paths:
  - "db/**"
  - "api/internal/sqlcdb/**"
  - "api/internal/db/**"
---

@db/db.spec.md
```

- [ ] **Step 3: Commit**

```bash
git add db/db.spec.md .claude/rules/spec-db.md
git commit -m "feat(specs): add db spec"
```

---

## Task 13: web specs

**Files:**
- Create: `web/src/app/(artist)/artist.spec.md`
- Create: `web/src/app/dashboard/dashboard.spec.md`
- Create: `web/src/app/(public)/public.spec.md`
- Create: `web/src/lib/lib.spec.md`
- Create: `.claude/rules/spec-web-artist.md`
- Create: `.claude/rules/spec-web-dashboard.md`
- Create: `.claude/rules/spec-web-public.md`
- Create: `.claude/rules/spec-web-lib.md`

- [ ] **Step 1: Write `web/src/app/(artist)/artist.spec.md`**

```markdown
# web/(artist) Spec
**Path:** `web/src/app/(artist)/`
**Last updated:** 2026-05-31

## Contract
- Artist-authenticated pages: profile editor, collections, QR code download, analytics dashboard, applications list, billing/subscription management
- All routes require an authenticated artist session; redirect to `/login` if none
- Typed against the OpenAPI-generated client (`@render/api-client`) — no hand-written fetch calls

## Boundaries
- Does NOT contain organiser UI — that lives in `web/src/app/dashboard/`
- Does NOT contain public-facing pages — those are in `web/src/app/(public)/`

## Key Decisions
- **App Router with React Server Components**: data-fetching pages use `async` server components; interactive sections are `'use client'` components
- **`API_URL` vs `NEXT_PUBLIC_API_URL`**: server components use `process.env.API_URL` (`http://api:8080` in Docker) — never `NEXT_PUBLIC_API_URL` (which resolves to `localhost:8080` from inside the container)
- **Dynamic imports with `ssr: false`** (e.g. the map editor) MUST be in a `'use client'` wrapper, not directly in a `page.tsx` — causes 500s otherwise

## Invariants
- No raw `fetch()` calls — use the typed API client from `@render/api-client`
- Server-side data fetching MUST use `API_URL` not `NEXT_PUBLIC_API_URL`

## AI Context
- Route structure mirrors the API surface — `analytics/`, `applications/`, `billing/`, `collections/`, `profile/`
- `layout.tsx`: artist shell layout with navigation
- See e2e-debugging rule for the ECONNREFUSED / `NEXT_PUBLIC_API_URL` pitfall

## Changelog
2026-05-31 — initial spec
```

- [ ] **Step 2: Write `web/src/app/dashboard/dashboard.spec.md`**

```markdown
# web/dashboard Spec
**Path:** `web/src/app/dashboard/`
**Last updated:** 2026-05-31

## Contract
- Organiser-authenticated pages: festival management, application review, reviewer management, spot map editor, rubric scoring
- All routes require an authenticated organiser session
- Typed against `@render/api-client`

## Boundaries
- Does NOT contain artist management UI — artists manage their own profiles in `(artist)/`
- Does NOT contain public pages

## Key Decisions
- **Map editor uses Leaflet with `ssr: false`**: `FestivalMapClient.tsx` is a `'use client'` dynamic import — the map cannot be SSR'd
- **`[data-testid="spot-panel"]`**: the spot edit panel is a custom side panel, NOT a Leaflet popup — Playwright tests target `spot-panel`, not `.leaflet-popup`

## Invariants
- Map editor components MUST be dynamic imports with `ssr: false` inside a `'use client'` wrapper
- Spot panel tests MUST target `[data-testid="spot-panel"]`, not Leaflet popup selectors

## AI Context
- `festivals/`: festival CRUD + status management
- `applications/`: review queue, scoring, waitlist, reorder
- `layout.tsx`: organiser shell
- See e2e-debugging rule for the spot-panel / Leaflet popup selector trap

## Changelog
2026-05-31 — initial spec
```

- [ ] **Step 3: Write `web/src/app/(public)/public.spec.md`**

```markdown
# web/(public) Spec
**Path:** `web/src/app/(public)/`
**Last updated:** 2026-05-31

## Contract
- Unauthenticated public pages: festival listings, individual festival page, festival map (Leaflet), artist profile pages
- No session required — these pages are indexed and publicly accessible

## Boundaries
- Does NOT require auth — never redirect to login for these routes
- Does NOT show management UI — public-facing display only

## Key Decisions
- **Festival map is a dynamic `'use client'` import**: Leaflet is browser-only; `FestivalMapClient.tsx` uses `next/dynamic({ ssr: false })`
- **Artist profile public-read 404**: the API returns 404 (not 403) for non-public profiles — the web layer should surface a 404 page, not an error page

## Invariants
- Map component MUST use `next/dynamic({ ssr: false })` — importing Leaflet in a server component crashes the Next.js build

## AI Context
- `festivals/`: festival list + individual festival page
- `festivals/[id]/map/FestivalMapClient.tsx`: canonical example of the dynamic import pattern
- `artists/`: public artist profile pages

## Changelog
2026-05-31 — initial spec
```

- [ ] **Step 4: Write `web/src/lib/lib.spec.md`**

```markdown
# web/src/lib Spec
**Path:** `web/src/lib/`
**Last updated:** 2026-05-31

## Contract
- Shared utilities for the Next.js app: auth helpers, API client configuration, type utilities
- `auth-server.ts`: server-side session utilities — reads the `session` cookie, validates JWT, returns user or null
- API client setup: configures `@render/api-client` with the correct base URL for server vs client contexts

## Boundaries
- Does NOT contain UI components — those live in `web/src/components/`
- Does NOT contain route-specific logic — that belongs in the page/layout files

## Key Decisions
- **Server vs client API URL**: `lib/` is the single place that decides `API_URL` vs `NEXT_PUBLIC_API_URL` — all other files import from here rather than reading `process.env` directly

## Invariants
- `auth-server.ts` MUST use `API_URL` for any server-side API calls — never `NEXT_PUBLIC_API_URL`

## AI Context
- `auth-server.ts`: server-side auth — called from server component `page.tsx` files that need to know who the user is
- If all pages are 500-ing with ECONNREFUSED, check that `auth-server.ts` is using `API_URL` (see e2e-debugging rule)

## Changelog
2026-05-31 — initial spec
```

- [ ] **Step 5: Write the four web rule stubs**

`.claude/rules/spec-web-artist.md`:
```markdown
---
paths:
  - "web/src/app/(artist)/**"
---

@web/src/app/(artist)/artist.spec.md
```

`.claude/rules/spec-web-dashboard.md`:
```markdown
---
paths:
  - "web/src/app/dashboard/**"
---

@web/src/app/dashboard/dashboard.spec.md
```

`.claude/rules/spec-web-public.md`:
```markdown
---
paths:
  - "web/src/app/(public)/**"
---

@web/src/app/(public)/public.spec.md
```

`.claude/rules/spec-web-lib.md`:
```markdown
---
paths:
  - "web/src/lib/**"
---

@web/src/lib/lib.spec.md
```

- [ ] **Step 6: Verify all spec files exist**

```bash
find . -name "*.spec.md" | sort
# Expected: 16 files — one per package listed in CLAUDE.md Living Specs table
```

- [ ] **Step 7: Verify all rule stubs exist**

```bash
ls .claude/rules/spec-*.md | sort
# Expected: spec-admin.md, spec-analytics.md, spec-api-cmd.md, spec-artist.md,
#           spec-auth.md, spec-beta.md, spec-billing.md, spec-db.md, spec-email.md,
#           spec-festival.md, spec-image.md, spec-maintenance.md, spec-me.md,
#           spec-web-artist.md, spec-web-dashboard.md, spec-web-lib.md, spec-web-public.md
```

- [ ] **Step 8: Commit**

```bash
git add web/src/app/\(artist\)/artist.spec.md \
        web/src/app/dashboard/dashboard.spec.md \
        web/src/app/\(public\)/public.spec.md \
        web/src/lib/lib.spec.md \
        .claude/rules/spec-web-artist.md \
        .claude/rules/spec-web-dashboard.md \
        .claude/rules/spec-web-public.md \
        .claude/rules/spec-web-lib.md
git commit -m "feat(specs): add web area specs (artist, dashboard, public, lib)"
```
