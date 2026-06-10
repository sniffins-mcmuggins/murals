package main

import (
	"context"
	"log"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sniffins-mcmuggins/render/api/internal/artist"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

func main() {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://render:render@localhost:5432/render?sslmode=disable"
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		log.Fatalf("connect: %v", err)
	}
	defer pool.Close()

	q := sqlcdb.New(pool)
	profiles, err := q.ListAllPublicProfilesForBackfill(ctx)
	if err != nil {
		log.Fatalf("list public profiles: %v", err)
	}
	var ok, failed int
	for _, p := range profiles {
		if err := artist.BackfillSnapshot(ctx, pool, p); err != nil {
			log.Printf("  FAILED %s (%s): %v", p.DisplayName, p.ID.String(), err)
			failed++
			continue
		}
		log.Printf("  snapshotted %s (%s)", p.DisplayName, p.ID.String())
		ok++
	}
	log.Printf("Backfill complete: %d ok, %d failed", ok, failed)
}
