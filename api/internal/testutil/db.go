package testutil

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"
)

// NewDB starts a throwaway Postgres container, runs migrations, and returns
// a connected pool. The container is stopped when t.Cleanup runs.
func NewDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	ctx := context.Background()

	c, err := postgres.Run(ctx,
		"postgres:16-alpine",
		postgres.WithDatabase("render_test"),
		postgres.WithUsername("render"),
		postgres.WithPassword("render"),
		testcontainers.WithWaitStrategy(
			wait.ForLog("database system is ready to accept connections").WithOccurrence(2),
		),
	)
	if err != nil {
		t.Fatalf("start postgres container: %v", err)
	}
	t.Cleanup(func() {
		if err := testcontainers.TerminateContainer(c); err != nil {
			t.Logf("terminate postgres: %v", err)
		}
	})

	dsn, err := c.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		t.Fatalf("get connection string: %v", err)
	}

	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("open pool: %v", err)
	}
	t.Cleanup(pool.Close)

	if err := runMigrations(ctx, dsn); err != nil {
		t.Fatalf("run migrations: %v", err)
	}

	return pool
}
