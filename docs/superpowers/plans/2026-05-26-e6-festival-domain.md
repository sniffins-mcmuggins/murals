# E6 — Festival & Application Domain — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the festival and application domain: festivals CRUD, festival_artists (map pins), application_forms (jsonb fields), applications (jsonb answers), review workflow, and festival map data endpoint.

**Architecture:** Four new DB tables (festivals, festival_artists, application_forms, applications) with four new SQL query files and corresponding sqlc-generated Go code. Handlers live in `api/internal/festival/` following the same patterns as `api/internal/artist/`.

**Tech Stack:** Go, chi router, pgx/v5, sqlc, testcontainers-go, golang-migrate, RFC 7807 problem+json errors via httperr package.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `db/migrations/000006_festivals.up.sql` | Create | festivals table + status enum |
| `db/migrations/000006_festivals.down.sql` | Create | Drop festivals |
| `db/migrations/000007_festival_artists.up.sql` | Create | festival_artists table + status enum |
| `db/migrations/000007_festival_artists.down.sql` | Create | Drop festival_artists |
| `db/migrations/000008_application_forms.up.sql` | Create | application_forms table |
| `db/migrations/000008_application_forms.down.sql` | Create | Drop application_forms |
| `db/migrations/000009_applications.up.sql` | Create | applications table + status enum |
| `db/migrations/000009_applications.down.sql` | Create | Drop applications |
| `db/queries/festivals.sql` | Create | Festival CRUD queries |
| `db/queries/festival_artists.sql` | Create | Map pin upsert/query |
| `db/queries/application_forms.sql` | Create | Form upsert/get |
| `db/queries/applications.sql` | Create | Application CRUD + status |
| `api/internal/sqlcdb/` | Regenerate | Run sqlc generate |
| `api/internal/festival/errors.go` | Create | isUniqueViolation, pgUUIDFromString |
| `api/internal/festival/testhelpers_test.go` | Create | Test DB helpers |
| `api/internal/festival/festival.go` | Create | Festival CRUD handlers |
| `api/internal/festival/festival_test.go` | Create | Festival handler tests |
| `api/internal/festival/form.go` | Create | Upsert/get form handlers |
| `api/internal/festival/form_test.go` | Create | Form handler tests |
| `api/internal/festival/application.go` | Create | Submit application handler |
| `api/internal/festival/application_test.go` | Create | Application handler tests |
| `api/internal/festival/review.go` | Create | List/accept/decline handlers |
| `api/internal/festival/review_test.go` | Create | Review handler tests |
| `api/internal/festival/map.go` | Create | Map data endpoint |
| `api/internal/festival/map_test.go` | Create | Map handler tests |
| `api/internal/festival/roundtrip_test.go` | Create | Full domain integration test |
| `api/cmd/api/main.go` | Modify | Wire 13 new routes |
| `openapi/openapi.yaml` | Modify | Add festival schemas + paths |

## Task Sequence

| # | Task | Depends on |
|---|------|-----------|
| 1 | DB migrations (000006–000009) | — |
| 2 | sqlc queries + code generation | 1 |
| 3 | Festival CRUD handlers | 2 |
| 4 | Application form handlers | 2 |
| 5 | Submit application handler | 2, 3, 4 |
| 6 | Review/accept/decline handlers | 2, 3, 4 |
| 7 | Festival map data handler | 2, 3 |
| 8 | Wire routes + OpenAPI | 3, 4, 5, 6, 7 |
| 9 | Domain roundtrip integration test | 8 |

## Task Files

- [Task 1: DB Migrations](e6/task1-migrations.md)
- [Task 2: sqlc Queries + Code Generation](e6/task2-queries.md)
- [Task 3: Festival CRUD Handlers](e6/task3-festival-handlers.md)
- [Task 4: Application Form Handlers](e6/task4-form-handlers.md)
- [Task 5: Submit Application Handler](e6/task5-submit-application.md)
- [Task 6: Review / Accept / Decline Handlers](e6/task6-review.md)
- [Task 7: Festival Map Data Handler](e6/task7-map.md)
- [Task 8: Wire Routes + OpenAPI](e6/task8-wire-openapi.md)
- [Task 9: Domain Roundtrip Integration Test](e6/task9-roundtrip.md)
