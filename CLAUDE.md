# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Status

In build. The application codebase exists and is the source of truth — a Go REST API, a Next.js browser platform, and a React Native public app, with an end-to-end test suite running against a Docker Compose stack. The static HTML demo is retained only for the CPF organiser meeting. Most "tech stack" decisions are now made *in code* (see What Exists and Key Technical Decisions); the genuinely-open ones are listed under Outstanding Tech Decisions below.

## What Exists

### Application codebase (source of truth)

| Path | Purpose |
|------|---------|
| `api/` | Go REST API. chi router, pgx + sqlc (`internal/sqlcdb`), JWT auth, Stripe billing, SES email, MinIO/S3 images. Entry point `cmd/api/main.go`. |
| `web/` | Next.js (App Router) browser platform for artists & organisers. Typed against the OpenAPI client (`@render/api-client`). |
| `mobile/` | React Native public app (no Expo). |
| `db/` | golang-migrate migrations, sqlc queries, seed data. |
| `openapi/` | OpenAPI spec + generated TS client. |
| `infra/` | docker-compose stack (api, web, db, minio, prometheus) + prometheus config. |
| `e2e/` | Vitest API gate (`e2e/api/`) + Playwright browser specs (`e2e/browser/`). |
| `Taskfile.yml` | Root task runner — `task up`, `task e2e`, `task db:migrate`, etc. |

### Planning & demo artefacts

| File | Purpose |
|------|---------|
| `README.md` | Canonical project reference — read this first every session |
| `cpf_demo.html` | Self-contained static demo for CPF organiser meeting. Leaflet.js + OpenStreetMap, real Cheltenham coordinates, no backend. |
| `project_board_v2.html` | Visual project overview / investor-facing document |
| `paint_festival_platform.pdf` | PDF version of overview for sharing |

### Working with the demo (`cpf_demo.html`)

Open directly in a browser — no server needed. All data is hardcoded JS (`ARTISTS` object, `CPF_QUESTIONS` array). Navigation buttons use real Google Maps and What3Words URLs. Accept/Decline interactions are JS-only state (no persistence).

**Before the CPF meeting:** replace `picsum.photos` placeholder images with real Cheltenham mural photos, and update `CPF_QUESTIONS` with actual CPF application questions.

## Product Architecture (Decided)

Three products sharing one platform:
1. **Public mobile app** — festival maps, artist discovery, QR scanning. No artist/organiser management at launch.
2. **Browser platform** — artist profiles, organiser dashboard, application management. Mobile-responsive but browser-first.
3. **Digital/print magazine** — Substack for digital (no custom CMS needed), external designer for print annual.

**Platform split rationale:** Keeps the app focused and simple. All management tooling stays in the browser at launch.

## Key Technical Decisions (Locked)

- **Maps:** Leaflet.js + OpenStreetMap (free, no API key for basic use)
- **Navigation out:** Google Maps, Apple Maps, What3Words (user preference remembered)
- **QR codes:** Branded, server-generated, encode artist profile URL (auto-updates on URL change), downloadable high-res PNG
- **Chat:** Embedded infrastructure (Stream / Sendbird / Pusher — not built in-house, not Discord)
- **Analytics:** Aggregated only, no individual user tracking — GDPR-clean
- **Artist pricing:** Free £10/yr, Pro £35/yr (5 collections), Pro+ £50/yr (unlimited)
- **Organiser pricing:** £35 setup fee + monthly subscription from go-live (£19/£49/£99 by festival size)

## Tech Stack (Decided — in code)

- **API:** Go + chi router, pgx pool, sqlc-generated queries, golang-migrate migrations
- **Web:** Next.js (App Router), React Query, OpenAPI-typed client
- **Mobile:** React Native (no Expo)
- **Payments:** Stripe (billing package wired end-to-end)
- **Image storage:** MinIO locally, S3 + CDN (`CDNBaseURL`) in prod
- **Auth:** JWT + `session_version` revocation, TOTP MFA, Google/Apple OAuth
- **Local stack:** Docker Compose (`infra/`), orchestrated via Taskfile

## Outstanding Tech Decisions (TBD)

Hosting target and chat/messaging provider (Stream / Sendbird / Pusher — embedded, not built in-house) remain undecided. Chat is not yet implemented. Don't assume or implement these without confirming with the user.

## Design System (Demo)

The demo establishes the visual identity — use it as reference for any UI work:

```
Colors:
  --ink:      #1A1A2E  (dark navy — primary dark)
  --amber:    #E8A838  (gold — primary accent)
  --clay:     #C45C3A  (terracotta — secondary accent)
  --offwhite: #FAF7F2  (warm white — background)
  --warm:     #F0EAE0  (warm grey — secondary background)
  --mid:      #8A8896  (mid grey — secondary text)
  --light:    #E2DDD6  (light grey — borders)

Typography:
  Cormorant Garamond (serif) — headings, artist bios, large numbers
  DM Sans — body text, UI labels
  DM Mono — badges, stats, monospace labels (uppercase, letter-spacing)
```

## Mission Constraint

Every feature must serve one of two goals: help an artist make a career, or help the public discover art. Features that don't serve either don't belong. Artists are the foundation — the platform is almost free for them by design.

## Pilot Timeline

- **CPF 2027** (Cheltenham Paint Festival, October 2027) — primary pilot, direct organiser relationship exists
- **Upfest 2027** (Bristol, May/June 2027) — secondary pilot, approach after CPF is confirmed
- Working platform needed by August/September 2027
