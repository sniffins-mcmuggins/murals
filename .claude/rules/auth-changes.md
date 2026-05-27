# Auth changes

When touching `api/internal/auth/`, auth wiring in `api/cmd/api/main.go`, or any migration that alters the `users` table, load: @api/internal/auth/jwt.go @api/internal/auth/middleware.go @api/internal/auth/login.go @api/internal/auth/oauth.go @api/internal/auth/totp.go @api/internal/auth/reset.go @api/internal/auth/ratelimit.go @api/cmd/api/main.go @db/queries/users.sql

This rule is for security regressions that pass code review because the bad version *looks fine*. Each section below has a real bug from history with the fix.

## OAuth: never link an identity without verifying the email

When an OAuth callback maps a provider's claims onto an existing email-keyed user account, the email *must* be verified by the provider first. Without this check, a malicious OAuth app or a provider that allows unverified emails can take over any account by signing in with the victim's address.

- **Google**: check `userinfo.email_verified` (JSON bool). Reject with 400 if false.
- **Apple**: check `id_token.email_verified` **as a string** (`"true"` / `"false"`, not a bool). Apple omits this claim entirely for returning users — only enforce when `email` is non-empty.
- **Any new provider**: find the equivalent field in their docs before merging. If they don't expose one, do not auto-link to existing accounts — force a manual confirmation step instead.

The provider's `sub` (subject) is the stable identity; the email is a *display* attribute that incidentally drives account linking. Treat them with different trust levels.

## Sessions must be revocable: `session_version` everywhere

JWTs are stateless. Without a server-side revocation knob, "log out" / "password reset" / "account compromise" do nothing until the token's natural TTL (7d here) expires. The fix is `users.session_version`:

1. Every `IssueToken` call passes `user.SessionVersion` — there is no overload that skips it.
2. The auth middleware reads the user row and rejects any JWT whose `sv` claim doesn't match. This is the one DB query per authenticated request that buys you revocation.
3. Any flow that *should* invalidate outstanding sessions calls `IncrementSessionVersion` in the same handler that mutates auth state: password reset (yes), password change-via-old-password (yes), explicit "log out everywhere" (yes), MFA disable (yes), email change (yes).

If you add a new code path that issues a token without `user.SessionVersion`, you've reintroduced the bug. Grep for `IssueToken(` after any auth change.

## State-changing auth endpoints require proof of the current factor

A valid session token is not sufficient to mutate auth state. Endpoints that change *how the user authenticates* must re-verify the existing factor:

- `/auth/mfa/enroll` when MFA is already enabled → require `current_code` for the existing secret.
- A future `/auth/mfa/disable` → require `current_code`.
- A future password-change endpoint → require the current password.
- A future "change email" endpoint → require the current password, and email-verify the new address.

The threat model: a stolen session token shouldn't escalate into permanent account control. Without these checks, the only path back from a session compromise is a password reset — which is unavailable to OAuth-only users.

## Rate-limit IP source: one source of truth, period

If `chiMiddleware.RealIP` is in the router's chain (it is, in `main.go`), `r.RemoteAddr` is the authoritative client IP. The rate limiter keys on RemoteAddr and that is the whole story.

**Do not** also parse `X-Forwarded-For` inside the limiter. Two consequences:
1. Duplication — both pieces of code now have to agree on how to pick a value from `203.0.113.1, 10.0.0.1`, and they will drift.
2. Without a trusted proxy stripping/replacing XFF, an attacker rotates `X-Forwarded-For` values and defeats the limiter. `chi.RealIP` is no safer here — the only thing keeping you safe is that your ALB sits in front and overwrites XFF.

If you ever remove `chi.RealIP` (e.g. because there's no proxy in front), remove it once at the router and `clientIP` returns the right thing automatically.

## OAuth first-login is a race — use `ON CONFLICT`

Two parallel OAuth callbacks for the same `(provider, subject)` will both miss the existing-user lookup and both attempt `INSERT INTO users`. The second hits the partial unique index `users_oauth_idx` and the handler returns a 500 the user sees as "something went wrong, log in again".

Fix: every INSERT keyed on `(oauth_provider, oauth_subject)` uses `ON CONFLICT (oauth_provider, oauth_subject) WHERE oauth_provider IS NOT NULL DO UPDATE SET oauth_provider = EXCLUDED.oauth_provider RETURNING *`. The no-op `DO UPDATE` exists purely so `RETURNING *` returns the existing row instead of nothing.

This applies to any future provider — if you add Microsoft, GitHub, etc., the same ON CONFLICT pattern goes on the new INSERT.

## Pre-merge checklist for auth changes

- [ ] If you added a new OAuth provider: `email_verified` (or equivalent) is checked before linking to an existing account.
- [ ] If you added a new `IssueToken` call site: it passes `user.SessionVersion`.
- [ ] If you added a state-changing auth endpoint: it re-verifies the current factor (current_code, current password) before mutating.
- [ ] If you added a flow that should invalidate sessions: it calls `IncrementSessionVersion`.
- [ ] If you added a rate-limited endpoint: it's in the `r.Use(auth.RateLimitMiddleware)` group, not registered separately.
- [ ] If you added an INSERT on `users` keyed on `(oauth_provider, oauth_subject)`: it uses `ON CONFLICT`.
- [ ] `task api:test` passes — `TestMiddleware_StaleSessionVersionRejected` and `TestResetPassword_InvalidatesOldSessions` are the canaries for the session_version path.
