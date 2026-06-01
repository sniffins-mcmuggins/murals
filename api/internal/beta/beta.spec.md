# beta Spec
**Path:** `api/internal/beta/`
**Last updated:** 2026-06-01

## Contract
- `beta.Gate(cfg, pool)` middleware: when `cfg.BetaMode = true`, rejects authenticated non-beta users with 403; passes through anonymous requests (downstream handlers return 401)
- `beta.BetaStatusHandler(cfg)` — public endpoint `GET /public/beta-status`, returns `{"beta_mode": bool}`
- `beta.WaitlistHandler(pool)` — rate-limited public endpoint `POST /waitlist`, stores email in `waitlist_requests` table
- **Admin invite management** (`/admin/beta/*`, requires `RequireAdmin`):
  - `AdminCreateInviteHandler(pool, webBase)` — `POST /admin/beta/invites` — creates invite code (any quota, cohort, expiry)
  - `AdminListInvitesHandler(pool)` — `GET /admin/beta/invites` — lists all invites with usage
  - `AdminListFeedbackHandler(pool)` — `GET /admin/beta/feedback` — all feedback rows
  - `AdminUpdateFeedbackHandler(pool)` — `PATCH /admin/beta/feedback/{feedbackID}` — set admin_note
- **Member beta routes** (`/beta/*`, beta-gated):
  - `MintInviteHandler(pool, webBase)` — `POST /beta/invites` — member mints personal single-use invite (default quota: 3/member)
  - `GetMyInvitesHandler(pool)` — `GET /beta/me/invites` — own codes + remaining quota + invitees
  - `SubmitFeedbackHandler(pool)` — `POST /beta/feedback` — submit feedback (kind ∈ idea|bug|direction|praise)
  - `GetMyFeedbackHandler(pool)` — `GET /beta/feedback` — caller's own feedback rows only

## Boundaries
- Does NOT own beta invite emails — those are handled by the admin workflow externally
- Does NOT gate the `GET /public/*` routes or the Stripe webhook — those are intentionally outside the beta gate in `main.go`
- Member `GET /beta/feedback` returns ONLY the caller's own rows — no cross-user access

## Key Decisions
- **`BetaMode = false` is a no-op passthrough**: the gate compiles away cleanly at launch; removing it from `main.go` is not required to exit beta
- **`is_beta` is read live from DB**: same pattern as `is_admin` in RequireAdmin — never trust the JWT claim; membership changes take effect on the next request
- **Anonymous requests pass through**: the gate intentionally does not block unauthenticated requests — this allows public routes and the signup/login flow to work during beta without special-casing
- **Member invite quota = 3**: enforced server-side via `CountBetaInvitesByCreator`; admin has no quota restriction
- **Personal invites are single-use** (`max_uses = 1`); admin invites can have higher `max_uses`
- **Invite redemption is race-safe**: `RedeemBetaInvite` uses a conditional UPDATE (`used_count < max_uses`) so concurrent signups with the same code produce exactly one winner

## Invariants
- `Gate` MUST pass anonymous requests through (no principal = pass through, not 401/403) — auth is downstream
- `is_beta` MUST be read from the DB user row, not from the JWT — the JWT has no `is_beta` claim
- `GetMyFeedbackHandler` MUST filter by `user_id = caller's UUID` — never return other users' rows

## AI Context
- `gate.go`: the `Gate` middleware — the `!cfg.BetaMode` short-circuit is the launch exit path
- `handlers.go`: waitlist signup + `BetaStatusHandler`
- `invites.go`: all invite handlers (admin create/list, member mint/get-mine) + `randomBase62` code generator
- `feedback.go`: all feedback handlers; uses chi `URLParam` for the PATCH route
- `helpers.go`: `pgUUIDFromString` utility (package-local copy)
- The beta gate sits inside the outer authenticated route group in `main.go` but wraps everything including routes that don't require auth — this is deliberate
- Admin beta routes are nested inside the `/admin` subrouter (full path: `/admin/beta/...`) — the `RequireAdmin` middleware applies
- `is_beta` is now exposed on `GET /me` (via `toUserResponse` in `api/internal/auth/user.go`) and `GET /me/summary` — both updated in E16.3

## Changelog
2026-05-31 — initial spec
2026-06-01 — added E16.2 invite issuance + quota; E16.3 feedback inbox + founding-member UX
