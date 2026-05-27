# Production Readiness Design

**Date:** 2026-05-27
**Status:** Approved
**Project:** Render — Paint Festival Platform
**Depends on:** [2026-05-18-tech-stack-design.md](2026-05-18-tech-stack-design.md), [2026-05-19-phase1-build-plan-design.md](2026-05-19-phase1-build-plan-design.md)

---

## Overview

Three implementation epics to take the website from local dev to a live, production-grade deployment. The mobile app is explicitly out of scope — it is only needed closer to the first hosted festival.

This spec supersedes E10 (Phase 2 prep / planning). Issues #10, #77–#82 are closed as absorbed into E11–E13.

---

## Decisions made in this spec

| Decision | Choice | Reason |
|----------|--------|--------|
| IaC tool | Terraform | Industry standard, HCL diffs read cleanly in PRs, portable to contractors/hires |
| Auth approach | Build in Go | Extends existing E3 auth, no vendor lock-in, fits existing JWT architecture |
| OAuth providers | Google + Apple | Highest adoption; Apple required for future App Store submission |
| MFA type | Opt-in TOTP | Authenticator apps (Google Authenticator, Authy); no SMS dependency |
| Password reset delivery | AWS SES | Already in the AWS stack, negligible cost |
| Transactional email | AWS SES | Zero additional vendor |
| Pre-launch gate | Next.js middleware, shared secret | Trivially removable at launch via env var |
| Artist tiers | Basic + Pro only | Pro+ dropped — two tiers are simpler to explain and enforce |
| Artist billing | Basic £15/yr or £2/mo · Pro £25/yr or £4/mo | Paid minimum prevents bot accounts |
| Organiser billing | £35 one-time setup + monthly (£19/£49/£99) | Per existing CLAUDE.md pricing |
| Staging | Terraform workspace | Identical infra at smaller instance sizes; deploy here before prod |

---

## Epic structure and sequencing

```
E11 — Production Infrastructure   ← must land first
              ↓
E12 — Auth Upgrades   ┐  parallel — independent once E11 is up
E13 — Stripe Payments ┘
```

E12 and E13 are developed and tested locally against docker-compose, but cannot be promoted to staging/production until E11 is complete.

---

## E11 — Production Infrastructure

**Goal:** A publicly reachable, HTTPS website on a real domain, deployed via CI/CD, with a staging environment and a pre-launch password gate.

### Sub-issues

| # | Title | Notes |
|---|-------|-------|
| 11.1 | Domain setup | Route 53 hosted zone. Transfer/register domain. Delegate NS records. Blocking dep for 11.7. |
| 11.2 | Terraform foundation | `infra/terraform/` structure with modules (`networking`, `ecs`, `rds`, `cdn`, `secrets`). VPC, public/private subnets, security groups, ECR repos (one per service: `api`, `web`). |
| 11.3 | Terraform — RDS | Postgres 16, `db.t4g.micro`. Automated backups enabled, 14-day retention. Encryption at rest. Private subnet only (no public access). |
| 11.4 | Terraform — ECS | Fargate cluster. Task definitions for `api` and `web`. Secrets pulled from Secrets Manager as env vars. |
| 11.5 | Terraform — ALB | Application Load Balancer. HTTP→HTTPS redirect (80→443). Target groups for `api` and `web`. Health check paths: `/healthz` (api), `/api/healthz` (web → proxied). |
| 11.6 | Terraform — S3 + CloudFront | Image bucket (private, CloudFront OAC). CloudFront distribution. Cache headers for images. |
| 11.7 | Terraform — Route 53 + ACM | A/ALIAS records pointing to ALB. ACM TLS cert with DNS validation. Auto-renewal. Blocked by 11.1. |
| 11.8 | Terraform — Secrets Manager | Secrets: `DB_URL`, `JWT_SECRET`, `STREAM_API_KEY`, `STREAM_API_SECRET`. Referenced by ECS task definitions — never in environment files or source control. |
| 11.9 | Staging environment | Terraform workspace `staging`. Same modules, smaller sizes (`db.t3.micro`, single ECS task). Separate Route 53 subdomain (`staging.renderltd.com` or similar). |
| 11.10 | CI/CD pipeline | GitHub Actions workflow: `test → lint → build Docker images → push to ECR → run DB migrations (one-off ECS task) → rolling ECS service update`. Triggered on merge to `main`. Staging deploy on PR merge; production deploy on tag `v*`. |
| 11.11 | Rollback runbook | Document in `docs/runbooks/rollback.md`: ECS rollback via `aws ecs update-service --task-definition <previous-revision>`. Terraform state rollback steps. DB migration rollback policy (forward-only; breaking migrations require a new migration). |
| 11.12 | Pre-launch gate | Next.js middleware (`middleware.ts`). Checks for `launch_token` cookie matching `LAUNCH_PASSWORD` env var. Unauthenticated requests redirect to `/coming-soon`. Remove at launch by unsetting `LAUNCH_PASSWORD`. |
| 11.13 | CloudWatch Logs + Alarms | ECS log groups for `api` and `web`. Alarms: ECS task exit (threshold: 1 in 5 min), HTTP 5xx rate > 1% (ALB metric), RDS connection failures > 10 in 5 min. SNS topic → email notification. |
| 11.14 | Legal pages | `/privacy` and `/terms` — static Next.js pages. Required by Google and Apple before OAuth app approval. Minimal but legally coherent (GDPR-aware). |
| 11.15 | GDPR cookie notice | Minimal dismissible banner: "This site uses a secure authentication cookie to keep you logged in." Dismissed state stored in `localStorage`. No tracking cookies — banner is informational only. |

### Terraform directory structure

```
infra/
  terraform/
    modules/
      networking/     # VPC, subnets, security groups
      ecs/            # cluster, task definitions, services
      rds/            # Postgres instance, subnet group, parameter group
      cdn/            # S3 bucket, CloudFront distribution
      secrets/        # Secrets Manager secrets
    environments/
      staging/        # Terraform workspace config
      production/     # Terraform workspace config
    main.tf
    variables.tf
    outputs.tf
    versions.tf       # provider version pins
```

### CI/CD flow

```
Push to main
  → GitHub Actions
    → task test (Go + web)
    → task lint
    → docker build api → push to ECR (api repo)
    → docker build web → push to ECR (web repo)
    → ECS run-task: migrations (one-off, waits for exit 0)
    → ECS update-service: api (rolling, min 50% healthy)
    → ECS update-service: web (rolling, min 50% healthy)
    → Slack/email notify on failure
```

Tags (`v*`) deploy to production; branch merges deploy to staging.

---

## E12 — Auth Upgrades

**Goal:** Google and Apple OAuth, opt-in TOTP MFA, forgot/reset password, and rate limiting on auth endpoints.

Extends the existing `internal/auth` package from E3. No auth system replacement.

### Sub-issues

| # | Title | Notes |
|---|-------|-------|
| 12.1 | AWS SES setup | Domain verification in SES console. Send quota increase (starts in sandbox, limited to verified addresses). Go wrapper `internal/email` with `SendEmail(to, subject, bodyHTML)`. |
| 12.2 | Forgot/reset password | `POST /auth/forgot-password {email}` → generate secure random token, hash it, store in `password_reset_tokens` with 1-hour expiry, send SES email with reset link. `POST /auth/reset-password {token, newPassword}` → validate token (not expired, not used), bcrypt new password, mark token used. |
| 12.3 | Google OAuth | `golang.org/x/oauth2` + Google provider. `GET /auth/oauth/google` → redirect to Google consent. `GET /auth/oauth/google/callback` → exchange code → fetch Google profile → upsert user (`oauth_provider='google'`, `oauth_subject=<google_id>`) → issue JWT. |
| 12.4 | Apple OAuth | Sign in with Apple. `GET /auth/oauth/apple` + `POST /auth/oauth/apple/callback` (Apple POSTs the callback). Apple only returns name/email on the first login — store at first upsert only. |
| 12.5 | TOTP enroll | `pquerna/otp` library. `POST /auth/mfa/enroll` (requires auth) → generate TOTP secret, return QR code as data URL + plaintext secret for manual entry. `POST /auth/mfa/confirm {code}` → validate first code → set `mfa_enabled=true`, store encrypted secret. |
| 12.6 | TOTP enforcement | Login flow update: if `users.mfa_enabled=true`, login returns `{mfa_required: true, mfa_token: <short-lived JWT, 5-min, scope=mfa_pending>}`. Client calls `POST /auth/mfa/verify {code}` with `mfa_token` → validate TOTP code → return full JWT. |
| 12.7 | Rate limiting | Chi middleware wrapping `/auth/*`. 5 requests/minute per IP for `POST /auth/login`, `POST /auth/forgot-password`, `POST /auth/mfa/verify`. Uses `golang.org/x/time/rate` token bucket. Returns `429 Too Many Requests` with `Retry-After` header. Note: per-process in-memory — correct at launch with one ECS task per service. If scaled to multiple tasks, replace with `go-redis/redis_rate` against an ElastiCache Redis instance. |
| 12.8 | Integration tests | OAuth user upsert (mock provider in test), password reset token expiry, TOTP enroll + verify round-trip, MFA-gated login (two-step), rate limit 429 response. |

### DB additions

```sql
-- additions to users table
ALTER TABLE users ADD COLUMN oauth_provider text;        -- 'google' | 'apple' | null
ALTER TABLE users ADD COLUMN oauth_subject  text;        -- provider's user ID
ALTER TABLE users ADD COLUMN mfa_enabled    boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN mfa_secret     text;        -- AES-256 encrypted TOTP secret

-- new table
CREATE TABLE password_reset_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id),
  token_hash  text NOT NULL,   -- bcrypt hash of the raw token sent in email
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
```

**TOTP secret encryption:** TOTP secrets are encrypted with AES-256-GCM before storage using a key from Secrets Manager. The key is never stored in the DB.

### OAuth user flows

```
Existing email/password user hits "Sign in with Google"
  → Google returns email matching existing account
  → Link OAuth to existing user (set oauth_provider, oauth_subject)
  → Issue JWT as normal

New user hits "Sign in with Google"
  → No matching email
  → Create new user (role selection required on first login)
  → Issue JWT
```

---

## E13 — Stripe Payments

**Goal:** Artist and organiser subscriptions managed via Stripe Checkout and Customer Portal. No custom payment UI built in-house.

### Pricing

**Artist tiers**

| Tier | Annual | Monthly | Features |
|------|--------|---------|----------|
| Basic | £15/yr | £2/mo | 1 collection |
| Pro | £25/yr | £4/mo | 5 collections |

No free tier. Every artist account requires an active subscription. This prevents bot account creation.

**Organiser charges (flat rate, no size tiers)**

| Charge | Amount | Type | When |
|--------|--------|------|------|
| Setup fee | £35 | One-time | On account creation |
| Festival month | £99 | One-time per festival | When organiser publishes/activates a festival |
| Annual listing | £49/yr | Recurring yearly | Starts after the festival month ends; keeps the festival page and data live |

Rationale: event organisers typically run one or two festivals a year. Predictable one-time costs are easier to get approved by fundraisers and committees than open-ended monthly subscriptions.

### Sub-issues

| # | Title | Notes |
|---|-------|-------|
| 13.1 | Stripe account + webhook endpoint | Stripe account setup. `POST /billing/webhook` with Stripe-Signature header verification (`stripe.ConstructEvent`). Register webhook in Stripe dashboard pointing to production + staging URLs. |
| 13.2 | Artist products in Stripe | Two Products: `artist_basic`, `artist_pro`. Each with two Prices: annual (£15/£25) and monthly (£2/£4). Price IDs stored in env config, not hardcoded. |
| 13.3 | Organiser products in Stripe | Three Products: `organiser_setup` (one-time, £35), `festival_month` (one-time, £99), `festival_annual` (recurring yearly, £49). Price IDs stored in env config. |
| 13.4 | DB schema | `subscriptions` table + `stripe_customer_id` on users. |
| 13.5 | Artist checkout | `POST /billing/artist/checkout {priceId}` → Stripe Checkout session (subscription mode) → return `{checkoutUrl}`. Success redirects to `/dashboard?billing=success`. |
| 13.6 | Organiser checkout — setup | `POST /billing/organiser/setup-checkout` → Stripe Checkout session (payment mode, £35) → on `checkout.session.completed` webhook, mark organiser account active. |
| 13.6b | Organiser checkout — festival activation | `POST /billing/festival/{id}/activate-checkout` → Stripe Checkout session (payment mode, £99) → on `checkout.session.completed`, mark festival as published and start a £49/yr recurring subscription (`festival_annual`) via Stripe Subscription API, beginning after the festival end date. |
| 13.7 | Webhook handler | `customer.subscription.created` → insert/update `subscriptions`. `customer.subscription.updated` → update plan/status. `customer.subscription.deleted` → mark inactive. `invoice.payment_failed` → mark `past_due`. All idempotent (Stripe may retry). |
| 13.8 | Customer Portal | `POST /billing/portal` → Stripe Customer Portal session URL → return `{portalUrl}`. User lands on Stripe-hosted page to manage/cancel. No custom billing UI needed. |
| 13.9 | Tier enforcement middleware | Chi middleware reads `subscriptions` for authenticated user from DB (cached in request context). Attaches `plan` to context. Endpoints/handlers check: Pro feature with Basic plan → `403 {code: "upgrade_required"}`. |
| 13.10 | Web billing pages | Artist dashboard: pricing page with Basic/Pro comparison + upgrade CTA. Billing section: current plan, next renewal date, "Manage billing" button → portal. Organiser: billing section with same pattern. |
| 13.11 | Tests | Integration tests with Stripe CLI (`stripe listen --forward-to localhost:8080/billing/webhook`) for webhook event handling. Unit tests for tier enforcement middleware. |

### DB schema

```sql
ALTER TABLE users ADD COLUMN stripe_customer_id text;

-- Recurring subscriptions (artist tiers + festival annual listing)
CREATE TABLE subscriptions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  uuid NOT NULL REFERENCES users(id),
  festival_id              uuid REFERENCES festivals(id),   -- null for artist subs; set for festival_annual
  stripe_subscription_id   text UNIQUE,
  stripe_price_id          text NOT NULL,
  plan                     text NOT NULL,   -- 'artist_basic' | 'artist_pro' | 'festival_annual'
  billing_interval         text NOT NULL,   -- 'month' | 'year'
  status                   text NOT NULL,   -- 'active' | 'past_due' | 'canceled' | 'incomplete'
  current_period_end       timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

-- One-time charges (organiser setup fee + festival month activation fee)
CREATE TABLE organiser_payments (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     uuid NOT NULL REFERENCES users(id),
  festival_id                 uuid REFERENCES festivals(id),   -- null for setup fee
  stripe_checkout_session_id  text UNIQUE,
  stripe_payment_intent_id    text,
  charge_type                 text NOT NULL,   -- 'setup_fee' | 'festival_month'
  amount_pence                integer NOT NULL,
  status                      text NOT NULL,   -- 'pending' | 'paid' | 'failed'
  paid_at                     timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now()
);
```

---

## What closes

| Issue | Title | Reason |
|-------|-------|--------|
| #10 | [Epic] E10 — Phase 2 prep (planning) | Superseded by E11–E13 |
| #77 | [E10.1] AWS infra plan | Absorbed into E11 |
| #78 | [E10.2] Stream Chat integration plan | Deferred — not part of production readiness scope |
| #79 | [E10.3] Analytics events plan | Deferred |
| #80 | [E10.4] Magazine integration plan | Deferred |
| #81 | [E10.5] Stripe integration plan | Absorbed into E13 |
| #82 | [E10.6] Deployment readiness checklist | Absorbed into E11 |

Stream Chat, analytics, and magazine remain on the backlog but are not part of this epic set.

---

## Out of scope

- Mobile app — deferred until closer to first hosted festival
- Stream Chat integration — deferred
- Analytics event pipeline — deferred
- Magazine/Substack integration — deferred
- Admin dashboard — use DB/AWS Console directly post-launch; custom admin is Year 2
- Custom error tracking (Sentry) — CloudWatch Logs covers launch needs; add post-launch if needed
- Offline map support — Year 2
