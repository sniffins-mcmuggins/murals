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
