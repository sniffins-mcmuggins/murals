# sqlc + schema changes

When touching `db/migrations/`, `db/queries/`, or `api/internal/sqlcdb/`, load: @db/migrations @db/queries @api/internal/sqlcdb/models.go

This rule is about keeping migration SQL, query SQL, and generated Go code in lockstep — and avoiding the race conditions that turn first-touch INSERTs into 500s.

## Adding a column: every Scan must be updated

When you add a column to a table (say `users.session_version`), the change ripples through:

1. **Migration** (`db/migrations/000010_auth_upgrades.up.sql`): the `ALTER TABLE` + matching `DROP COLUMN` in the `.down.sql`.
2. **sqlc model** (`api/internal/sqlcdb/models.go`): a new struct field on the table's Go type.
3. **Every SELECT/UPDATE/INSERT-RETURNING that touches that table**: the query string's column list AND the `row.Scan(&i.X, &i.Y, ...)` call must both include the new column.

The sqlc generator does (2) and (3) automatically if you run `sqlc generate`. The footgun is hand-editing `*.sql.go` files (which happens when you don't have sqlc locally, or when you're in a worktree). After a hand edit, **grep for every `row.Scan(` in the affected `*.sql.go` file** and verify the field count matches. The compiler won't catch a missing `&i.NewField` — it'll just leave the field at zero value at runtime.

Concretely, for a new column `foo` on `users`:

```bash
# Both must show the same count, equal to the number of columns in users.
grep -c '&i\.' api/internal/sqlcdb/users.sql.go
grep -c '&i\.' api/internal/sqlcdb/password_reset.sql.go  # if it returns users.*
```

`password_reset.sql.go` is the classic gotcha — `UpdateUserPassword` returns `users.*` so it has to keep up with `users` columns even though it lives in a different generated file.

## ON CONFLICT for any INSERT that can race

If an INSERT can be executed by two requests in parallel against the same unique constraint, you have a race. First-touch OAuth callbacks, idempotency keys, "create if not exists" — all of these.

The fix is `ON CONFLICT (...) DO UPDATE SET ... RETURNING *`. Two subtleties:

### Partial unique indexes need the `WHERE` clause

`users_oauth_idx` is `CREATE UNIQUE INDEX ... ON users (oauth_provider, oauth_subject) WHERE oauth_provider IS NOT NULL`. Plain `ON CONFLICT (oauth_provider, oauth_subject)` will not match a partial index. You must write the matching WHERE:

```sql
ON CONFLICT (oauth_provider, oauth_subject) WHERE oauth_provider IS NOT NULL
DO UPDATE SET oauth_provider = EXCLUDED.oauth_provider
RETURNING *;
```

### `DO NOTHING` + `RETURNING` returns no row

`DO NOTHING` looks like the cleanest choice for "we don't actually want to modify on conflict" — but PostgreSQL doesn't return the existing row in that case, just an empty result, and your handler crashes on the empty `Scan`.

The idiom is `DO UPDATE SET <col> = EXCLUDED.<col>` where `<col>` is a no-op write (typically the same column you're conflicting on). It costs one trivial UPDATE; you get `RETURNING *` to behave.

## Schema migration order

`golang-migrate` runs up files in numeric order. Always check the highest-numbered existing migration before adding a new one. If you're editing an *unmerged* migration (still pre-PR), prefer editing it in place to keep the diff coherent — that's what we did for `000010_auth_upgrades.up.sql`. Once merged, never edit it: write a new migration.

The `.down.sql` must reverse the up exactly. New `DROP COLUMN`s and `DROP TABLE`s go in reverse order from the up. Forgetting this only bites in CI when migrate-down is tested.

## Pre-merge checklist

- [ ] New column: `ALTER TABLE` in both `.up.sql` and `.down.sql`.
- [ ] New column: struct field in `models.go` with `db:"…" json:"…"` tags.
- [ ] New column: every query (SELECT, UPDATE-RETURNING, INSERT-RETURNING) on that table lists the column in its column list AND its `row.Scan(&i.X, …)`.
- [ ] Cross-file check: any other `*.sql.go` returning the same table type (e.g. `password_reset.sql.go` returning `users.*`) is also updated.
- [ ] New unique-constrained INSERT that can race: uses `ON CONFLICT (...) WHERE ... DO UPDATE SET <col> = EXCLUDED.<col> RETURNING *`.
- [ ] If the unique index is partial: the `ON CONFLICT` includes the same `WHERE` clause.
- [ ] `task api:test` passes (testcontainers runs the migration and exercises the queries — this is the fast canary).
