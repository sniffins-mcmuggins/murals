# Phase 1 Build Plan

**Date:** 2026-05-19
**Status:** Approved (pending issue creation)
**Project:** Render — Paint Festival Platform
**Depends on:** [2026-05-18-tech-stack-design.md](2026-05-18-tech-stack-design.md)

---

## Purpose

Decompose the approved tech-stack design into a phased, parallelisable set of GitHub issues whose terminal state is a fully working **local** end-to-end product. Deployment to AWS is explicitly Phase 2, but every Phase 1 decision is made so Phase 2 is "wire it up", not "rebuild it".

This spec is the source of truth for the issue tree. Each issue links back to the relevant section here.

---

## Phase 1 done-criteria

A developer clones the repo, runs `task up`, and can drive the following golden path through the running stack:

1. Artist signs up via the web app
2. Artist creates a profile, a collection, and uploads images
3. Organiser signs up via the web app
4. Organiser creates a festival and opens an application form
5. Artist applies via the web app
6. Organiser reviews and accepts the application
7. Accepted artist appears as a pin on the festival map
8. A public visitor (unauthenticated) views the festival page and the artist profile on **both** the Next.js web app and the React Native mobile app

**Out of scope for Phase 1:** Stream Chat, analytics dashboards, magazine, Stripe payments, AWS deployment. Their planning issues live in epic E10 so Phase 2 starts hot.

---

## Repo layout

Flat top-level dirs, root Taskfile orchestrating per-app Taskfiles. No monorepo tooling (Turbo/Nx) at this stage.

```
murals/
  api/                  # Go binary (cmd/api, internal/*)
    Taskfile.yml
  web/                  # Next.js app
    Taskfile.yml
  mobile/               # React Native (bare, no Expo)
    Taskfile.yml
  db/                   # migrations/, seeds/, sqlc.yaml
  openapi/              # openapi.yaml + generated TS client
  infra/                # docker-compose.yml, prometheus/, minio bootstrap
  docs/superpowers/specs/
  Taskfile.yml          # root orchestrator
  .github/workflows/
```

Root Taskfile exposes: `task up`, `task down`, `task test`, `task lint`, `task generate`, `task db:migrate`, `task db:seed`, `task openapi:gen`, `task e2e`.

---

## Foundational decisions (locked)

These fill gaps in the tech-stack spec that, left undecided, would block sub-agents mid-implementation.

| Area | Choice | Reason |
|------|--------|--------|
| Go HTTP router | `chi` | stdlib-style, minimal, idiomatic |
| Go logging | `log/slog` (stdlib) | zero-dep, structured |
| Go DB driver | `pgx/v5` | best-in-class for Postgres |
| Go hot reload | `air` | works inside docker-compose |
| Error response shape | RFC 7807 `application/problem+json` | OpenAPI-friendly standard |
| Request validation | `go-playground/validator` + OpenAPI types | covers what types can't |
| Password hashing | `bcrypt` (`x/crypto/bcrypt`) | standard |
| JWT lib | `golang-jwt/jwt v5` | active fork |
| OpenAPI workflow | Spec-first — `openapi/openapi.yaml` is source of truth | Generates Go server interfaces (`oapi-codegen`) and TS client types (`openapi-typescript`) |
| Frontend data layer | TanStack Query | one API for web + RN |
| Web styling | Tailwind + CSS variables for design tokens (CLAUDE.md palette) | tokens portable to RN |
| RN bundler | Metro (RN default) | no Expo per spec |
| Maps web | `react-leaflet` | matches existing demo |
| Maps RN | `react-native-webview` + local Leaflet HTML | per tech-stack spec |
| Lint/format | `golangci-lint`, ESLint + Prettier, TypeScript strict | CI-enforced |
| Pre-commit hooks | None — CI-only | keeps local fast, CI is the gate |
| Seed data | `db/seeds/*.sql` loaded via `task db:seed` | realistic CPF artists + a fake organiser |
| Image thumbnails | Phase 1: serve originals; Phase 2: CloudFront resizer | YAGNI for local |
| Test DB strategy | `testcontainers-go` for Postgres + MinIO | parallel-safe, no shared state |

---

## Test strategy

Layered, no hard coverage gate:

- **Go**: unit tests for business logic; integration tests hit a real Postgres + MinIO via `testcontainers-go`
- **Web**: component tests for non-trivial logic; Playwright e2e for golden paths
- **RN**: smoke tests only at this stage
- **CI**: all tests must pass to merge; coverage is reviewer judgement, not a number

---

## Epic breakdown

Each epic gets a tracking issue labelled `type:epic` with a checklist of its sub-issues. Sub-issues are scoped so a sub-agent can pick one up without coordinating with anyone working on a different epic.

### E1 — Foundation & repo skeleton
**Must land first; single agent.**
- 1.1 Monorepo layout + root Taskfile
- 1.2 `infra/docker-compose.yml` with `api`, `web`, `db`, `minio`, `prometheus`
- 1.3 `.github/workflows/ci.yml` — matrix: api (Go), web (Node), mobile (Node), e2e (Playwright against compose)
- 1.4 `openapi/openapi.yaml` skeleton + codegen Taskfile targets
- 1.5 `CONTRIBUTING.md` covering Taskfile usage, codegen workflow, branch hygiene

### E2 — Go API skeleton + DB harness
**Blocked by:** E1. Everything else blocks on parts of this.
- 2.1 Go module, `chi` router, slog setup, config via env
- 2.2 `golang-migrate` wiring + `task db:migrate`
- 2.3 `sqlc` wiring + `task db:generate`
- 2.4 `/healthz` + Prometheus `/metrics` endpoint
- 2.5 RFC 7807 error middleware + panic recovery
- 2.6 Integration test harness via `testcontainers-go`

### E3 — Auth & users
**Blocked by:** E2.
- 3.1 `users` migration + sqlc queries
- 3.2 `POST /auth/signup` (email/password, bcrypt)
- 3.3 `POST /auth/login` (issue JWT)
- 3.4 Auth middleware — reads cookie OR `Authorization: Bearer`
- 3.5 `GET /me`
- 3.6 Integration tests

### E4 — Image upload pipeline
**Blocked by:** E2. Parallel with E3.
- 4.1 MinIO bucket bootstrap
- 4.2 `POST /images/presign` (issues PUT URL, 15-min expiry)
- 4.3 `POST /images/confirm` (records `s3_key`, returns CDN URL)
- 4.4 Local "CDN" URL strategy (signed GET via MinIO for now)
- 4.5 Integration test: full upload round-trip

### E5 — Artist domain
**Blocked by:** E3, E4.
- 5.1 `artist_profiles` migration + queries
- 5.2 `collections` migration + queries
- 5.3 `collection_images` migration + queries
- 5.4 Artist profile endpoints (GET public, PATCH self)
- 5.5 Collection endpoints (CRUD)
- 5.6 Collection-image attach/reorder endpoints
- 5.7 Integration tests

### E6 — Festival & application domain
**Blocked by:** E3. Parallel with E5.
- 6.1 `festivals` migration + queries
- 6.2 `festival_artists` migration + queries
- 6.3 `application_forms` migration (jsonb fields) + queries
- 6.4 `applications` migration (jsonb answers) + queries
- 6.5 Festival endpoints (CRUD by organiser, GET public)
- 6.6 Application-form endpoints
- 6.7 Submit-application endpoint
- 6.8 Review/accept/decline endpoints
- 6.9 Festival map data endpoint (pins for accepted artists)
- 6.10 Integration tests

### E7 — Next.js web app
**Scaffold (7.1–7.2) blocked by E1; pages block on respective API endpoints.**
- 7.1 Next.js scaffold + TS strict + Tailwind + design tokens
- 7.2 Generated TS client + TanStack Query wrapper
- 7.3 Auth (login/signup, HTTP-only cookie handling for SSR)
- 7.4 Public artist profile page (SSR)
- 7.5 Public festival page (SSR)
- 7.6 Public festival map (client, react-leaflet)
- 7.7 Artist dashboard — profile + collections
- 7.8 Artist dashboard — applications view
- 7.9 Organiser dashboard — festival CRUD
- 7.10 Organiser dashboard — application review
- 7.11 Organiser dashboard — festival map editor (place pins)
- 7.12 Component-level tests for non-trivial logic

### E8 — React Native app
**Scaffold (8.1–8.4) blocked by E1; screens block on respective endpoints.**
- 8.1 RN bare scaffold (no Expo), TS strict, Metro config
- 8.2 React Navigation (tab + stack)
- 8.3 Auth + `react-native-keychain` JWT storage
- 8.4 API client (generated TS types, shared via path import)
- 8.5 Home screen (live festivals)
- 8.6 Festival map screen (WebView + local Leaflet HTML)
- 8.7 Artist profile screen (incl. QR landing)
- 8.8 Discover screen (Nearby + Random)
- 8.9 RN smoke test setup

### E9 — E2E test suite
**Blocked by:** enough of E5/E6/E7 to run golden paths.
- 9.1 Playwright config pointing at compose stack
- 9.2 Web e2e: artist signs up → creates profile + collection → uploads image
- 9.3 Web e2e: organiser creates festival → opens application form
- 9.4 Web e2e: artist applies → organiser accepts → pin on map
- 9.5 Web e2e: public visitor views festival + artist profile
- 9.6 API e2e: same happy path at HTTP level (runs first in CI, faster)
- 9.7 CI wires e2e into `.github/workflows/ci.yml`

### E10 — Phase 2 prep (planning only)
**Independent of all other epics.** Issues produce design notes, no code.
- 10.1 AWS infra plan (Terraform vs CDK decision + skeleton)
- 10.2 Stream Chat integration plan
- 10.3 Analytics events plan (write path, retention, anonymisation)
- 10.4 Magazine integration plan (Substack embed/links)
- 10.5 Stripe integration plan
- 10.6 Deployment readiness checklist (secrets, env, migrations, observability)

---

## Parallelism strategy

Sequencing waves — each box is independent within its wave:

```
Wave 0:  E1                                             ← single agent
            ↓
Wave 1:  E2  │  E7.1–7.2 scaffold  │  E8.1–8.4 scaffold ← 3 agents
            ↓
Wave 2:  E3  │  E4                 │  E10 (planning)    ← 3+ agents
            ↓
Wave 3:  E5  │  E6                                       ← 2 agents
            ↓
Wave 4:  E7.3–7.11  │  E8.5–8.8                          ← many agents
            ↓
Wave 5:  E9                                             ← 1–2 agents
```

Every sub-issue declares **Blocked by:** (issue numbers) and **Touches files:** (path globs). A coordinator can scan in-flight sub-issues to detect file-level collisions before dispatching the next.

---

## Issue conventions

### Labels
- **Type:** `type:epic`, `type:task`, `type:planning`
- **Area:** `area:api`, `area:web`, `area:mobile`, `area:db`, `area:infra`, `area:ci`, `area:openapi`, `area:e2e`
- **Phase:** `phase:1`, `phase:2`
- **Status:** `ready`, `blocked`, `in-progress`
- **Misc:** `good-first-subagent` (well-scoped, low-context tasks ideal for parallel pickup)

### Milestones
- `Phase 1 — Local E2E` — target for all E1–E9
- `Phase 2 — Deployment & Features` — E10 lands here; implementation issues added later

### Sub-issue body template
```markdown
## Goal
One sentence — what does done look like?

## Context
Links to relevant spec sections in docs/superpowers/specs/

## Scope
- [ ] checklist of concrete deliverables

## Out of scope
- explicit non-goals (prevents scope creep by sub-agents)

## Dependencies
- Blocked by: #X, #Y
- Touches files: api/internal/auth/**, db/migrations/0003_*

## Definition of done
- [ ] code + tests
- [ ] `task lint` passes
- [ ] `task test` passes
- [ ] integration test added if endpoint
- [ ] OpenAPI spec updated if endpoint shape changed

## Parent epic
#<epic-issue-number>
```

---

## Pre-work checklist

Before E1 is picked up:

**Repo hygiene**
- Verify `.gitignore` covers `.DS_Store`, `node_modules/`, `output/`, `videos/`
- Decide fate of `todo.md` (likely archive)
- Keep `cpf_demo.html`, `playwright/`, `demos/` as reference

**GitHub setup**
- Confirm `gh auth status` has `repo` + `issues:write`
- Enable branch protection on `main` **after** E1 lands
- Optional: `gh project create` to visualise waves

**Spec reconciliation**
- Existing feature specs (artist-profile, community-boards, organiser-festival-setup, public-app, magazine) remain as feature design references and are linked from the relevant epics
- `community-boards` and `magazine` are Phase 1.5+ — their specs stay, no issues yet

**Local dev sanity**
- `go` ≥ 1.22, `node` ≥ 20, working `docker`, `task` installed (E1.5 documents install if missing)

**Non-technical (parallel to E1)**
- Confirm domain registration for production
- Create Stream Chat free-tier account (for E10.2)
- Confirm AWS account access (for E10.1)

---

## Out of scope for this spec

- Detailed UX for dashboard screens — covered by the existing feature specs and refined per-sub-issue
- Phase 2 implementation issues — created once E10 planning issues land
- Choice of AWS IaC tool — deferred to E10.1
- Production observability beyond Prometheus scrape endpoint — Phase 2
