# E21 — Email Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require email verification before login; wire Mailpit for local dev so demos and e2e tests can navigate the inbox.

**Architecture:** New `email_verification_tokens` table (mirrors `password_reset_tokens`). `POST /auth/signup` fires verification email; `POST /auth/login` gates on `email_verified`; `GET /auth/verify-email?token=` issues JWT + sets cookie. Mailpit runs as a docker-compose service and captures SMTP on port 1025; its REST API (port 8025) is used by e2e fixtures to extract verification links.

**Tech Stack:** Go (net/smtp for local SMTP), Next.js (new /verify-email page), Mailpit (axllent/mailpit), Playwright + Vitest e2e

---

## File Map

| Action | File |
|--------|------|
| Modify | `infra/docker-compose.yml` |
| Modify | `api/internal/config/config.go` |
| Create | `api/internal/email/smtp.go` |
| Modify | `api/cmd/api/main.go` |
| Create | `db/migrations/000020_email_verification.up.sql` |
| Create | `db/migrations/000020_email_verification.down.sql` |
| Create | `db/queries/email_verification.sql` |
| Modify | `db/queries/users.sql` |
| Modify | `api/internal/sqlcdb/models.go` |
| Modify | `api/internal/sqlcdb/users.sql.go` |
| Modify | `api/internal/sqlcdb/beta.sql.go` |
| Modify | `api/internal/sqlcdb/password_reset.sql.go` |
| Create | `api/internal/sqlcdb/email_verification.sql.go` |
| Create | `api/internal/auth/verify_email.go` |
| Modify | `api/internal/auth/signup.go` |
| Modify | `api/internal/auth/login.go` |
| Modify | `api/internal/auth/user.go` |
| Create | `web/src/app/(auth)/verify-email/page.tsx` |
| Modify | `web/src/app/(auth)/signup/page.tsx` |
| Modify | `web/src/app/(auth)/login/page.tsx` |
| Modify | `e2e/fixtures/helpers.ts` |
| Create | `e2e/fixtures/mailpit.ts` |
| Create | `e2e/api/email-verification.test.ts` |
| Modify | `e2e/browser/artist-onboarding.spec.ts` |

---

## Task 1: Add Mailpit to docker-compose

**Files:**
- Modify: `infra/docker-compose.yml`

- [ ] **Step 1: Add mailpit service and SMTP env vars to api**

In `infra/docker-compose.yml`, add a `mailpit` service block after the `prometheus` service:

```yaml
  # ── MAILPIT (local email catcher) ──────────────────────────────────────────
  mailpit:
    image: axllent/mailpit:latest
    ports:
      - "1025:1025"   # SMTP — api sends here
      - "8025:8025"   # Web UI + REST API — demos and e2e tests read here
    restart: unless-stopped
```

In the `api` service's `environment` block, add after `SITE_BASE_URL`:

```yaml
      SMTP_HOST: "mailpit"
      SMTP_PORT: "1025"
      SMTP_FROM: "noreply@painttrace.art"
```

In the `api` service's `depends_on` block, add:

```yaml
      mailpit:
        condition: service_started
```

- [ ] **Step 2: Commit**

```bash
git add infra/docker-compose.yml
git commit -m "infra: add mailpit SMTP catcher for local email dev"
```

---

## Task 2: Config + SMTP sender

**Files:**
- Modify: `api/internal/config/config.go`
- Create: `api/internal/email/smtp.go`

- [ ] **Step 1: Add SMTP fields to Config struct**

In `api/internal/config/config.go`, add to the `Config` struct after `SESRequired`:

```go
	// SMTP sender — used for local dev (Mailpit). When SMTPHost is set,
	// buildMailer uses SMTPSender instead of SES so no AWS credentials are needed.
	SMTPHost string
	SMTPPort string
	SMTPFrom string
```

In `Load()`, add to the returned struct after `SESRequired: ...`:

```go
		SMTPHost: env("SMTP_HOST", ""),
		SMTPPort: env("SMTP_PORT", "1025"),
		SMTPFrom: env("SMTP_FROM", "noreply@painttrace.art"),
```

- [ ] **Step 2: Create SMTP sender**

Create `api/internal/email/smtp.go`:

```go
package email

import (
	"context"
	"fmt"
	"net/smtp"
)

// SMTPSender delivers email via plain SMTP — used for local dev with Mailpit.
// Mailpit accepts unauthenticated connections so auth is nil.
type SMTPSender struct {
	addr     string // host:port
	fromAddr string
}

func NewSMTPSender(host, port, fromAddr string) *SMTPSender {
	return &SMTPSender{addr: host + ":" + port, fromAddr: fromAddr}
}

func (s *SMTPSender) Send(_ context.Context, to, subject, bodyHTML string) error {
	msg := fmt.Sprintf(
		"From: %s\r\nTo: %s\r\nSubject: %s\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n%s",
		s.fromAddr, to, subject, bodyHTML,
	)
	return smtp.SendMail(s.addr, nil, s.fromAddr, []string{to}, []byte(msg))
}
```

- [ ] **Step 3: Commit**

```bash
git add api/internal/config/config.go api/internal/email/smtp.go
git commit -m "feat(email): add SMTPSender for Mailpit + SMTP config fields"
```

---

## Task 3: Update buildMailer to prefer SMTP

**Files:**
- Modify: `api/cmd/api/main.go`

- [ ] **Step 1: Read the current buildMailer function**

It starts around line 318. The function currently checks SES config and falls back to NoopMailer. We're adding a new first check for SMTP.

- [ ] **Step 2: Add SMTP import and update buildMailer**

Add `"github.com/sniffins-mcmuggins/render/api/internal/email"` to the import block if it is not already present (it should be, since `email.NewSender` is already called).

Replace the entire `buildMailer` function body with:

```go
func buildMailer(ctx context.Context, cfg config.Config) auth.EmailSender {
	// Local dev: SMTP_HOST set → route through Mailpit (or any SMTP relay).
	// Production never sets SMTP_HOST, so this branch is never taken in prod.
	if cfg.SMTPHost != "" {
		slog.Info("using SMTP mailer", "host", cfg.SMTPHost, "port", cfg.SMTPPort)
		return email.NewSMTPSender(cfg.SMTPHost, cfg.SMTPPort, cfg.SMTPFrom)
	}

	// Production: SES.
	if cfg.SESFromEmail == "" || cfg.AWSRegion == "" {
		if cfg.SESRequired {
			slog.Error("SES not configured but SES_REQUIRED=true — exiting")
			os.Exit(1)
		}
		slog.Warn("SES not configured — using NoopMailer (email disabled)")
		return auth.NoopMailer{}
	}
	sender, err := email.NewSender(ctx, cfg.AWSRegion, cfg.SESFromEmail)
	if err != nil {
		if cfg.SESRequired {
			slog.Error("SES init failed and SES_REQUIRED=true — exiting", "err", err)
			os.Exit(1)
		}
		slog.Warn("SES init failed — falling back to NoopMailer", "err", err)
		return auth.NoopMailer{}
	}
	return sender
}
```

- [ ] **Step 3: Commit**

```bash
git add api/cmd/api/main.go
git commit -m "feat(api): buildMailer prefers SMTP when SMTP_HOST is set"
```

---

## Task 4: DB migration + SQL query files

**Files:**
- Create: `db/migrations/000020_email_verification.up.sql`
- Create: `db/migrations/000020_email_verification.down.sql`
- Create: `db/queries/email_verification.sql`
- Modify: `db/queries/users.sql`

- [ ] **Step 1: Write up migration**

Create `db/migrations/000020_email_verification.up.sql`:

```sql
-- Add email_verified flag to users.
-- Default false for new rows. Existing rows are grandfathered to true so
-- no currently-registered user is locked out when this migration runs.
ALTER TABLE users ADD COLUMN email_verified boolean NOT NULL DEFAULT false;
UPDATE users SET email_verified = true;

-- Single-use verification tokens — mirrors password_reset_tokens exactly.
CREATE TABLE email_verification_tokens (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash text        NOT NULL,
    expires_at timestamptz NOT NULL,
    used_at    timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX email_verification_tokens_user_idx
    ON email_verification_tokens (user_id);
CREATE UNIQUE INDEX email_verification_tokens_hash_idx
    ON email_verification_tokens (token_hash);
CREATE INDEX email_verification_tokens_expires_idx
    ON email_verification_tokens (expires_at);
```

- [ ] **Step 2: Write down migration**

Create `db/migrations/000020_email_verification.down.sql`:

```sql
DROP TABLE IF EXISTS email_verification_tokens;
ALTER TABLE users DROP COLUMN IF EXISTS email_verified;
```

- [ ] **Step 3: Write email_verification SQL queries**

Create `db/queries/email_verification.sql`:

```sql
-- name: CreateEmailVerificationToken :one
INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
VALUES ($1, $2, $3)
RETURNING *;

-- name: GetEmailVerificationToken :one
SELECT * FROM email_verification_tokens
WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
LIMIT 1;

-- name: MarkEmailVerificationTokenUsed :exec
UPDATE email_verification_tokens SET used_at = now() WHERE id = $1;
```

- [ ] **Step 4: Add SetEmailVerified queries + update CreateOAuthUser in users.sql**

In `db/queries/users.sql`, append at the end:

```sql
-- name: SetEmailVerified :exec
UPDATE users SET email_verified = true WHERE id = $1;

-- name: SetEmailVerifiedByEmail :exec
-- Used by the /_test/verify-email backdoor endpoint only.
UPDATE users SET email_verified = true WHERE email = $1;
```

Also update the `CreateOAuthUser` INSERT to explicitly set `email_verified = true` — OAuth providers (Google, Apple) already verify email ownership before issuing an ID token:

Find this block in `db/queries/users.sql`:

```sql
INSERT INTO users (email, password_hash, oauth_provider, oauth_subject)
VALUES ($1, NULL, $2, $3)
```

Replace with:

```sql
INSERT INTO users (email, password_hash, oauth_provider, oauth_subject, email_verified)
VALUES ($1, NULL, $2, $3, true)
```

- [ ] **Step 5: Commit**

```bash
git add db/migrations/000020_email_verification.up.sql \
        db/migrations/000020_email_verification.down.sql \
        db/queries/email_verification.sql \
        db/queries/users.sql
git commit -m "db: migration 000020 — email_verified column + verification token table"
```

---

## Task 5: sqlcdb — update generated code

**Files:**
- Modify: `api/internal/sqlcdb/models.go`
- Modify: `api/internal/sqlcdb/users.sql.go`
- Modify: `api/internal/sqlcdb/beta.sql.go`
- Modify: `api/internal/sqlcdb/password_reset.sql.go`
- Create: `api/internal/sqlcdb/email_verification.sql.go`

> **Context:** sqlc is not available in the worktree. All changes are hand-edits. The rule in `.claude/rules/sqlc-and-schema.md` requires that every SELECT/RETURNING column list AND every `row.Scan()` call be updated to match. Follow this task exactly.

- [ ] **Step 1: Add EmailVerified to User struct in models.go**

In `api/internal/sqlcdb/models.go`, find the `User` struct (around line 455). Add `EmailVerified` as the last field:

```go
type User struct {
	ID               pgtype.UUID        `db:"id" json:"id"`
	Email            string             `db:"email" json:"email"`
	PasswordHash     *string            `db:"password_hash" json:"password_hash"`
	CreatedAt        pgtype.Timestamptz `db:"created_at" json:"created_at"`
	OauthProvider    *string            `db:"oauth_provider" json:"oauth_provider"`
	OauthSubject     *string            `db:"oauth_subject" json:"oauth_subject"`
	MfaEnabled       bool               `db:"mfa_enabled" json:"mfa_enabled"`
	MfaSecret        *string            `db:"mfa_secret" json:"mfa_secret"`
	SessionVersion   int32              `db:"session_version" json:"session_version"`
	StripeCustomerID *string            `db:"stripe_customer_id" json:"stripe_customer_id"`
	IsAdmin          bool               `db:"is_admin" json:"is_admin"`
	IsBeta           bool               `db:"is_beta" json:"is_beta"`
	BetaCohort       *string            `db:"beta_cohort" json:"beta_cohort"`
	InvitedBy        pgtype.UUID        `db:"invited_by" json:"invited_by"`
	InvitedVia       pgtype.UUID        `db:"invited_via" json:"invited_via"`
	EmailVerified    bool               `db:"email_verified" json:"email_verified"`
}
```

- [ ] **Step 2: Update all column lists in users.sql.go**

Every query constant in `api/internal/sqlcdb/users.sql.go` that ends with `invited_by, invited_via` must have `, email_verified` appended. There are 10 such constants. Use replace_all to do it in one pass:

Find (exact string, appears 10 times):
```
invited_by, invited_via
```

Replace with:
```
invited_by, invited_via, email_verified
```

This updates `createOAuthUser`, `createUser`, `disableMFA`, `getUserByEmail`, `getUserByID`, `getUserByOAuth`, `incrementSessionVersion`, `linkOAuthToUser`, `setMFAEnabled`, and `upsertUserByEmail` in one operation.

- [ ] **Step 3: Update all Scan() calls in users.sql.go**

Every `row.Scan(...)` block that ends with `&i.InvitedVia,` must have `&i.EmailVerified,` appended. There are 10 such blocks. Use replace_all:

Find (exact string, appears 10 times):
```
		&i.InvitedBy,
		&i.InvitedVia,
	)
```

Replace with:
```
		&i.InvitedBy,
		&i.InvitedVia,
		&i.EmailVerified,
	)
```

- [ ] **Step 4: Update CreateOAuthUser query string for email_verified = true**

In `users.sql.go`, find the `createOAuthUser` constant. The INSERT needs to explicitly set `email_verified = true`. Find:

```go
const createOAuthUser = `-- name: CreateOAuthUser :one
INSERT INTO users (email, password_hash, oauth_provider, oauth_subject)
VALUES ($1, NULL, $2, $3)
```

Replace with:

```go
const createOAuthUser = `-- name: CreateOAuthUser :one
INSERT INTO users (email, password_hash, oauth_provider, oauth_subject, email_verified)
VALUES ($1, NULL, $2, $3, true)
```

- [ ] **Step 5: Add SetEmailVerified and SetEmailVerifiedByEmail to users.sql.go**

Append at the end of `api/internal/sqlcdb/users.sql.go`:

```go
const setEmailVerified = `-- name: SetEmailVerified :exec
UPDATE users SET email_verified = true WHERE id = $1`

func (q *Queries) SetEmailVerified(ctx context.Context, id pgtype.UUID) error {
	_, err := q.db.Exec(ctx, setEmailVerified, id)
	return err
}

const setEmailVerifiedByEmail = `-- name: SetEmailVerifiedByEmail :exec
UPDATE users SET email_verified = true WHERE email = $1`

func (q *Queries) SetEmailVerifiedByEmail(ctx context.Context, email string) error {
	_, err := q.db.Exec(ctx, setEmailVerifiedByEmail, email)
	return err
}
```

- [ ] **Step 6: Update beta.sql.go — CreateBetaUser**

In `api/internal/sqlcdb/beta.sql.go`, find the `createBetaUser` constant. Apply the same two changes:

Find:
```
RETURNING id, email, password_hash, created_at, oauth_provider, oauth_subject, mfa_enabled, mfa_secret, session_version, stripe_customer_id, is_admin, is_beta, beta_cohort, invited_by, invited_via
```

Replace with:
```
RETURNING id, email, password_hash, created_at, oauth_provider, oauth_subject, mfa_enabled, mfa_secret, session_version, stripe_customer_id, is_admin, is_beta, beta_cohort, invited_by, invited_via, email_verified
```

Then find the scan block for `CreateBetaUser`:

```go
		&i.InvitedBy,
		&i.InvitedVia,
	)
	return i, err
}
```

Replace with:

```go
		&i.InvitedBy,
		&i.InvitedVia,
		&i.EmailVerified,
	)
	return i, err
}
```

- [ ] **Step 7: Update password_reset.sql.go — UpdateUserPassword**

In `api/internal/sqlcdb/password_reset.sql.go`, find the `updateUserPassword` constant. Apply the same two changes:

Find (column list ending):
```
invited_by, invited_via
```

Replace with:
```
invited_by, invited_via, email_verified
```

Then find the scan block for `UpdateUserPassword`:

```go
		&i.InvitedBy,
		&i.InvitedVia,
	)
	return i, err
}
```

Replace with:

```go
		&i.InvitedBy,
		&i.InvitedVia,
		&i.EmailVerified,
	)
	return i, err
}
```

- [ ] **Step 8: Create email_verification.sql.go**

Create `api/internal/sqlcdb/email_verification.sql.go`:

```go
// Code generated by sqlc. DO NOT EDIT.
// source: email_verification.sql

package sqlcdb

import (
	"context"

	"github.com/jackc/pgx/v5/pgtype"
)

type EmailVerificationToken struct {
	ID        pgtype.UUID        `db:"id" json:"id"`
	UserID    pgtype.UUID        `db:"user_id" json:"user_id"`
	TokenHash string             `db:"token_hash" json:"token_hash"`
	ExpiresAt pgtype.Timestamptz `db:"expires_at" json:"expires_at"`
	UsedAt    pgtype.Timestamptz `db:"used_at" json:"used_at"`
	CreatedAt pgtype.Timestamptz `db:"created_at" json:"created_at"`
}

const createEmailVerificationToken = `-- name: CreateEmailVerificationToken :one
INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
VALUES ($1, $2, $3)
RETURNING id, user_id, token_hash, expires_at, used_at, created_at`

type CreateEmailVerificationTokenParams struct {
	UserID    pgtype.UUID        `db:"user_id" json:"user_id"`
	TokenHash string             `db:"token_hash" json:"token_hash"`
	ExpiresAt pgtype.Timestamptz `db:"expires_at" json:"expires_at"`
}

func (q *Queries) CreateEmailVerificationToken(ctx context.Context, arg CreateEmailVerificationTokenParams) (EmailVerificationToken, error) {
	row := q.db.QueryRow(ctx, createEmailVerificationToken, arg.UserID, arg.TokenHash, arg.ExpiresAt)
	var i EmailVerificationToken
	err := row.Scan(&i.ID, &i.UserID, &i.TokenHash, &i.ExpiresAt, &i.UsedAt, &i.CreatedAt)
	return i, err
}

const getEmailVerificationToken = `-- name: GetEmailVerificationToken :one
SELECT id, user_id, token_hash, expires_at, used_at, created_at FROM email_verification_tokens
WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
LIMIT 1`

func (q *Queries) GetEmailVerificationToken(ctx context.Context, tokenHash string) (EmailVerificationToken, error) {
	row := q.db.QueryRow(ctx, getEmailVerificationToken, tokenHash)
	var i EmailVerificationToken
	err := row.Scan(&i.ID, &i.UserID, &i.TokenHash, &i.ExpiresAt, &i.UsedAt, &i.CreatedAt)
	return i, err
}

const markEmailVerificationTokenUsed = `-- name: MarkEmailVerificationTokenUsed :exec
UPDATE email_verification_tokens SET used_at = now() WHERE id = $1`

func (q *Queries) MarkEmailVerificationTokenUsed(ctx context.Context, id pgtype.UUID) error {
	_, err := q.db.Exec(ctx, markEmailVerificationTokenUsed, id)
	return err
}
```

- [ ] **Step 9: Verify scan counts**

```bash
grep -c '&i\.' api/internal/sqlcdb/users.sql.go
```

Expected: **160** (10 functions × 16 fields each = 160, plus the 2 new :exec functions add 0). If the count is not 160, re-check each function.

```bash
grep -c '&i\.' api/internal/sqlcdb/beta.sql.go
grep -c '&i\.' api/internal/sqlcdb/password_reset.sql.go
```

For `beta.sql.go`: the `CreateBetaUser` function should now have 16 scan fields. For `password_reset.sql.go`: `UpdateUserPassword` should have 16.

- [ ] **Step 10: Commit**

```bash
git add api/internal/sqlcdb/
git commit -m "feat(sqlcdb): add email_verified to User + email_verification_token queries"
```

---

## Task 6: auth/verify_email.go

**Files:**
- Create: `api/internal/auth/verify_email.go`

- [ ] **Step 1: Create the file**

Create `api/internal/auth/verify_email.go`:

```go
package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

const verificationWorkTimeout = 30 * time.Second

// VerifyEmailHandler handles GET /auth/verify-email?token=<hex-token>.
// Validates the token, marks it used, sets email_verified = true, issues a
// full JWT (same cookie + body as post-login), returns 200 {"token": "..."}.
func VerifyEmailHandler(pool *pgxpool.Pool, jwtSecret string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rawHex := r.URL.Query().Get("token")
		if rawHex == "" {
			httperr.BadRequest(w, "missing token")
			return
		}
		raw, err := hex.DecodeString(rawHex)
		if err != nil || len(raw) == 0 {
			httperr.BadRequest(w, "invalid token")
			return
		}
		hash := sha256.Sum256(raw)
		tokenHash := hex.EncodeToString(hash[:])

		q := sqlcdb.New(pool)
		rec, err := q.GetEmailVerificationToken(r.Context(), tokenHash)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.BadRequest(w, "invalid or expired token")
				return
			}
			httperr.InternalServerError(w)
			return
		}

		// Mark used BEFORE issuing JWT — prevents any window of double-use.
		if err := q.MarkEmailVerificationTokenUsed(r.Context(), rec.ID); err != nil {
			httperr.InternalServerError(w)
			return
		}

		if err := q.SetEmailVerified(r.Context(), rec.UserID); err != nil {
			httperr.InternalServerError(w)
			return
		}

		user, err := q.GetUserByID(r.Context(), rec.UserID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		token, err := IssueToken(user.ID.String(), user.IsAdmin, user.SessionVersion, jwtSecret)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		http.SetCookie(w, &http.Cookie{
			Name:     "session",
			Value:    token,
			HttpOnly: true,
			SameSite: http.SameSiteLaxMode,
			Path:     "/",
			MaxAge:   int(tokenTTL.Seconds()),
		})

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]string{"token": token})
	}
}

// ResendVerificationHandler handles POST /auth/resend-verification.
// Always returns 202 — never leaks whether the email is registered.
func ResendVerificationHandler(pool *pgxpool.Pool, mailer EmailSender, webBase string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Email string `json:"email"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.BadRequest(w, "invalid request body")
			return
		}
		email := strings.ToLower(strings.TrimSpace(req.Email))
		w.WriteHeader(http.StatusAccepted)
		go sendVerificationEmailWork(pool, mailer, webBase, email)
	}
}

// SendVerificationEmail is called from SignupHandler immediately after user
// creation — exposed so signup.go can call it directly.
func SendVerificationEmail(pool *pgxpool.Pool, mailer EmailSender, webBase, email string) {
	go sendVerificationEmailWork(pool, mailer, webBase, email)
}

func sendVerificationEmailWork(pool *pgxpool.Pool, mailer EmailSender, webBase, email string) {
	ctx, cancel := context.WithTimeout(context.Background(), verificationWorkTimeout)
	defer cancel()

	q := sqlcdb.New(pool)
	user, err := q.GetUserByEmail(ctx, email)
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			slog.Error("send-verification: user lookup failed", "err", err)
		}
		return
	}
	if user.EmailVerified {
		return
	}

	rawToken := make([]byte, 32)
	if _, err := rand.Read(rawToken); err != nil {
		slog.Error("send-verification: rand.Read failed", "err", err)
		return
	}
	rawHex := hex.EncodeToString(rawToken)
	hash := sha256.Sum256(rawToken)
	tokenHash := hex.EncodeToString(hash[:])

	if _, err = q.CreateEmailVerificationToken(ctx, sqlcdb.CreateEmailVerificationTokenParams{
		UserID:    user.ID,
		TokenHash: tokenHash,
		ExpiresAt: pgTimestamptz(time.Now().Add(24 * time.Hour)),
	}); err != nil {
		slog.Error("send-verification: create token failed", "err", err)
		return
	}

	verifyURL := fmt.Sprintf("%s/verify-email?token=%s", webBase, rawHex)
	body := fmt.Sprintf(
		`<p>Verify your Painttrace account: <a href="%s">%s</a></p><p>This link expires in 24 hours.</p>`,
		verifyURL, verifyURL,
	)
	if err := mailer.Send(ctx, user.Email, "Verify your Painttrace account", body); err != nil {
		slog.Error("send-verification: mailer.Send failed", "err", err, "to", user.Email)
	}
}

// VerifyEmailTestHandler handles POST /_test/verify-email.
// Sets email_verified = true for the given email directly in the DB,
// bypassing the token flow. Only registered outside production.
func VerifyEmailTestHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Email string `json:"email"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.BadRequest(w, "invalid request body")
			return
		}
		email := strings.ToLower(strings.TrimSpace(req.Email))
		q := sqlcdb.New(pool)
		if err := q.SetEmailVerifiedByEmail(r.Context(), email); err != nil {
			httperr.InternalServerError(w)
			return
		}
		w.WriteHeader(http.StatusOK)
	}
}
```

- [ ] **Step 2: Commit**

```bash
git add api/internal/auth/verify_email.go
git commit -m "feat(auth): VerifyEmailHandler + ResendVerificationHandler + test backdoor"
```

---

## Task 7: Update signup.go, login.go, user.go

**Files:**
- Modify: `api/internal/auth/signup.go`
- Modify: `api/internal/auth/login.go`
- Modify: `api/internal/auth/user.go`

- [ ] **Step 1: Update signup.go — fire verification email after user creation**

In `SignupHandler`, find the block after successful `CreateUser` (around the `toUserResponse` call). In the non-beta path, **before** the final `w.WriteHeader(http.StatusCreated)` and JSON encode, add the verification email call.

The change is: after `CreateUser` succeeds and after the optional `claimProfile` call, add:

```go
		SendVerificationEmail(pool, cfg.Mailer, cfg.WebPublicBase, user.Email)
```

Wait — `cfg` is `config.Config` which doesn't have a `Mailer` field. `SignupHandler` currently takes `pool` and `cfg`. The mailer is not passed to `SignupHandler`.

Look at the function signature:
```go
func SignupHandler(pool *pgxpool.Pool, cfg config.Config) http.HandlerFunc {
```

The `mailer` is not in `cfg`. We need to add it as a parameter. Update `SignupHandler` and `signupBeta` to accept a `mailer EmailSender` parameter:

```go
func SignupHandler(pool *pgxpool.Pool, cfg config.Config, mailer EmailSender) http.HandlerFunc {
```

In the non-beta path, after the `claimProfile` block (around line 90), before the final `w.Header()` call, add:

```go
		SendVerificationEmail(pool, mailer, cfg.WebPublicBase, user.Email)
```

In `signupBeta`, add the same parameter and the same call after the `claimProfile` block:

```go
func signupBeta(w http.ResponseWriter, r *http.Request, pool *pgxpool.Pool, req signupRequest, mailer EmailSender) {
```

Add `SendVerificationEmail(pool, mailer, cfg.WebPublicBase, user.Email)` before the final JSON encode. Note: `signupBeta` doesn't receive `cfg` directly — pass `webBase string` instead:

```go
func signupBeta(w http.ResponseWriter, r *http.Request, pool *pgxpool.Pool, req signupRequest, mailer EmailSender, webBase string) {
```

And update the call in `SignupHandler`:
```go
signupBeta(w, r, pool, req, mailer, cfg.WebPublicBase)
```

- [ ] **Step 2: Update main.go to pass mailer to SignupHandler**

In `api/cmd/api/main.go`, find both calls to `auth.SignupHandler`:

```go
r.Post("/auth/signup", auth.SignupHandler(pool, cfg))
r.Post("/_test/beta/signup", auth.SignupHandler(pool, config.Config{BetaMode: true}))
```

Replace with:

```go
r.Post("/auth/signup", auth.SignupHandler(pool, cfg, mailer))
r.Post("/_test/beta/signup", auth.SignupHandler(pool, config.Config{BetaMode: true, WebPublicBase: cfg.WebPublicBase}, mailer))
```

- [ ] **Step 3: Update login.go — check email_verified**

In `LoginHandler`, after the bcrypt password check and before the MFA check, add:

```go
		if !user.EmailVerified {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			_ = json.NewEncoder(w).Encode(map[string]string{
				"code":    "email_not_verified",
				"message": "Check your inbox to verify your email.",
			})
			return
		}
```

The exact insertion point: after the `bcrypt.CompareHashAndPassword` error check block, before the `if user.MfaEnabled {` block.

- [ ] **Step 4: Update user.go — add EmailVerified to userResponse**

In `api/internal/auth/user.go`, update `userResponse` and `toUserResponse`:

```go
type userResponse struct {
	ID            string `json:"id"`
	Email         string `json:"email"`
	IsAdmin       bool   `json:"is_admin"`
	IsBeta        bool   `json:"is_beta"`
	EmailVerified bool   `json:"email_verified"`
	CreatedAt     string `json:"created_at"`
}

func toUserResponse(u sqlcdb.User) userResponse {
	return userResponse{
		ID:            u.ID.String(),
		Email:         u.Email,
		IsAdmin:       u.IsAdmin,
		IsBeta:        u.IsBeta,
		EmailVerified: u.EmailVerified,
		CreatedAt:     u.CreatedAt.Time.Format(time.RFC3339),
	}
}
```

- [ ] **Step 5: Commit**

```bash
git add api/internal/auth/signup.go api/internal/auth/login.go api/internal/auth/user.go
git commit -m "feat(auth): signup fires verification email; login gates on email_verified"
```

---

## Task 8: Wire routes in main.go + run api:test

**Files:**
- Modify: `api/cmd/api/main.go`

- [ ] **Step 1: Add new routes**

In `api/cmd/api/main.go`, in the unauthenticated rate-limited group (where `ForgotPasswordHandler` lives), add the resend route:

```go
r.Post("/auth/resend-verification", auth.ResendVerificationHandler(pool, mailer, cfg.WebPublicBase))
```

Outside any auth group, alongside the existing `/auth/signup` route, add the verify-email route:

```go
r.Get("/auth/verify-email", auth.VerifyEmailHandler(pool, cfg.JWTSecret))
```

Add the test backdoor alongside `/_test/beta/signup`:

```go
r.Post("/_test/verify-email", auth.VerifyEmailTestHandler(pool))
```

- [ ] **Step 2: Apply migration and run api tests**

```bash
task up
task db:migrate
task api:test
```

Expected: all tests pass. If there are compile errors, check that every `SignupHandler` call in main.go was updated in Task 7 Step 2.

- [ ] **Step 3: Smoke test via curl**

```bash
EMAIL="smoke-$(date +%s)@test" && \
  curl -sf -X POST http://localhost:8080/auth/signup \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$EMAIL\",\"password\":\"password123\"}" && \
  echo "signup ok" && \
  RESULT=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:8080/auth/login \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$EMAIL\",\"password\":\"password123\"}") && \
  echo "login status: $RESULT (expect 403)"
```

Expected output: `signup ok` then `login status: 403`.

Check Mailpit received the email:

```bash
curl -sf http://localhost:8025/api/v1/messages | python3 -m json.tool | head -30
```

Expected: one message in the list for `$EMAIL`.

- [ ] **Step 4: Commit**

```bash
git add api/cmd/api/main.go
git commit -m "feat(api): wire GET /auth/verify-email, POST /auth/resend-verification, POST /_test/verify-email"
```

---

## Task 9: Web pages

**Files:**
- Create: `web/src/app/(auth)/verify-email/page.tsx`
- Modify: `web/src/app/(auth)/signup/page.tsx`
- Modify: `web/src/app/(auth)/login/page.tsx`

- [ ] **Step 1: Create /verify-email page**

Create `web/src/app/(auth)/verify-email/page.tsx`:

```tsx
'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'

function VerifyEmailContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get('token')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!token) {
      setError('Missing verification token.')
      return
    }

    fetch(`${apiUrl}/auth/verify-email?token=${encodeURIComponent(token)}`, {
      credentials: 'include',
    })
      .then(async (res) => {
        if (!res.ok) {
          setError('This link is invalid or has expired. Please request a new verification email.')
          return
        }
        setDone(true)
        router.push('/dashboard')
      })
      .catch(() => setError('Something went wrong. Please try again.'))
  }, [token, router])

  if (error) {
    return (
      <div className="w-full max-w-md bg-offwhite border border-light rounded-2xl p-8 shadow-sm text-center">
        <h1 className="font-serif text-3xl text-ink mb-2">Verification failed</h1>
        <p className="font-sans text-mid text-sm mb-6">{error}</p>
        <Link href="/login" className="font-sans text-sm text-ink underline underline-offset-2">
          Back to sign in
        </Link>
      </div>
    )
  }

  if (done) {
    return (
      <div className="w-full max-w-md bg-offwhite border border-light rounded-2xl p-8 shadow-sm text-center">
        <h1 className="font-serif text-3xl text-ink mb-2">Email verified!</h1>
        <p className="font-sans text-mid text-sm">Redirecting you to your dashboard…</p>
      </div>
    )
  }

  return (
    <div className="w-full max-w-md bg-offwhite border border-light rounded-2xl p-8 shadow-sm text-center">
      <p className="font-sans text-mid text-sm">Verifying your email…</p>
    </div>
  )
}

export default function VerifyEmailPage() {
  return (
    <main className="min-h-screen bg-warm flex items-center justify-center p-4">
      <Suspense
        fallback={
          <div className="w-full max-w-md bg-offwhite border border-light rounded-2xl p-8 shadow-sm">
            <p className="font-sans text-sm text-mid">Loading…</p>
          </div>
        }
      >
        <VerifyEmailContent />
      </Suspense>
    </main>
  )
}
```

- [ ] **Step 2: Update signup page — inline success state instead of redirect**

In `web/src/app/(auth)/signup/page.tsx`:

Add a `verified` state and `resendPending` state after the existing state declarations:

```tsx
  const [verified, setVerified] = useState(false)
  const [resendPending, setResendPending] = useState(false)
  const [resendDone, setResendDone] = useState(false)
```

In `handleSubmit`, replace the `router.push('/login?registered=1')` lines with:

```tsx
      setVerified(true)
```

(The `claimed_profile_id` branch can also set `setVerified(true)` — the check inbox message is the same.)

Add a `handleResend` function after `handleSubmit`:

```tsx
  async function handleResend() {
    setResendPending(true)
    try {
      await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'}/auth/resend-verification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      setResendDone(true)
    } finally {
      setResendPending(false)
    }
  }
```

Add this conditional block in the JSX, before the `<main>` return (or as the first thing inside the return):

```tsx
  if (verified) {
    return (
      <main className="min-h-screen bg-warm flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-offwhite border border-light rounded-2xl p-8 shadow-sm text-center">
          <h1 className="font-serif text-3xl text-ink mb-2">Check your inbox</h1>
          <p className="font-sans text-mid text-sm mb-6">
            We sent a verification link to <strong>{email}</strong>. Click it to activate your account.
          </p>
          {resendDone ? (
            <p className="font-sans text-sm text-mid">Verification email resent.</p>
          ) : (
            <p className="font-sans text-sm text-mid">
              Didn&apos;t get it?{' '}
              <button
                type="button"
                onClick={handleResend}
                disabled={resendPending}
                className="text-ink underline underline-offset-2 disabled:opacity-50"
              >
                {resendPending ? 'Sending…' : 'Resend verification email'}
              </button>
            </p>
          )}
        </div>
      </main>
    )
  }
```

- [ ] **Step 3: Update login page — handle 403 email_not_verified**

In `web/src/app/(auth)/login/page.tsx`, in `handleSubmit`, add a 403 check **before** the `!response.ok` check:

```tsx
      if (response.status === 403) {
        setError('Please verify your email before signing in. Check your inbox.')
        return
      }
```

- [ ] **Step 4: Commit**

```bash
git add web/src/app/\(auth\)/
git commit -m "feat(web): /verify-email page; signup check-inbox state; login handles email_not_verified"
```

---

## Task 10: Update e2e helpers.ts

**Files:**
- Modify: `e2e/fixtures/helpers.ts`

> **Context:** `createUser` calls `/auth/signup` then `/auth/login`. After the email verification change, login returns 403 for unverified users. Fix: call `/_test/verify-email` between signup and login. All existing tests use `createArtist` / `createOrganiser` (which are aliases for `createUser`) — this one change fixes all of them.

- [ ] **Step 1: Add verify call to createUser**

In `e2e/fixtures/helpers.ts`, find the `createUser` function. After the `signupRes.ok` check and before the login call, add:

```typescript
  // Bypass email verification for test accounts — the real flow is tested in
  // e2e/api/email-verification.test.ts and e2e/browser/artist-onboarding.spec.ts.
  const verifyRes = await fetch(`${API}/_test/verify-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  if (!verifyRes.ok) throw new Error(`Verify failed: ${verifyRes.status}`)
```

- [ ] **Step 2: Run the API gate to confirm existing tests still pass**

```bash
npx vitest run e2e/api/golden-path.test.ts
```

Expected: all steps pass (no 403 on login).

- [ ] **Step 3: Commit**

```bash
git add e2e/fixtures/helpers.ts
git commit -m "test(e2e): verify test accounts via /_test/verify-email before login"
```

---

## Task 11: Create mailpit.ts fixture

**Files:**
- Create: `e2e/fixtures/mailpit.ts`

- [ ] **Step 1: Create the fixture**

Create `e2e/fixtures/mailpit.ts`:

```typescript
import type { Page } from '@playwright/test'

const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025'

interface MailpitMessage {
  ID: string
  To: Array<{ Address: string; Name: string }>
  Subject: string
}

interface MailpitListResponse {
  messages: MailpitMessage[]
  total: number
}

interface MailpitMessageDetail {
  HTML: string
  Text: string
}

/**
 * Polls the Mailpit REST API until an email arrives for the given address.
 * Extracts and returns the full verification URL from the email body.
 * Times out after 10 seconds.
 */
export async function extractVerificationURL(email: string): Promise<string> {
  const deadline = Date.now() + 10_000
  const normalised = email.toLowerCase()

  while (Date.now() < deadline) {
    const res = await fetch(`${MAILPIT}/api/v1/messages?limit=50`)
    if (!res.ok) throw new Error(`Mailpit API error: ${res.status}`)

    const { messages } = (await res.json()) as MailpitListResponse

    const msg = messages?.find((m) =>
      m.To?.some((t) => t.Address?.toLowerCase() === normalised),
    )

    if (msg) {
      const bodyRes = await fetch(`${MAILPIT}/api/v1/message/${msg.ID}`)
      const detail = (await bodyRes.json()) as MailpitMessageDetail
      const html = detail.HTML ?? detail.Text ?? ''

      // Match href containing /verify-email?token=
      const match = html.match(/href="([^"]*\/verify-email\?[^"]*)"/)
      if (match) {
        return match[1].replace(/&amp;/g, '&')
      }
    }

    await new Promise((r) => setTimeout(r, 500))
  }

  throw new Error(`Verification email for ${email} not found in Mailpit within 10s`)
}

/**
 * Navigates the Playwright page to Mailpit's web UI, waits for the
 * verification email to appear, shows it (for demo videos), then navigates
 * the page to the verification URL.
 */
export async function verifyEmailViaMailpit(page: Page, email: string): Promise<void> {
  // Open Mailpit — the inbox is visible on screen (good for demo recording).
  await page.goto(MAILPIT)

  // Wait for the verification email subject line to appear in the message list.
  await page
    .getByText('Verify your Painttrace account')
    .first()
    .waitFor({ state: 'visible', timeout: 10_000 })

  // Click it so the preview panel shows — the email is visible in the demo.
  await page.getByText('Verify your Painttrace account').first().click()

  // Extract the link via REST API (more reliable than clicking inside iframe).
  const verifyUrl = await extractVerificationURL(email)

  // Navigate to the verify URL — the /verify-email page calls the API,
  // sets the session cookie, and redirects to /dashboard.
  await page.goto(verifyUrl)
}
```

- [ ] **Step 2: Commit**

```bash
git add e2e/fixtures/mailpit.ts
git commit -m "test(e2e): mailpit fixture — extractVerificationURL + verifyEmailViaMailpit"
```

---

## Task 12: Create e2e/api/email-verification.test.ts

**Files:**
- Create: `e2e/api/email-verification.test.ts`

- [ ] **Step 1: Create the test file**

Create `e2e/api/email-verification.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { uniqueSuffix } from '../fixtures/helpers.js'
import { extractVerificationURL } from '../fixtures/mailpit.js'

const API = process.env.API_URL ?? 'http://localhost:8080'

const suffix = uniqueSuffix()
const email = `verify-${suffix}@e2e.test`
const password = 'testpass123'

let verifyToken: string // extracted from email URL

describe('email verification flow', () => {
  it('1. signup returns 201 with email_verified: false and no token', async () => {
    const res = await fetch(`${API}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.user.email_verified).toBe(false)
    expect(body.token).toBeUndefined()
  })

  it('2. login before verification returns 403 email_not_verified', async () => {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe('email_not_verified')
  })

  it('3. Mailpit has the verification email', async () => {
    const url = await extractVerificationURL(email)
    expect(url).toContain('/verify-email?token=')
    // Extract raw token for subsequent tests
    verifyToken = new URL(url).searchParams.get('token') ?? ''
    expect(verifyToken).not.toBe('')
  })

  it('4. valid token returns 200 with JWT', async () => {
    const res = await fetch(`${API}/auth/verify-email?token=${verifyToken}`, {
      credentials: 'include',
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(typeof body.token).toBe('string')
    expect(body.token.length).toBeGreaterThan(20)
  })

  it('5. token is single-use — second use returns 400', async () => {
    const res = await fetch(`${API}/auth/verify-email?token=${verifyToken}`)
    expect(res.status).toBe(400)
  })

  it('6. garbage token returns 400', async () => {
    const res = await fetch(`${API}/auth/verify-email?token=notavalidtokenhex`)
    expect(res.status).toBe(400)
  })

  it('7. resend-verification with known email returns 202', async () => {
    // Create a fresh unverified account for this test so the resend has an unverified user
    const s = uniqueSuffix()
    const freshEmail = `resend-${s}@e2e.test`
    await fetch(`${API}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: freshEmail, password }),
    })
    const res = await fetch(`${API}/auth/resend-verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: freshEmail }),
    })
    expect(res.status).toBe(202)
  })

  it('8. resend-verification with unknown email returns 202 (timing-safe)', async () => {
    const res = await fetch(`${API}/auth/resend-verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@example.com' }),
    })
    expect(res.status).toBe(202)
  })

  it('9. login after verification succeeds', async () => {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(typeof body.token).toBe('string')
  })
})
```

- [ ] **Step 2: Run only this file**

```bash
npx vitest run e2e/api/email-verification.test.ts
```

Expected: all 9 tests pass.

- [ ] **Step 3: Commit**

```bash
git add e2e/api/email-verification.test.ts
git commit -m "test(e2e): email-verification API gate — 9 scenarios"
```

---

## Task 13: Update artist-onboarding.spec.ts

**Files:**
- Modify: `e2e/browser/artist-onboarding.spec.ts`

> **Context:** The spec currently goes: signup → redirect to /login → login → dashboard. After this change signup shows an inline "check inbox" state (no redirect). The verification step uses `verifyEmailViaMailpit` which navigates to Mailpit, shows the email, then to the /verify-email page which redirects to /dashboard.

- [ ] **Step 1: Add mailpit import**

At the top of `e2e/browser/artist-onboarding.spec.ts`, add:

```typescript
import { verifyEmailViaMailpit } from '../fixtures/mailpit.js'
```

- [ ] **Step 2: Replace the signup-then-login steps**

Find this block in the test:

```typescript
  // ── 1. Sign up via UI ────────────────────────────────────────────────────────
  await page.goto('/signup')
  await page.fill('#email', email)
  await page.fill('#password', password)
  // Role defaults to "Artist" — no change needed
  await page.click('button[type=submit]')

  // Signup redirects to /login?registered=1
  await expect(page).toHaveURL(/\/login/)

  // ── 2. Log in via UI ─────────────────────────────────────────────────────────
  await page.fill('#email', email)
  await page.fill('#password', password)
  await page.click('button[type=submit]')
  await expect(page).toHaveURL('/dashboard')
```

Replace with:

```typescript
  // ── 1. Sign up via UI ────────────────────────────────────────────────────────
  await page.goto('/signup')
  await page.fill('#email', email)
  await page.fill('#password', password)
  // Role defaults to "Artist" — no change needed
  await page.click('button[type=submit]')

  // Signup stays on /signup and shows "Check your inbox" success state.
  await expect(page.getByText(/check your inbox/i)).toBeVisible()

  // ── 2. Verify email via Mailpit ───────────────────────────────────────────────
  // Opens Mailpit web UI (visible in demo videos), shows the inbox,
  // then navigates to the verify link which logs the user in and
  // redirects to /dashboard.
  await verifyEmailViaMailpit(page, email)
  await expect(page).toHaveURL('/dashboard')
```

- [ ] **Step 3: Run the spec**

```bash
npx playwright test e2e/browser/artist-onboarding.spec.ts
```

Expected: passes. If it fails on "Check your inbox" visibility, double-check that the signup page in Task 9 Step 2 correctly sets `verified` state and renders the heading.

- [ ] **Step 4: Commit**

```bash
git add e2e/browser/artist-onboarding.spec.ts
git commit -m "test(e2e): artist-onboarding shows Mailpit verification flow"
```

---

## Task 14: Run full e2e suite

- [ ] **Step 1: Run the full suite**

```bash
task e2e
```

Expected: all API gate tests pass, all browser specs pass.

- [ ] **Step 2: If any test fails**

Check `test-results/*/error-context.md` for the ARIA snapshot at failure. Common issues:
- A browser spec that skipped the email verification step → add `verifyEmailViaMailpit` call
- API test 403 on login → `createUser` in helpers.ts is missing the `/_test/verify-email` call
- `extractVerificationURL` timeout → check `task up` logs for SMTP delivery errors (`docker compose -f infra/docker-compose.yml logs api --tail=20`)

- [ ] **Step 3: Final commit if any fixes were needed**

```bash
git add -p
git commit -m "fix(e2e): post-email-verification test fixes"
```

---

## Self-review checklist

| Spec requirement | Covered by |
|------------------|-----------|
| Migration 000020: `email_verified` column + grandfather existing | Task 4 |
| Migration 000020: `email_verification_tokens` table | Task 4 |
| OAuth sets `email_verified = true` | Task 4 (SQL query) + Task 5 (generated code) |
| `email_verified` in User struct + all scans | Task 5 |
| `SendVerificationEmail` on signup | Task 7 Step 1 |
| Login 403 `email_not_verified` | Task 7 Step 3 |
| `GET /auth/verify-email` issues JWT + sets cookie | Task 6 + Task 8 |
| Token marked used BEFORE JWT issued | Task 6 (explicit comment) |
| `POST /auth/resend-verification` always 202, timing-safe | Task 6 |
| `POST /_test/verify-email` backdoor, non-prod only | Task 6 + Task 8 |
| Mailpit in docker-compose | Task 1 |
| `email.SMTPSender` using net/smtp | Task 2 |
| buildMailer prefers SMTP_HOST | Task 3 |
| `userResponse` includes `email_verified` | Task 7 Step 4 |
| Web `/verify-email` page | Task 9 Step 1 |
| Signup shows "check inbox" not redirect | Task 9 Step 2 |
| Login shows message on email_not_verified 403 | Task 9 Step 3 |
| `createUser` helper calls `/_test/verify-email` | Task 10 |
| `mailpit.ts` fixture with `extractVerificationURL` + `verifyEmailViaMailpit` | Task 11 |
| API gate: 9 email-verification scenarios | Task 12 |
| artist-onboarding shows Mailpit flow | Task 13 |
| Full e2e suite passes | Task 14 |
