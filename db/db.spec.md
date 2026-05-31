# db Spec
**Path:** `db/`
**Last updated:** 2026-05-31

## Contract
- `db/migrations/`: golang-migrate up/down SQL files, numbered `000001_...` through `000016_...`
- `db/queries/`: sqlc input — SQL queries that `task db:generate` compiles to `api/internal/sqlcdb/*.sql.go`
- `db/seed/`: seed data for local development
- `api/internal/db/db.go`: `db.Open(ctx, url)` — creates and validates a pgx connection pool

## Boundaries
- Does NOT contain Go business logic — only SQL
- Migration files once merged are IMMUTABLE — never edit a merged migration; write a new one

## Key Decisions
- **golang-migrate for schema**: migrations run on `task db:migrate`; version tracked in `schema_migrations` table
- **sqlc for queries**: all DB queries go through sqlc-generated code in `api/internal/sqlcdb/` — no raw query strings in handlers; `task db:generate` regenerates after editing `db/queries/*.sql`
- **Partial unique indexes**: several unique indexes use `WHERE` clauses (e.g. `users_oauth_idx WHERE oauth_provider IS NOT NULL`); `ON CONFLICT` clauses in sqlc queries MUST include the same `WHERE` to match the partial index
- **`DO NOTHING` + `RETURNING` returns no row in Postgres**: always use `DO UPDATE SET col = EXCLUDED.col RETURNING *` for upsert-style operations — see sqlc-and-schema rule

## Invariants
- Every `.up.sql` MUST have a matching `.down.sql` that reverses it exactly
- Migration numbers must be strictly sequential — check the highest existing number before creating a new file
- After adding a column: every SELECT/UPDATE/INSERT-RETURNING in the affected `*.sql.go` files must be updated — `task db:generate` handles this automatically; hand-editing requires the grep-count check from sqlc-and-schema rule
- The `dirty` flag in `schema_migrations` indicates a failed partial migration — do not re-run until the state is manually fixed

## AI Context
- `db/migrations/`: numbered SQL files — current highest is `000016`
- `db/queries/`: one file per table or concern — edit here, then `task db:generate`
- `api/internal/sqlcdb/`: generated output — `models.go` has the struct definitions; `*.sql.go` has the query implementations
- `task db:migrate`: applies pending migrations against the running Docker DB
- `task db:generate`: runs sqlc to regenerate `api/internal/sqlcdb/` from `db/queries/`
- The dual concern (sqlc-generated code + migration SQL) is fully documented in `.claude/rules/sqlc-and-schema.md` — read that rule when touching anything here

## Changelog
2026-05-31 — initial spec
