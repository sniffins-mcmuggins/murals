# Tech Stack Design

**Date:** 2026-05-18
**Status:** Approved
**Project:** Render — Paint Festival Platform

---

## Overview

Full-stack architecture for the Render platform: a browser-based management platform for artists and organisers, a public-facing React Native mobile app, and a Go REST API backend. All components are containerised for local/prod parity and end-to-end testability.

---

## Stack Summary

| Layer | Technology |
|-------|-----------|
| Backend API | Go (REST monolith) |
| Database | PostgreSQL 16 |
| Browser platform | Next.js (React) |
| Mobile app | React Native (no Expo) |
| Image storage | AWS S3 + CloudFront (MinIO locally) |
| Metrics | Prometheus (+ Grafana locally for dashboards) |
| Chat | Stream Chat |
| Hosting | AWS (ECS Fargate, RDS, S3, ALB, Route 53) |
| Auth | JWT (HTTP-only cookie for web, Authorization header for mobile) |
| API contract | OpenAPI spec → generated TypeScript types |

---

## Architecture

```
                    ┌─────────────────────────────────────────┐
                    │              AWS (Production)            │
                    │                                          │
Browser  ────HTTPS─▶│  ECS Fargate       ┌─── Next.js app     │
Mobile   ────HTTPS─▶│  ECS Fargate       ├─── Go REST API     │
                    │  RDS               ├─── PostgreSQL       │
                    │  S3 + CloudFront   ├─── Image storage    │
                    │  ECS Fargate       └─── Prometheus       │
                    └─────────────────────────────────────────┘

                    ┌─────────────────────────────────────────┐
                    │           Local (docker compose)         │
                    │                                          │
Browser  ────HTTP──▶│  next (container)  ┌─── Next.js app     │
RN dev   ────HTTP──▶│  api (container)   ├─── Go REST API     │
                    │  db (container)    ├─── PostgreSQL       │
                    │  minio (container) ├─── S3-compatible    │
                    │  prometheus        └─── Metrics          │
                    └─────────────────────────────────────────┘
```

- Next.js calls Go API directly — no Next.js API routes duplicating logic
- React Native calls Go API directly
- Stream Chat messages flow client ↔ Stream infrastructure; Go API only issues Stream user tokens
- Prometheus scrapes `/metrics` on the Go API

---

## Go API

Single binary, structured by domain:

```
/cmd/api
/internal
  /artist         → profiles, collections, QR codes, analytics
  /festival       → festival CRUD, map pins, application forms
  /application    → form submissions, review workflow
  /auth           → JWT issue/verify, user accounts
  /image          → S3 pre-signed URL generation
  /chat           → Stream Chat token generation
  /metrics        → Prometheus instrumentation
  /db             → sqlc-generated queries, migrations (golang-migrate)
/pkg              → shared types, middleware, config
```

**Key choices:**
- **sqlc** — write SQL, get type-safe Go functions. No ORM.
- **golang-migrate** — SQL migration files, runs as a one-off ECS task before API deploys
- **JWT** — stateless, works for both web (HTTP-only cookie) and mobile (Authorization header)
- **OpenAPI spec** — generated from Go API; TypeScript types generated for Next.js and React Native from this spec
- **Stream Chat** — Go API issues user tokens only; no message routing through the API

---

## Data Layer

```sql
users               -- id, email, password_hash, role (artist|organiser|admin), created_at
artist_profiles     -- user_id, bio, location, medium_tags[], tier, qr_code_url, deleted_at
collections         -- artist_id, name, description, cover_image_key, status, deleted_at
collection_images   -- collection_id, s3_key, caption, lat, lng, sort_order
festivals           -- organiser_id, name, slug, status, dates, location, lat, lng, deleted_at
festival_artists    -- festival_id, artist_id, pin_lat, pin_lng, w3w, status
application_forms   -- festival_id, fields jsonb, open_at, close_at, max_apps
applications        -- form_id, artist_id, answers jsonb, status, reviewed_at
analytics_events    -- artist_id, event_type, festival_id, occurred_at (append-only)
```

**Key decisions:**
- `answers jsonb` on applications — organiser-defined fields vary per festival; JSON avoids EAV or dynamic columns
- `medium_tags[]` as a Postgres array — queryable with `@>`, no join table needed
- `analytics_events` is append-only, never updated, anonymised at write time (no public visitor IDs)
- `festival_artists` holds pin coordinates and W3W address for accepted artists on a festival map
- Soft deletes via `deleted_at` on profiles and festivals — artists expect history to persist

---

## Next.js Browser Platform

```
/app
  /(public)
    /artists/[slug]           → artist profile (SSR, indexable)
    /festivals/[slug]         → festival page (SSR, indexable)
    /festivals/[slug]/map     → festival map (client component, Leaflet)
  /(auth)
    /login
    /signup
  /(artist)                   → authenticated artist dashboard
    /dashboard
    /profile
    /collections
    /analytics
    /applications
  /(organiser)                → authenticated organiser dashboard
    /dashboard
    /festivals/[id]
    /festivals/[id]/applications
    /festivals/[id]/map
/components
/lib
  /api.ts                     → typed fetch client (generated from OpenAPI spec)
  /auth.ts                    → JWT handling, session cookie
```

**Key decisions:**
- Public artist profiles and festival pages are SSR — SEO-indexable, server-side data fetching
- Everything behind auth is client-rendered
- Leaflet loaded as a client component (`dynamic(() => import('./Map'), { ssr: false })`)
- Auth via HTTP-only cookie containing JWT, set by Go API on login, read server-side for SSR

---

## React Native App

```
/src
  /screens
    /Home               → live festivals, featured artists
    /FestivalMap        → full-screen map (react-native-webview + local Leaflet HTML)
    /ArtistProfile      → bio, collections, QR scan landing
    /Discover           → Nearby / Local Artists / Random swipe
    /Community          → boards (Stream Chat React Native SDK)
  /navigation           → React Navigation (stack + tab)
  /lib
    /api.ts             → typed fetch client (same types as web, from OpenAPI spec)
    /auth.ts            → JWT stored in react-native-keychain
    /location.ts        → device GPS for Nearby mode
  /components
```

**Key decisions:**
- Maps via `react-native-webview` rendering a local HTML file with Leaflet — avoids RN map library complexity, identical behaviour to web, tile caching works inside WebView
- React Navigation — no Expo dependency
- Stream Chat React Native SDK — same Stream project as web
- JWT stored in `react-native-keychain` (no Expo SecureStore)
- Shared TypeScript API types generated from Go OpenAPI spec
- No artist/organiser management screens at launch — app is public-only

---

## Image Upload Flow

```
1. Client → Go API: POST /api/images/presign
   Response: { uploadUrl, s3Key }

2. Client → S3: PUT {uploadUrl} (binary, bypasses Go API)

3. Client → Go API: POST /api/images/confirm { s3Key, collectionId }
   Response: { cdnUrl }

4. CDN serves: https://cdn.renderltd.com/{s3Key}
```

- Go API never handles image bytes — no bandwidth cost, no memory pressure, no size limits
- Pre-signed URLs expire in 15 minutes
- MinIO locally — same pre-signed URL flow, different endpoint via env config
- CloudFront URL is derived from the stored `s3Key`

---

## Infrastructure

### Local (`docker-compose.yml`)

```yaml
services:
  api:        # Go binary, hot-reload via air
  web:        # Next.js (next dev)
  db:         # postgres:16
  minio:      # minio/minio — S3-compatible, console at :9001
  prometheus: # prom/prometheus
```

Single `docker compose up` starts the full stack. CI spins up this compose, runs Playwright e2e tests, tears down.

### Production (AWS)

| Component | Service | Notes |
|-----------|---------|-------|
| Go API | ECS Fargate | Docker image from ECR, behind ALB |
| Next.js | ECS Fargate | Docker image from ECR, behind ALB |
| PostgreSQL | RDS Postgres 16 | `db.t4g.micro` to start |
| Images | S3 + CloudFront | CloudFront for CDN delivery |
| Prometheus | ECS Fargate | Scrapes Go API `/metrics` |
| Secrets | AWS Secrets Manager | DB creds, Stream keys, JWT secret |
| DNS + TLS | Route 53 + ACM | HTTPS everywhere |
| Container registry | ECR | One repo per service |

### CI/CD

GitHub Actions: test → build Docker images → push to ECR → rolling ECS deploy. Migrations run as a one-off ECS task before the new API task starts.

---

## Outstanding Decisions (not in scope for this spec)

| Decision | Notes |
|----------|-------|
| Payment processor | Stripe most likely — design TBD |
| Chat provider pricing tier | Evaluate Stream vs usage at scale |
| Custom map layouts | Geographic map for pilot; indoor/venue layouts Year 2 |
| Offline map support | Would improve festival-day experience; design TBD |
| Artist commission marketplace | Year 2 feature |
