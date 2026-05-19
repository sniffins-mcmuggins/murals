// migrate applies or rolls back database migrations.
// Usage: go run ./cmd/migrate [up|down|version|new <name>]
package main

import (
	"errors"
	"fmt"
	"log/slog"
	"os"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/pgx/v5"
	_ "github.com/golang-migrate/migrate/v4/source/file"
)

func main() {
	direction := "up"
	if len(os.Args) > 1 {
		direction = os.Args[1]
	}

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://render:render@localhost:5432/render?sslmode=disable"
	}
	// golang-migrate pgx/v5 driver expects pgx5:// scheme
	pgxURL := "pgx5://" + dbURL[len("postgres://"):]

	migrationsPath := os.Getenv("MIGRATIONS_PATH")
	if migrationsPath == "" {
		migrationsPath = "../db/migrations"
	}

	m, err := migrate.New("file://"+migrationsPath, pgxURL)
	if err != nil {
		slog.Error("migrate init", "err", err)
		os.Exit(1)
	}
	defer m.Close()

	switch direction {
	case "up":
		err = m.Up()
	case "down":
		err = m.Steps(-1)
	case "version":
		v, dirty, verr := m.Version()
		if verr != nil {
			slog.Error("version", "err", verr)
			os.Exit(1)
		}
		fmt.Printf("version=%d dirty=%v\n", v, dirty)
		return
	default:
		slog.Error("unknown direction", "direction", direction)
		os.Exit(1)
	}

	if err != nil && !errors.Is(err, migrate.ErrNoChange) {
		slog.Error("migrate", "direction", direction, "err", err)
		os.Exit(1)
	}
	slog.Info("migrate done", "direction", direction)
}
