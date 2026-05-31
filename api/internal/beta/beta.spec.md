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
