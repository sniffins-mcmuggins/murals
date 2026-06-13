# db Spec
**Path:** `db/`
**Last updated:** 2026-05-31

## Contract
- `db/migrations/`: golang-migrate up/down SQL files, domain-grouped (`000001_users` … `000006_profile_snapshots`); current highest is `000006`
- `db/queries/`: sqlc input — SQL queries that `task db:generate` compiles to `api/internal/sqlcdb/*.sql.go`
- `db/seed/`: seed data for local development
- `api/internal/db/db.go`: `db.Open(ctx, url)` — creates and validates a pgx connection pool
- `profile_snapshots(artist_profile_id uuid PK → artist_profiles(id) ON DELETE CASCADE, snapshot jsonb NOT NULL, published_at timestamptz)`: 1:1 with `artist_profiles`; PK enforces exactly one published snapshot per profile. Row is created on first publish and overwritten (upsert) on each subsequent publish-changes call.
- `artist_profiles.has_unpublished_changes boolean NOT NULL DEFAULT false`: dirty flag set by DB triggers; cleared to `false` in the same atomic transaction as a publish or publish-changes.

## Boundaries
- Does NOT contain Go business logic — only SQL
- Migration files once merged are IMMUTABLE — never edit a merged migration; write a new one
- `profile_snapshots` stores ONLY artist-authored content (profile fields + collections + images). Dynamic cross-entity data (spot history, endorsements, analytics) is never frozen into the snapshot — those are always live side-reads at query time.

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
- **Exactly one published snapshot per profile** — enforced by the PK on `profile_snapshots.artist_profile_id`. There is no multi-snapshot history table.
- **`has_unpublished_changes` is trigger-maintained, including on DELETE** — three DB triggers cover this: AFTER INSERT/UPDATE/DELETE on `collections` and `collection_images` set the owning profile's flag to `true`; BEFORE UPDATE on `artist_profiles` sets it to `true` only when an authored content column changes (the publish path writes the flag and snapshot in the same UPDATE, which must NOT re-trigger the dirty flag). DELETE on child rows is the primary reason triggers are used — `updated_at` on the parent row cannot detect child deletions.

## AI Context
- `db/migrations/`: numbered SQL files — current highest is `000006`
- `db/queries/`: one file per table or concern — edit here, then `task db:generate`
- `api/internal/sqlcdb/`: generated output — `models.go` has the struct definitions; `*.sql.go` has the query implementations
- `task db:migrate`: applies pending migrations against the running Docker DB
- `task db:generate`: runs sqlc to regenerate `api/internal/sqlcdb/` from `db/queries/`
- The dual concern (sqlc-generated code + migration SQL) is fully documented in `.claude/rules/sqlc-and-schema.md` — read that rule when touching anything here

## Changelog
2026-06-13 — pre-deploy migration consolidation: folded the decision-model shape directly into `000003_festivals` (no separate `000007`, no add-then-drop churn, no backfill). `applications` ships with `decision` (application_decision enum) + `released_at` and never had `status`/`staged_decision`; `festival_artists` ships with `source` (festival_artist_source enum) and never had `status`; `festivals` has no `decisions_released_at`. Release state is per-application (`released_at`), not a festival-level flag. Safe to rewrite because nothing is deployed.
2026-06-10 — E29: profile_snapshots table (1:1, PK, jsonb), has_unpublished_changes column, three triggers (collections/collection_images INSERT/UPDATE/DELETE + artist_profiles BEFORE UPDATE content guard). Documented snapshot boundary (authored content only) and dirty-flag trigger invariants.
2026-06-06 — Corrected stale migration count (filesystem highest is 000005, not 000016); added profile setup fields migration.
2026-05-31 — initial spec
