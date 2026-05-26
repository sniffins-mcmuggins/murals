# Contributing

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Go | ≥ 1.24 | [go.dev/dl](https://go.dev/dl/) |
| Node | ≥ 20 | [nodejs.org](https://nodejs.org/) |
| Docker | latest | [docs.docker.com](https://docs.docker.com/get-docker/) |
| Task | latest | `brew install go-task` (macOS) or [taskfile.dev/installation](https://taskfile.dev/installation/) |

## Quickstart

```bash
git clone https://github.com/sniffins-mcmuggins/murals.git
cd murals
task up        # start the full local stack
task e2e       # run end-to-end tests
task down      # stop the stack
```

The stack runs on:
- **API** — http://localhost:8080 (`/healthz` for health, `/metrics` for Prometheus)
- **Web** — http://localhost:3000
- **MinIO console** — http://localhost:9001 (user: `renderdev`, pass: `renderdev123`)
- **Prometheus** — http://localhost:9090

## All Taskfile commands

```
task --list
```

Key targets:

| Command | What it does |
|---------|-------------|
| `task up` | Start docker-compose stack |
| `task down` | Stop stack |
| `task test` | Run all tests (parallel) |
| `task lint` | Run all linters |
| `task generate` | Regenerate OpenAPI types + sqlc queries |
| `task db:migrate` | Apply pending migrations |
| `task db:new -- <name>` | Scaffold a new migration pair |
| `task db:seed` | Load seed data |
| `task openapi:gen` | Regenerate Go interfaces + TS client |
| `task e2e` | Run Playwright end-to-end tests |
| `task api:dev` | Go API with hot reload (outside Docker) |
| `task web:dev` | Next.js dev server (outside Docker) |

## Adding an endpoint

This project is **spec-first**. The flow is always:

1. **Edit `openapi/openapi.yaml`** — add your path, request/response schemas, and error refs
2. **Regenerate** — `task openapi:gen` updates `api/internal/openapi/api.gen.go` and `openapi/generated/client.ts`
3. **Implement the handler** — the generated `StrictServerInterface` will have your new method; implement it in the relevant `api/internal/<domain>/` package
4. **Add integration test** — use `api/internal/testutil.NewDB(t)` + `testutil.NewMinIO(t)` for a real DB/MinIO per test
5. **Check for drift** — `task openapi:diff` is the CI gate; it must produce no diff

Never edit `api/internal/openapi/api.gen.go` or `openapi/generated/client.ts` by hand — they are overwritten on every `task openapi:gen`.

## Adding a migration

```bash
task db:new -- add_users   # creates db/migrations/000001_add_users.up.sql + .down.sql
```

Edit both files, then:

```bash
task db:migrate       # apply
task db:migrate:down  # roll back if needed
```

Migrations run automatically in CI against a test Postgres container (testcontainers-go). Do not use `IF NOT EXISTS` guards — migrations are applied exactly once.

## CDN URL strategy (Phase 1 → Phase 2 swap)

Image CDN URLs are constructed via `image.PublicURL(cdnBase, s3Key string) string`.

| Environment | `CDN_BASE_URL` value | Points to |
|-------------|---------------------|-----------|
| Local dev | `http://localhost:9000/render-images` | MinIO S3 endpoint |
| Production (Phase 2) | `https://cdn.renderltd.com` | CloudFront distribution |

The Phase 1 → Phase 2 swap is a single env-var change — no code changes needed.

The `render-images` bucket is configured with `anonymous: download` by the `minio-init` service on `task up`, so local CDN URLs are publicly GETable without auth headers.

**To change the CDN base URL in dev:** set `CDN_BASE_URL` in the `api` service environment in `infra/docker-compose.yml`, or in a local `.env` file at the repo root.

## Generating sqlc queries

1. Write SQL in `db/queries/<domain>.sql` with sqlc annotations (`-- name: ... :one`)
2. Run `task db:generate` — generates type-safe Go into `api/internal/db/`
3. `db/sqlc.yaml` controls the output; do not edit generated files

## Branches and PRs

- Branch naming: `feat/<issue-id>-<slug>` (e.g. `feat/e3-auth`)
- One PR per issue or tightly related group of sub-issues
- CI must be green before merge
- PR body should reference the parent issue with `Closes #N`

**Definition of done** (from issues — copy into your PR description):
- [ ] Code + tests
- [ ] `task lint` passes
- [ ] `task test` passes
- [ ] Integration test added if endpoint
- [ ] OpenAPI spec updated if endpoint shape changed

## Running individual app tests

```bash
task api:test          # Go: go test ./... -race -count=1
task web:test          # Node: npm test (vitest)
task mobile:test       # Node: npm test (jest)
task api:test:unit     # Go: go test ./... -race -count=1 -short (skips integration)
```

## Sub-agent parallelism

Issues are scoped with **Blocked by:** and **Touches files:** fields. Before dispatching a sub-agent to a new issue, verify:
1. All issues in **Blocked by:** are closed
2. No currently in-flight issue lists an overlapping path in **Touches files:**

Label `good-first-subagent` marks well-scoped issues with minimal context requirements — ideal for first dispatch.

## Phase 2 prep

Issues #77–82 (E10) produce design notes for AWS deployment, Stream Chat, analytics, magazine, Stripe, and deployment readiness. These are planning only — no code. Work them alongside Phase 1 implementation.
