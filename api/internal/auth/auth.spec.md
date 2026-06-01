# auth Spec
**Path:** `api/internal/auth/`
**Last updated:** 2026-05-31

## Contract
- Issues and verifies HS256 JWTs (7-day TTL for full sessions, 5-min for `mfa_pending`)
- `Middleware(pool, secret)` establishes sessions from cookie (`session`) or `Authorization: Bearer` header; injects `Principal` into context
- `auth.User(ctx)` lets handlers retrieve the authenticated principal
- Handles: signup, login, password reset (forgot + reset), TOTP MFA (enrol/confirm/verify), Google OAuth, Apple OAuth
- Rate-limits login, forgot-password, and MFA verify at 5/min per IP (configurable for CI)
- Claim-on-signup: `POST /auth/signup` accepts optional `claim_token`; atomically binds a waiting prospect profile after account creation; 409 if token already used or invalid

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
2026-06-01 — E15.4: claim_token support in signup
2026-05-31 — initial spec
