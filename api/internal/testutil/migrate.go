package testutil

import (
	"context"
	"fmt"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/pgx/v5"
	_ "github.com/golang-migrate/migrate/v4/source/file"
)

func runMigrations(_ context.Context, dsn string) error {
	m, err := migrate.New("file://../../../db/migrations", "pgx5://"+dsn[len("postgres://"):])
	if err != nil {
		return fmt.Errorf("new migrate: %w", err)
	}
	defer func() { _, _ = m.Close() }()
	if err := m.Up(); err != nil && err != migrate.ErrNoChange {
		return fmt.Errorf("migrate up: %w", err)
	}
	return nil
}
