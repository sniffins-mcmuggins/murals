# E21 — Email Verification on Signup
**Date:** 2026-06-03
**Epic:** E21 (next available after E20)

## Overview

Users must verify their email address before they can log in. Clicking the link in the
verification email automatically logs them in (no second login step). Local dev captures
outbound email via Mailpit, which is also shown in video demos.

---

## Section 1: Database

### Migration `000020_email_verification`

```sql
-- Add verified flag; default false for new signups, true for existing accounts
ALTER TABLE users ADD COLUMN email_verified boolean NOT NULL DEFAULT false;
UPDATE users SET email_verified = true; -- grandfather all existing accounts

-- Single-use verification tokens (mirrors password_reset_tokens exactly)
CREATE TABLE email_verification_tokens (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash text        NOT NULL,
    expires_at timestamptz NOT NULL,
    used_at    timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX email_verification_tokens_user_idx  ON email_verification_tokens (user_id);
CREATE UNIQUE INDEX email_verification_tokens_hash_idx ON email_verification_tokens (token_hash);
CREATE INDEX email_verification_tokens_expires_idx ON email_verification_tokens (expires_at);
```

### OAuth accounts

`oauth.go` sets `email_verified = true` on upsert — Google and Apple both verify email
before issuing an ID token, so no verification step is needed.

### Token expiry

24 hours. Expired tokens return 400; users can request a resend.

---

## Section 2: API

### Modified: `POST /auth/signup`

After user creation, fire-and-forget a verification email (detached goroutine, same
pattern as forgot-password). Return 201 with `email_verified: false` in the user object.
No JWT is issued.

```json
// 201 response
{ "user": { "id": "...", "email": "...", "email_verified": false, "role": "artist" } }
```

### Modified: `POST /auth/login`

Before issuing a token, check `email_verified`. If false:

```json
// 403
{ "code": "email_not_verified", "message": "Check your inbox to verify your email." }
```

The web uses `code: "email_not_verified"` to show a targeted message with a "resend"
prompt rather than a generic error.

### New: `GET /auth/verify-email?token=<token>`

1. SHA-256 hash the token (same approach as `password_reset_tokens`), look up
   `email_verification_tokens` — 400 if not found, expired, or already used.
2. Mark `used_at = now()` on the token row.
3. Set `email_verified = true` on the user row.
4. Issue a full JWT (same as post-login) — `session_version` is not bumped (no existing
   sessions to invalidate; the user has never logged in).
5. Return `200 {"token": "..."}`.

The web navigates to the app using the returned token, just like after a normal login.

### New: `POST /auth/resend-verification`

Accepts `{"email": "..."}`. Always returns 202 regardless of whether the email exists —
same timing-safe pattern as forgot-password. Rate-limited per IP. Does nothing if the
account is already verified.

### Test backdoor: `POST /_test/verify-email`

Accepts `{"email": "..."}`, sets `email_verified = true` directly in the DB. Only
registered when `GO_ENV != production`. Mirrors `POST /_test/beta/signup`.

---

## Section 3: Local Dev & Email Infrastructure

### Mailpit in docker-compose

```yaml
mailpit:
  image: axllent/mailpit:latest
  ports:
    - "1025:1025"   # SMTP
    - "8025:8025"   # Web UI + REST API
  restart: unless-stopped
```

API container gets:
```yaml
SMTP_HOST: "mailpit"
SMTP_PORT: "1025"
```

### New `email.SMTPSender`

Implements `auth.EmailSender` using `net/smtp` — no new dependencies. `buildMailer` in
`main.go` checks `SMTP_HOST` first:

```
SMTP_HOST set        → SMTPSender   (local dev, CI)
SES config present   → SES Sender   (production)
neither              → NoopMailer   (warn log)
```

Prod never sets `SMTP_HOST`, so SES behaviour is unchanged.

---

## Section 4: E2E Tests

### Fix existing helpers immediately

`createArtist` and `createOrganiser` in `e2e/fixtures/helpers.ts` call signup then login.
After this change, login 403s for unverified users. Fix: after signup, each helper calls
`POST /_test/verify-email` before the login call. All existing tests pass without
individual changes.

### New fixture: `e2e/fixtures/mailpit.ts`

```typescript
// Poll Mailpit REST API until an email arrives for the given address.
// Extracts and returns the verification URL from the email body.
export async function extractVerificationURL(email: string): Promise<string>

// Navigates the Playwright page through Mailpit's web UI:
// opens localhost:8025, finds the email, clicks the verification link.
// Used by demos and browser specs so the email UI appears on screen.
export async function verifyEmailViaMailpit(page: Page, email: string): Promise<void>
```

Mailpit REST endpoint: `GET http://localhost:8025/api/v1/messages?limit=50`.
Poll with 500 ms interval, 10 s timeout before failing.

### New API gate: `e2e/api/email-verification.test.ts`

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Signup | 201, `email_verified: false`, no token in response |
| 2 | Login before verification | 403 `email_not_verified` |
| 3 | Email delivery | Mailpit has an email for the signed-up address |
| 4 | Valid token | 200 with JWT; DB row has `email_verified: true` |
| 5 | Token is single-use | Second use of same token → 400 |
| 6 | Garbage token | 400 |
| 7 | Resend — known email | 202 |
| 8 | Resend — unknown email | 202 (timing-safe, no leak) |
| 9 | Login after verification | 200 JWT |

### Browser spec changes

`e2e/browser/artist-onboarding.spec.ts`: add `verifyEmailViaMailpit(page, email)` between
signup and the first authenticated step. This navigates through Mailpit's web UI on screen —
matching the V05/V06 demo scripts exactly.

`loginAs()` helper is unaffected — used for pre-verified accounts only.

---

## Video Demos (V05 & V06)

Both demos show the email verification flow in full:

1. User signs up on the platform.
2. Playwright opens `localhost:8025` (Mailpit web UI) in the same browser context.
3. The verification email is visible in the inbox.
4. Playwright clicks the link.
5. The app loads — user is logged in, demo continues.

Mailpit's UI is clean enough to appear intentional on screen. This validates the security
feature visually and makes both demos more complete.

---

## Invariants

- `email_verified = false` users MUST NOT receive a JWT from `/auth/login` or any other
  password-based login path.
- OAuth signups MUST set `email_verified = true` at insert time.
- The verify endpoint MUST mark `used_at` before issuing the JWT — no window where a token
  can be used twice.
- The `/_test/verify-email` backdoor MUST NOT be registered in production (`GO_ENV != production` guard).
- `POST /auth/resend-verification` MUST return 202 for both known and unknown emails —
  no timing difference.

---

## Changelog
2026-06-03 — initial spec
