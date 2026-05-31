package testutil

import (
	"context"
	"fmt"
	"net/url"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"
)

var (
	pgOnce  sync.Once
	pgDSN   string
	pgErr   error
	pgDBSeq atomic.Int64
)

// sharedPostgresDSN starts a single Postgres container the first time it is
// called within a test binary (i.e. once per package). Subsequent calls return
// the cached DSN. The container is reaped by the Ryuk reaper when the binary exits.
func sharedPostgresDSN(ctx context.Context) (string, error) {
	pgOnce.Do(func() {
		c, err := postgres.Run(ctx,
			"postgres:16-alpine",
			postgres.WithDatabase("postgres"),
			postgres.WithUsername("render"),
			postgres.WithPassword("render"),
			testcontainers.WithWaitStrategy(
				wait.ForLog("database system is ready to accept connections").WithOccurrence(2),
			),
		)
		if err != nil {
			pgErr = err
			return
		}
		dsn, err := c.ConnectionString(ctx, "sslmode=disable")
		if err != nil {
			pgErr = err
			return
		}
		pgDSN = dsn
	})
	return pgDSN, pgErr
}

// NewDB returns a pool connected to a fresh, fully-migrated Postgres database.
//
// The first call per test binary starts a single shared container; every
// subsequent call creates an isolated database inside that container instead of
// spinning up a new one. This keeps per-test isolation while paying the
// container-start cost only once per package.
func NewDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	ctx := context.Background()

	baseDSN, err := sharedPostgresDSN(ctx)
	if err != nil {
		t.Fatalf("start shared postgres: %v", err)
	}

	n := pgDBSeq.Add(1)
	dbName := fmt.Sprintf("render_test_%d", n)

	adminPool, err := pgxpool.New(ctx, baseDSN)
	if err != nil {
		t.Fatalf("admin pool: %v", err)
	}
	_, createErr := adminPool.Exec(ctx, "CREATE DATABASE "+dbName)
	adminPool.Close()
	if createErr != nil {
		t.Fatalf("create database %s: %v", dbName, createErr)
	}

	testDSN := swapDatabase(baseDSN, dbName)
	if err := runMigrations(ctx, testDSN); err != nil {
		t.Fatalf("migrate %s: %v", dbName, err)
	}

	pool, err := pgxpool.New(ctx, testDSN)
	if err != nil {
		t.Fatalf("open pool %s: %v", dbName, err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func swapDatabase(dsn, dbName string) string {
	u, err := url.Parse(dsn)
	if err != nil {
		return dsn
	}
	u.Path = "/" + dbName
	return u.String()
}
