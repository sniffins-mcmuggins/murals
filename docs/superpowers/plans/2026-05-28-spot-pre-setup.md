# Spot Pre-Setup & Artist Assignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the direct pin-on-artist map editor with a two-phase flow: organisers plot numbered wall spots first, then assign accepted artists to spots one by one.

**Architecture:** New `festival_spots` table owns coordinates and optional artist assignment. Six new API endpoints replace the old pin endpoint. The map editor page is rewritten as a sidebar (spots list + "Add spot") + map (amber/terracotta pins) + inline spot panel.

**Tech Stack:** Go/pgx/sqlc (API), Next.js + React + react-leaflet + TanStack Query (web), Playwright (e2e)

---

## File map

| Action | Path |
|--------|------|
| Create | `db/migrations/000007_festival_spots.up.sql` |
| Create | `db/migrations/000007_festival_spots.down.sql` |
| Create | `db/queries/festival_spots.sql` |
| Modify | `db/queries/festival_artists.sql` |
| Create | `api/internal/festival/spots.go` |
| Create | `api/internal/festival/spots_test.go` |
| Delete | `api/internal/festival/map_editor.go` |
| Delete | `api/internal/festival/map_editor_test.go` |
| Modify | `api/internal/festival/map.go` |
| Modify | `api/cmd/api/main.go` |
| Modify | `openapi/openapi.yaml` |
| Modify | `web/src/app/organiser/festivals/[id]/map/page.tsx` |
| Modify | `web/src/__tests__/organiser/map-editor-page.test.tsx` |
| Modify | `e2e/browser/map-pin-edit.spec.ts` |
| Modify | `e2e/fixtures/helpers.ts` |

---

## Task 1: Migration

**Files:**
- Create: `db/migrations/000007_festival_spots.up.sql`
- Create: `db/migrations/000007_festival_spots.down.sql`

- [ ] **Step 1: Write the up migration**

Create `db/migrations/000007_festival_spots.up.sql`:

```sql
CREATE TABLE festival_spots (
    id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    festival_id uuid         NOT NULL REFERENCES festivals(id) ON DELETE CASCADE,
    number      int          NOT NULL,
    lat         numeric(9,6) NOT NULL,
    lng         numeric(9,6) NOT NULL,
    w3w         text,
    width_m     numeric(5,1),
    height_m    numeric(5,1),
    notes       text,
    artist_id   uuid         REFERENCES artist_profiles(id) ON DELETE SET NULL,
    created_at  timestamptz  NOT NULL DEFAULT now(),
    updated_at  timestamptz  NOT NULL DEFAULT now(),
    UNIQUE (festival_id, number)
);

CREATE UNIQUE INDEX festival_spots_artist_idx
    ON festival_spots (festival_id, artist_id)
    WHERE artist_id IS NOT NULL;

-- Migrate any existing pin data: one spot per festival_artist that has coords.
INSERT INTO festival_spots (festival_id, number, lat, lng, w3w, artist_id)
SELECT
    fa.festival_id,
    ROW_NUMBER() OVER (PARTITION BY fa.festival_id ORDER BY fa.created_at)::int AS number,
    fa.pin_lat,
    fa.pin_lng,
    fa.w3w,
    fa.artist_id
FROM festival_artists fa
WHERE fa.pin_lat IS NOT NULL AND fa.pin_lng IS NOT NULL;

ALTER TABLE festival_artists DROP COLUMN pin_lat;
ALTER TABLE festival_artists DROP COLUMN pin_lng;
ALTER TABLE festival_artists DROP COLUMN w3w;
```

- [ ] **Step 2: Write the down migration**

Create `db/migrations/000007_festival_spots.down.sql`:

```sql
ALTER TABLE festival_artists ADD COLUMN pin_lat numeric(9,6);
ALTER TABLE festival_artists ADD COLUMN pin_lng numeric(9,6);
ALTER TABLE festival_artists ADD COLUMN w3w text;

UPDATE festival_artists fa
SET pin_lat = fs.lat,
    pin_lng = fs.lng,
    w3w     = fs.w3w
FROM festival_spots fs
WHERE fs.festival_id = fa.festival_id
  AND fs.artist_id   = fa.artist_id;

DROP INDEX IF EXISTS festival_spots_artist_idx;
DROP TABLE festival_spots;
```

- [ ] **Step 3: Apply the migration**

```bash
task db:migrate
```

Expected: `migrate: no error` (or similar success output). No output to stderr.

- [ ] **Step 4: Verify the table exists**

```bash
docker compose -f infra/docker-compose.yml exec db \
  psql -U render -d render -c '\d festival_spots'
```

Expected: table description showing `id`, `festival_id`, `number`, `lat`, `lng`, `w3w`, `width_m`, `height_m`, `notes`, `artist_id`, `created_at`, `updated_at`.

Also verify the columns are gone from `festival_artists`:

```bash
docker compose -f infra/docker-compose.yml exec db \
  psql -U render -d render -c '\d festival_artists'
```

Expected: `pin_lat`, `pin_lng`, `w3w` are **not** in the output.

- [ ] **Step 5: Commit**

```bash
git add db/migrations/000007_festival_spots.up.sql \
        db/migrations/000007_festival_spots.down.sql
git commit -m "feat: add festival_spots migration"
```

---

## Task 2: sqlc queries + regenerate + remove old handlers

This task removes the old pin-on-artist queries and handlers in one shot so the codebase compiles throughout. Do all steps before running tests.

**Files:**
- Create: `db/queries/festival_spots.sql`
- Modify: `db/queries/festival_artists.sql`
- Delete: `api/internal/festival/map_editor.go`
- Delete: `api/internal/festival/map_editor_test.go`
- Modify: `api/internal/festival/map.go`
- Modify: `api/cmd/api/main.go`
- Modify: `openapi/openapi.yaml`

- [ ] **Step 1: Write `db/queries/festival_spots.sql`**

```sql
-- name: CreateFestivalSpot :one
INSERT INTO festival_spots (festival_id, number, lat, lng, w3w, width_m, height_m, notes)
VALUES (
    $1,
    COALESCE((SELECT MAX(number) FROM festival_spots WHERE festival_id = $1), 0) + 1,
    $2, $3, $4, $5, $6, $7
)
RETURNING *;

-- name: GetFestivalSpot :one
SELECT fs.id,
       fs.festival_id,
       fs.number,
       fs.lat,
       fs.lng,
       fs.w3w,
       fs.width_m,
       fs.height_m,
       fs.notes,
       fs.artist_id,
       fs.created_at,
       fs.updated_at,
       ap.display_name AS artist_name
FROM festival_spots fs
LEFT JOIN artist_profiles ap ON ap.id = fs.artist_id
WHERE fs.id = $1 AND fs.festival_id = $2;

-- name: GetFestivalSpots :many
SELECT fs.id,
       fs.festival_id,
       fs.number,
       fs.lat,
       fs.lng,
       fs.w3w,
       fs.width_m,
       fs.height_m,
       fs.notes,
       fs.artist_id,
       fs.created_at,
       fs.updated_at,
       ap.display_name AS artist_name
FROM festival_spots fs
LEFT JOIN artist_profiles ap ON ap.id = fs.artist_id
WHERE fs.festival_id = $1
ORDER BY fs.number;

-- name: UpdateFestivalSpot :one
UPDATE festival_spots
SET lat        = $3,
    lng        = $4,
    w3w        = $5,
    width_m    = $6,
    height_m   = $7,
    notes      = $8,
    updated_at = now()
WHERE id = $1 AND festival_id = $2
RETURNING *;

-- name: DeleteFestivalSpot :exec
DELETE FROM festival_spots WHERE id = $1 AND festival_id = $2;

-- name: SetFestivalSpotArtist :one
UPDATE festival_spots
SET artist_id  = $3,
    updated_at = now()
WHERE id = $1 AND festival_id = $2
RETURNING *;

-- name: ClearFestivalSpotArtist :one
UPDATE festival_spots
SET artist_id  = NULL,
    updated_at = now()
WHERE id = $1 AND festival_id = $2
RETURNING *;

-- name: GetUnassignedAcceptedArtists :many
SELECT fa.artist_id, ap.display_name AS name
FROM festival_artists fa
JOIN artist_profiles ap ON ap.id = fa.artist_id
WHERE fa.festival_id = $1
  AND fa.status = 'accepted'
  AND NOT EXISTS (
    SELECT 1 FROM festival_spots fs
    WHERE fs.festival_id = $1 AND fs.artist_id = fa.artist_id
  )
ORDER BY ap.display_name;

-- name: GetFestivalMapPins :many
SELECT fs.festival_id,
       fs.artist_id,
       fs.lat      AS pin_lat,
       fs.lng      AS pin_lng,
       fs.w3w,
       ap.display_name
FROM festival_spots fs
JOIN artist_profiles ap ON ap.id = fs.artist_id
WHERE fs.festival_id = $1
  AND fs.artist_id IS NOT NULL;
```

- [ ] **Step 2: Update `db/queries/festival_artists.sql`**

Remove the three queries that are no longer needed. The file should contain only `AddFestivalArtist` and `GetAcceptedArtistForFestival` when done. Replace the entire file content with:

```sql
-- name: AddFestivalArtist :one
INSERT INTO festival_artists (festival_id, artist_id, status)
VALUES ($1, $2, $3)
ON CONFLICT (festival_id, artist_id) DO UPDATE
    SET status = EXCLUDED.status, updated_at = now()
RETURNING *;

-- name: GetAcceptedArtistForFestival :one
SELECT fa.festival_id,
       fa.artist_id,
       ap.display_name
FROM festival_artists fa
JOIN artist_profiles ap ON ap.id = fa.artist_id
WHERE fa.festival_id = $1
  AND fa.artist_id = $2
  AND fa.status = 'accepted';
```

- [ ] **Step 3: Regenerate sqlc**

```bash
task db:generate
```

Expected: no errors. This creates `api/internal/sqlcdb/festival_spots.sql.go` and updates `api/internal/sqlcdb/festival_artists.sql.go`.

- [ ] **Step 4: Delete old map editor handler and test**

```bash
rm api/internal/festival/map_editor.go api/internal/festival/map_editor_test.go
```

- [ ] **Step 5: Update `api/internal/festival/map.go`**

`GetFestivalMapPins` now returns `artist_id` as `*pgtype.UUID` (nullable column in festival_spots). Update the loop to handle the pointer:

```go
package festival

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

type mapPin struct {
	ArtistID string  `json:"artist_id"`
	Name     string  `json:"name"`
	Lat      float64 `json:"lat"`
	Lng      float64 `json:"lng"`
	W3W      *string `json:"w3w,omitempty"`
}

type mapResponse struct {
	Pins []mapPin `json:"pins"`
}

// GetMapDataHandler handles GET /festivals/slug/{slug}/map. Public. Festival must be live.
func GetMapDataHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		slug := chi.URLParam(r, "slug")

		q := sqlcdb.New(pool)
		fest, err := q.GetFestivalBySlug(r.Context(), slug)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}

		if fest.Status != sqlcdb.FestivalStatusLive {
			httperr.NotFound(w)
			return
		}

		rows, err := q.GetFestivalMapPins(r.Context(), fest.ID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		pins := make([]mapPin, 0, len(rows))
		for _, row := range rows {
			if row.ArtistID == nil {
				continue
			}
			lat, _ := row.PinLat.Float64Value()
			lng, _ := row.PinLng.Float64Value()
			pin := mapPin{
				ArtistID: row.ArtistID.String(),
				Name:     row.DisplayName,
				Lat:      lat.Float64,
				Lng:      lng.Float64,
				W3W:      row.W3w,
			}
			pins = append(pins, pin)
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(mapResponse{Pins: pins})
	}
}
```

- [ ] **Step 6: Remove old routes from `api/cmd/api/main.go`**

Find and delete these two route registrations (they reference functions that no longer exist):

```go
r.Get("/festivals/{festivalID}/artists/accepted", festival.GetAcceptedArtistsHandler(pool))
r.Patch("/festivals/{festivalID}/artists/{artistID}/pin", festival.SetArtistPinHandler(pool))
```

- [ ] **Step 7: Remove old OpenAPI entries from `openapi/openapi.yaml`**

Remove the `AcceptedArtist` schema from `components/schemas` (lines ~460–478):

```yaml
    AcceptedArtist:
      type: object
      properties:
        artist_id:
          type: string
          format: uuid
        name:
          type: string
        pin_lat:
          type: number
          format: float
          nullable: true
        pin_lng:
          type: number
          format: float
          nullable: true
        w3w:
          type: string
          nullable: true
```

Remove the `/festivals/{festivalID}/artists/accepted` path block (~lines 1508–1537).

Remove the `/festivals/{festivalID}/artists/{artistID}/pin` path block (~lines 1539–end of that block).

- [ ] **Step 8: Verify it compiles**

```bash
cd api && go build ./...
```

Expected: no errors.

- [ ] **Step 9: Run API tests**

```bash
task api:test
```

Expected: all pass. The old `map_editor_test.go` is gone; existing `map_test.go` tests `GetMapDataHandler` and should still pass (it creates test data differently — check if it needs updating; if it inserts into `festival_artists` with pin data, update it to insert into `festival_spots` instead).

- [ ] **Step 10: Commit**

```bash
git add db/queries/festival_spots.sql db/queries/festival_artists.sql \
        api/internal/sqlcdb/ api/internal/festival/map.go \
        api/cmd/api/main.go openapi/openapi.yaml
git commit -m "feat: add festival_spots queries, remove old pin-on-artist handlers"
```

---

## Task 3: Spots API handlers + tests + routes + OpenAPI

**Files:**
- Create: `api/internal/festival/spots.go`
- Create: `api/internal/festival/spots_test.go`
- Modify: `api/cmd/api/main.go`
- Modify: `openapi/openapi.yaml`

- [ ] **Step 1: Write `api/internal/festival/spots.go`**

```go
package festival

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

// ─── response types ───────────────────────────────────────────────────────────

type spotResponse struct {
	ID         string   `json:"id"`
	Number     int32    `json:"number"`
	Lat        float64  `json:"lat"`
	Lng        float64  `json:"lng"`
	W3W        *string  `json:"w3w"`
	WidthM     *float64 `json:"width_m"`
	HeightM    *float64 `json:"height_m"`
	Notes      *string  `json:"notes"`
	ArtistID   *string  `json:"artist_id"`
	ArtistName *string  `json:"artist_name"`
}

type unassignedArtistResponse struct {
	ArtistID string `json:"artist_id"`
	Name     string `json:"name"`
}

type getSpotsResponse struct {
	Spots             []spotResponse             `json:"spots"`
	UnassignedArtists []unassignedArtistResponse `json:"unassigned_artists"`
}

// ─── numeric helpers ──────────────────────────────────────────────────────────

func numericFromFloat(f float64) (pgtype.Numeric, error) {
	var n pgtype.Numeric
	return n, n.Scan(strconv.FormatFloat(f, 'f', -1, 64))
}

func optFloatToNumeric(f *float64) *pgtype.Numeric {
	if f == nil {
		return nil
	}
	var n pgtype.Numeric
	if err := n.Scan(strconv.FormatFloat(*f, 'f', -1, 64)); err != nil {
		return nil
	}
	return &n
}

func numericToFloat64(n pgtype.Numeric) float64 {
	v, _ := n.Float64Value()
	return v.Float64
}

func optNumericToFloat64(n *pgtype.Numeric) *float64 {
	if n == nil || !n.Valid {
		return nil
	}
	v, err := n.Float64Value()
	if err != nil || !v.Valid {
		return nil
	}
	return &v.Float64
}

// ─── response builders ────────────────────────────────────────────────────────

func buildSpotResponse(
	id pgtype.UUID,
	number int32,
	lat, lng pgtype.Numeric,
	w3w, notes *string,
	widthM, heightM *pgtype.Numeric,
	artistID *pgtype.UUID,
	artistName *string,
) spotResponse {
	resp := spotResponse{
		ID:         id.String(),
		Number:     number,
		Lat:        numericToFloat64(lat),
		Lng:        numericToFloat64(lng),
		W3W:        w3w,
		WidthM:     optNumericToFloat64(widthM),
		HeightM:    optNumericToFloat64(heightM),
		Notes:      notes,
		ArtistName: artistName,
	}
	if artistID != nil {
		s := artistID.String()
		resp.ArtistID = &s
	}
	return resp
}

func toSpotResponse(row sqlcdb.GetFestivalSpotRow) spotResponse {
	return buildSpotResponse(row.ID, row.Number, row.Lat, row.Lng,
		row.W3w, row.Notes, row.WidthM, row.HeightM, row.ArtistID, row.ArtistName)
}

func toSpotResponseFromListRow(row sqlcdb.GetFestivalSpotsRow) spotResponse {
	return buildSpotResponse(row.ID, row.Number, row.Lat, row.Lng,
		row.W3w, row.Notes, row.WidthM, row.HeightM, row.ArtistID, row.ArtistName)
}

// ─── shared auth + ownership guard ───────────────────────────────────────────

func requireFestivalOwner(r *http.Request, w http.ResponseWriter, q *sqlcdb.Queries, festivalID string) (pgtype.UUID, bool) {
	principal, err := auth.User(r.Context())
	if err != nil {
		httperr.Unauthorized(w)
		return pgtype.UUID{}, false
	}
	festUUID, err := pgUUIDFromString(festivalID)
	if err != nil {
		httperr.BadRequest(w, "invalid festivalID")
		return pgtype.UUID{}, false
	}
	fest, err := q.GetFestivalByID(r.Context(), festUUID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httperr.NotFound(w)
		} else {
			httperr.InternalServerError(w)
		}
		return pgtype.UUID{}, false
	}
	if fest.OrganiserID.String() != principal.UserID {
		httperr.Forbidden(w)
		return pgtype.UUID{}, false
	}
	return festUUID, true
}

// ─── handlers ────────────────────────────────────────────────────────────────

// GetSpotsHandler handles GET /festivals/{festivalID}/spots.
func GetSpotsHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := sqlcdb.New(pool)
		festUUID, ok := requireFestivalOwner(r, w, q, chi.URLParam(r, "festivalID"))
		if !ok {
			return
		}
		spots, err := q.GetFestivalSpots(r.Context(), festUUID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}
		artists, err := q.GetUnassignedAcceptedArtists(r.Context(), festUUID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}
		spotResps := make([]spotResponse, len(spots))
		for i, s := range spots {
			spotResps[i] = toSpotResponseFromListRow(s)
		}
		artistResps := make([]unassignedArtistResponse, len(artists))
		for i, a := range artists {
			artistResps[i] = unassignedArtistResponse{ArtistID: a.ArtistID.String(), Name: a.Name}
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(getSpotsResponse{
			Spots:             spotResps,
			UnassignedArtists: artistResps,
		})
	}
}

// CreateSpotHandler handles POST /festivals/{festivalID}/spots.
func CreateSpotHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := sqlcdb.New(pool)
		festUUID, ok := requireFestivalOwner(r, w, q, chi.URLParam(r, "festivalID"))
		if !ok {
			return
		}
		var req struct {
			Lat     float64  `json:"lat"`
			Lng     float64  `json:"lng"`
			W3W     *string  `json:"w3w"`
			WidthM  *float64 `json:"width_m"`
			HeightM *float64 `json:"height_m"`
			Notes   *string  `json:"notes"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.BadRequest(w, "invalid request body")
			return
		}
		if req.Lat < -90 || req.Lat > 90 {
			httperr.BadRequest(w, "lat must be between -90 and 90")
			return
		}
		if req.Lng < -180 || req.Lng > 180 {
			httperr.BadRequest(w, "lng must be between -180 and 180")
			return
		}
		lat, err := numericFromFloat(req.Lat)
		if err != nil {
			httperr.BadRequest(w, "invalid lat")
			return
		}
		lng, err := numericFromFloat(req.Lng)
		if err != nil {
			httperr.BadRequest(w, "invalid lng")
			return
		}
		spot, err := q.CreateFestivalSpot(r.Context(), sqlcdb.CreateFestivalSpotParams{
			FestivalID: festUUID,
			Lat:        lat,
			Lng:        lng,
			W3w:        req.W3W,
			WidthM:     optFloatToNumeric(req.WidthM),
			HeightM:    optFloatToNumeric(req.HeightM),
			Notes:      req.Notes,
		})
		if err != nil {
			httperr.InternalServerError(w)
			return
		}
		full, err := q.GetFestivalSpot(r.Context(), sqlcdb.GetFestivalSpotParams{
			ID: spot.ID, FestivalID: festUUID,
		})
		if err != nil {
			httperr.InternalServerError(w)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(toSpotResponse(full))
	}
}

// UpdateSpotHandler handles PATCH /festivals/{festivalID}/spots/{spotID}.
func UpdateSpotHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := sqlcdb.New(pool)
		festUUID, ok := requireFestivalOwner(r, w, q, chi.URLParam(r, "festivalID"))
		if !ok {
			return
		}
		spotUUID, err := pgUUIDFromString(chi.URLParam(r, "spotID"))
		if err != nil {
			httperr.BadRequest(w, "invalid spotID")
			return
		}
		var req struct {
			Lat     float64  `json:"lat"`
			Lng     float64  `json:"lng"`
			W3W     *string  `json:"w3w"`
			WidthM  *float64 `json:"width_m"`
			HeightM *float64 `json:"height_m"`
			Notes   *string  `json:"notes"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.BadRequest(w, "invalid request body")
			return
		}
		if req.Lat < -90 || req.Lat > 90 {
			httperr.BadRequest(w, "lat must be between -90 and 90")
			return
		}
		if req.Lng < -180 || req.Lng > 180 {
			httperr.BadRequest(w, "lng must be between -180 and 180")
			return
		}
		lat, err := numericFromFloat(req.Lat)
		if err != nil {
			httperr.BadRequest(w, "invalid lat")
			return
		}
		lng, err := numericFromFloat(req.Lng)
		if err != nil {
			httperr.BadRequest(w, "invalid lng")
			return
		}
		if _, err = q.UpdateFestivalSpot(r.Context(), sqlcdb.UpdateFestivalSpotParams{
			ID: spotUUID, FestivalID: festUUID,
			Lat: lat, Lng: lng, W3w: req.W3W,
			WidthM: optFloatToNumeric(req.WidthM), HeightM: optFloatToNumeric(req.HeightM),
			Notes: req.Notes,
		}); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}
		full, err := q.GetFestivalSpot(r.Context(), sqlcdb.GetFestivalSpotParams{
			ID: spotUUID, FestivalID: festUUID,
		})
		if err != nil {
			httperr.InternalServerError(w)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(toSpotResponse(full))
	}
}

// DeleteSpotHandler handles DELETE /festivals/{festivalID}/spots/{spotID}.
func DeleteSpotHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := sqlcdb.New(pool)
		festUUID, ok := requireFestivalOwner(r, w, q, chi.URLParam(r, "festivalID"))
		if !ok {
			return
		}
		spotUUID, err := pgUUIDFromString(chi.URLParam(r, "spotID"))
		if err != nil {
			httperr.BadRequest(w, "invalid spotID")
			return
		}
		if err := q.DeleteFestivalSpot(r.Context(), sqlcdb.DeleteFestivalSpotParams{
			ID: spotUUID, FestivalID: festUUID,
		}); err != nil {
			httperr.InternalServerError(w)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// SetSpotArtistHandler handles PUT /festivals/{festivalID}/spots/{spotID}/artist.
func SetSpotArtistHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := sqlcdb.New(pool)
		festUUID, ok := requireFestivalOwner(r, w, q, chi.URLParam(r, "festivalID"))
		if !ok {
			return
		}
		spotUUID, err := pgUUIDFromString(chi.URLParam(r, "spotID"))
		if err != nil {
			httperr.BadRequest(w, "invalid spotID")
			return
		}
		var req struct {
			ArtistID string `json:"artist_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.BadRequest(w, "invalid request body")
			return
		}
		artistUUID, err := pgUUIDFromString(req.ArtistID)
		if err != nil {
			httperr.BadRequest(w, "invalid artist_id")
			return
		}
		// Verify artist is accepted for this festival.
		if _, err = q.GetAcceptedArtistForFestival(r.Context(), sqlcdb.GetAcceptedArtistForFestivalParams{
			FestivalID: festUUID, ArtistID: artistUUID,
		}); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.UnprocessableEntity(w, "artist is not accepted for this festival")
				return
			}
			httperr.InternalServerError(w)
			return
		}
		if _, err = q.SetFestivalSpotArtist(r.Context(), sqlcdb.SetFestivalSpotArtistParams{
			ID: spotUUID, FestivalID: festUUID, ArtistID: &artistUUID,
		}); err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == "23505" {
				httperr.Write(w, http.StatusConflict, "Conflict", "artist already assigned to another spot")
				return
			}
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}
		full, err := q.GetFestivalSpot(r.Context(), sqlcdb.GetFestivalSpotParams{
			ID: spotUUID, FestivalID: festUUID,
		})
		if err != nil {
			httperr.InternalServerError(w)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(toSpotResponse(full))
	}
}

// ClearSpotArtistHandler handles DELETE /festivals/{festivalID}/spots/{spotID}/artist.
func ClearSpotArtistHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := sqlcdb.New(pool)
		festUUID, ok := requireFestivalOwner(r, w, q, chi.URLParam(r, "festivalID"))
		if !ok {
			return
		}
		spotUUID, err := pgUUIDFromString(chi.URLParam(r, "spotID"))
		if err != nil {
			httperr.BadRequest(w, "invalid spotID")
			return
		}
		if _, err = q.ClearFestivalSpotArtist(r.Context(), sqlcdb.ClearFestivalSpotArtistParams{
			ID: spotUUID, FestivalID: festUUID,
		}); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}
		full, err := q.GetFestivalSpot(r.Context(), sqlcdb.GetFestivalSpotParams{
			ID: spotUUID, FestivalID: festUUID,
		})
		if err != nil {
			httperr.InternalServerError(w)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(toSpotResponse(full))
	}
}
```

- [ ] **Step 2: Write failing tests in `api/internal/festival/spots_test.go`**

```go
package festival_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/festival"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

type spotsScenario struct {
	orgToken        string
	orgID           string
	festID          string
	artistProfileID string
}

func setupSpotsScenario(t *testing.T, db *pgxpool.Pool) spotsScenario {
	t.Helper()
	orgID, orgToken := createTestUser(t, db, "spotorg@example.com")
	festID := createTestFestival(t, db, orgID, "spot-festival", "open")
	artistUserID, _ := createTestUser(t, db, "spotartist@example.com")
	artistProfileID := createTestArtistProfile(t, db, artistUserID, "Spot Artist")
	q := sqlcdb.New(db)
	_, err := q.AddFestivalArtist(context.Background(), sqlcdb.AddFestivalArtistParams{
		FestivalID: pgUUID(t, festID),
		ArtistID:   pgUUID(t, artistProfileID),
		Status:     sqlcdb.FestivalArtistStatusAccepted,
	})
	require.NoError(t, err)
	return spotsScenario{orgToken: orgToken, orgID: orgID, festID: festID, artistProfileID: artistProfileID}
}

func newSpotsServer(db *pgxpool.Pool) *httptest.Server {
	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Get("/festivals/{festivalID}/spots", festival.GetSpotsHandler(db))
	r.Post("/festivals/{festivalID}/spots", festival.CreateSpotHandler(db))
	r.Patch("/festivals/{festivalID}/spots/{spotID}", festival.UpdateSpotHandler(db))
	r.Delete("/festivals/{festivalID}/spots/{spotID}", festival.DeleteSpotHandler(db))
	r.Put("/festivals/{festivalID}/spots/{spotID}/artist", festival.SetSpotArtistHandler(db))
	r.Delete("/festivals/{festivalID}/spots/{spotID}/artist", festival.ClearSpotArtistHandler(db))
	return httptest.NewServer(r)
}

// ─── GetSpots ────────────────────────────────────────────────────────────────

func TestGetSpots_EmptyInitially(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupSpotsScenario(t, db)
	srv := newSpotsServer(db)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "GET", "/festivals/"+sc.festID+"/spots", "", sc.orgToken)
	require.Equal(t, http.StatusOK, resp.StatusCode)

	var body map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	_ = resp.Body.Close()

	assert.Empty(t, body["spots"])
	unassigned := body["unassigned_artists"].([]any)
	assert.Len(t, unassigned, 1, "accepted artist should appear as unassigned")
}

func TestGetSpots_RequiresAuth(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupSpotsScenario(t, db)
	srv := newSpotsServer(db)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "GET", "/festivals/"+sc.festID+"/spots", "", "")
	require.Equal(t, http.StatusUnauthorized, resp.StatusCode)
	_ = resp.Body.Close()
}

func TestGetSpots_ForbiddenForNonOwner(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupSpotsScenario(t, db)
	_, other := createTestUser(t, db, "spotsother@example.com")
	srv := newSpotsServer(db)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "GET", "/festivals/"+sc.festID+"/spots", "", other)
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	_ = resp.Body.Close()
}

// ─── CreateSpot ──────────────────────────────────────────────────────────────

func TestCreateSpot_CreatesNumberedSpot(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupSpotsScenario(t, db)
	srv := newSpotsServer(db)
	t.Cleanup(srv.Close)

	body := `{"lat":51.9007,"lng":-2.0783,"w3w":"filled.count.soap"}`
	resp := doRequest(t, srv, "POST", "/festivals/"+sc.festID+"/spots", body, sc.orgToken)
	require.Equal(t, http.StatusCreated, resp.StatusCode)

	var result map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&result))
	_ = resp.Body.Close()

	assert.Equal(t, float64(1), result["number"])
	assert.NotNil(t, result["id"])
	assert.InDelta(t, 51.9007, result["lat"], 0.0001)
	assert.Nil(t, result["artist_id"])
}

func TestCreateSpot_AutoIncrementsNumber(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupSpotsScenario(t, db)
	srv := newSpotsServer(db)
	t.Cleanup(srv.Close)

	doRequest(t, srv, "POST", "/festivals/"+sc.festID+"/spots",
		`{"lat":51.9,"lng":-2.07}`, sc.orgToken)
	resp2 := doRequest(t, srv, "POST", "/festivals/"+sc.festID+"/spots",
		`{"lat":51.91,"lng":-2.08}`, sc.orgToken)
	require.Equal(t, http.StatusCreated, resp2.StatusCode)

	var result map[string]any
	require.NoError(t, json.NewDecoder(resp2.Body).Decode(&result))
	_ = resp2.Body.Close()

	assert.Equal(t, float64(2), result["number"])
}

func TestCreateSpot_RejectsOutOfRangeCoordinates(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupSpotsScenario(t, db)
	srv := newSpotsServer(db)
	t.Cleanup(srv.Close)

	cases := []struct{ body, name string }{
		{`{"lat":91,"lng":0}`, "lat > 90"},
		{`{"lat":-91,"lng":0}`, "lat < -90"},
		{`{"lat":0,"lng":181}`, "lng > 180"},
		{`{"lat":0,"lng":-181}`, "lng < -180"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			resp := doRequest(t, srv, "POST", "/festivals/"+sc.festID+"/spots", tc.body, sc.orgToken)
			require.Equal(t, http.StatusBadRequest, resp.StatusCode)
			_ = resp.Body.Close()
		})
	}
}

// ─── UpdateSpot ──────────────────────────────────────────────────────────────

func TestUpdateSpot_UpdatesDetails(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupSpotsScenario(t, db)
	srv := newSpotsServer(db)
	t.Cleanup(srv.Close)

	createResp := doRequest(t, srv, "POST", "/festivals/"+sc.festID+"/spots",
		`{"lat":51.9,"lng":-2.07}`, sc.orgToken)
	require.Equal(t, http.StatusCreated, createResp.StatusCode)
	var created map[string]any
	require.NoError(t, json.NewDecoder(createResp.Body).Decode(&created))
	_ = createResp.Body.Close()
	spotID := created["id"].(string)

	updateBody := `{"lat":51.901,"lng":-2.071,"notes":"needs cherry picker","width_m":8,"height_m":6}`
	resp := doRequest(t, srv, "PATCH", "/festivals/"+sc.festID+"/spots/"+spotID, updateBody, sc.orgToken)
	require.Equal(t, http.StatusOK, resp.StatusCode)

	var result map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&result))
	_ = resp.Body.Close()

	assert.Equal(t, "needs cherry picker", result["notes"])
	assert.Equal(t, float64(8), result["width_m"])
}

// ─── DeleteSpot ──────────────────────────────────────────────────────────────

func TestDeleteSpot_Returns204(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupSpotsScenario(t, db)
	srv := newSpotsServer(db)
	t.Cleanup(srv.Close)

	createResp := doRequest(t, srv, "POST", "/festivals/"+sc.festID+"/spots",
		`{"lat":51.9,"lng":-2.07}`, sc.orgToken)
	var created map[string]any
	require.NoError(t, json.NewDecoder(createResp.Body).Decode(&created))
	_ = createResp.Body.Close()
	spotID := created["id"].(string)

	resp := doRequest(t, srv, "DELETE", "/festivals/"+sc.festID+"/spots/"+spotID, "", sc.orgToken)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	_ = resp.Body.Close()
}

// ─── SetSpotArtist ───────────────────────────────────────────────────────────

func TestSetSpotArtist_AssignsArtist(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupSpotsScenario(t, db)
	srv := newSpotsServer(db)
	t.Cleanup(srv.Close)

	createResp := doRequest(t, srv, "POST", "/festivals/"+sc.festID+"/spots",
		`{"lat":51.9,"lng":-2.07}`, sc.orgToken)
	var created map[string]any
	require.NoError(t, json.NewDecoder(createResp.Body).Decode(&created))
	_ = createResp.Body.Close()
	spotID := created["id"].(string)

	assignBody := `{"artist_id":"` + sc.artistProfileID + `"}`
	resp := doRequest(t, srv, "PUT", "/festivals/"+sc.festID+"/spots/"+spotID+"/artist", assignBody, sc.orgToken)
	require.Equal(t, http.StatusOK, resp.StatusCode)

	var result map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&result))
	_ = resp.Body.Close()

	assert.Equal(t, sc.artistProfileID, result["artist_id"])
	assert.Equal(t, "Spot Artist", result["artist_name"])
}

func TestSetSpotArtist_ConflictWhenAlreadyAssigned(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupSpotsScenario(t, db)
	srv := newSpotsServer(db)
	t.Cleanup(srv.Close)

	// Create two spots, assign artist to the first
	createSpot := func(lat string) string {
		r := doRequest(t, srv, "POST", "/festivals/"+sc.festID+"/spots",
			`{"lat":`+lat+`,"lng":-2.07}`, sc.orgToken)
		var m map[string]any
		require.NoError(t, json.NewDecoder(r.Body).Decode(&m))
		_ = r.Body.Close()
		return m["id"].(string)
	}
	spot1ID := createSpot("51.9")
	spot2ID := createSpot("51.91")

	body := `{"artist_id":"` + sc.artistProfileID + `"}`
	doRequest(t, srv, "PUT", "/festivals/"+sc.festID+"/spots/"+spot1ID+"/artist", body, sc.orgToken)

	// Assigning same artist to spot2 must return 409
	resp := doRequest(t, srv, "PUT", "/festivals/"+sc.festID+"/spots/"+spot2ID+"/artist", body, sc.orgToken)
	require.Equal(t, http.StatusConflict, resp.StatusCode)
	_ = resp.Body.Close()
}

func TestSetSpotArtist_422ForNonAcceptedArtist(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupSpotsScenario(t, db)

	// Add an uninvited artist (no festival_artists row)
	otherUserID, _ := createTestUser(t, db, "spotuninvited@example.com")
	otherProfileID := createTestArtistProfile(t, db, otherUserID, "Uninvited Artist")

	srv := newSpotsServer(db)
	t.Cleanup(srv.Close)

	createResp := doRequest(t, srv, "POST", "/festivals/"+sc.festID+"/spots",
		`{"lat":51.9,"lng":-2.07}`, sc.orgToken)
	var created map[string]any
	require.NoError(t, json.NewDecoder(createResp.Body).Decode(&created))
	_ = createResp.Body.Close()
	spotID := created["id"].(string)

	body := `{"artist_id":"` + otherProfileID + `"}`
	resp := doRequest(t, srv, "PUT", "/festivals/"+sc.festID+"/spots/"+spotID+"/artist", body, sc.orgToken)
	require.Equal(t, http.StatusUnprocessableEntity, resp.StatusCode)
	_ = resp.Body.Close()
}

// ─── ClearSpotArtist ─────────────────────────────────────────────────────────

func TestClearSpotArtist_UnassignsArtist(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupSpotsScenario(t, db)
	srv := newSpotsServer(db)
	t.Cleanup(srv.Close)

	createResp := doRequest(t, srv, "POST", "/festivals/"+sc.festID+"/spots",
		`{"lat":51.9,"lng":-2.07}`, sc.orgToken)
	var created map[string]any
	require.NoError(t, json.NewDecoder(createResp.Body).Decode(&created))
	_ = createResp.Body.Close()
	spotID := created["id"].(string)

	doRequest(t, srv, "PUT", "/festivals/"+sc.festID+"/spots/"+spotID+"/artist",
		`{"artist_id":"`+sc.artistProfileID+`"}`, sc.orgToken)

	resp := doRequest(t, srv, "DELETE", "/festivals/"+sc.festID+"/spots/"+spotID+"/artist", "", sc.orgToken)
	require.Equal(t, http.StatusOK, resp.StatusCode)

	var result map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&result))
	_ = resp.Body.Close()

	assert.Nil(t, result["artist_id"])
	assert.Nil(t, result["artist_name"])
}
```

- [ ] **Step 3: Run tests — expect failure (handlers exist but routes not wired yet)**

```bash
task api:test
```

Expected: `spots_test.go` tests **fail** because routes aren't registered yet. That is correct — proceed.

- [ ] **Step 4: Wire new routes in `api/cmd/api/main.go`**

Add inside the authenticated festival route group, after existing festival routes:

```go
r.Get("/festivals/{festivalID}/spots", festival.GetSpotsHandler(pool))
r.Post("/festivals/{festivalID}/spots", festival.CreateSpotHandler(pool))
r.Patch("/festivals/{festivalID}/spots/{spotID}", festival.UpdateSpotHandler(pool))
r.Delete("/festivals/{festivalID}/spots/{spotID}", festival.DeleteSpotHandler(pool))
r.Put("/festivals/{festivalID}/spots/{spotID}/artist", festival.SetSpotArtistHandler(pool))
r.Delete("/festivals/{festivalID}/spots/{spotID}/artist", festival.ClearSpotArtistHandler(pool))
```

- [ ] **Step 5: Run tests — expect pass**

```bash
task api:test
```

Expected: all pass.

- [ ] **Step 6: Add new schemas + paths to `openapi/openapi.yaml`**

Add to `components/schemas` (after the `MapPin` schema):

```yaml
    FestivalSpot:
      type: object
      required: [id, number, lat, lng]
      properties:
        id:
          type: string
          format: uuid
        number:
          type: integer
        lat:
          type: number
          format: float
        lng:
          type: number
          format: float
        w3w:
          type: string
          nullable: true
        width_m:
          type: number
          format: float
          nullable: true
        height_m:
          type: number
          format: float
          nullable: true
        notes:
          type: string
          nullable: true
        artist_id:
          type: string
          format: uuid
          nullable: true
        artist_name:
          type: string
          nullable: true

    UnassignedArtist:
      type: object
      required: [artist_id, name]
      properties:
        artist_id:
          type: string
          format: uuid
        name:
          type: string

    FestivalSpotsResponse:
      type: object
      required: [spots, unassigned_artists]
      properties:
        spots:
          type: array
          items:
            $ref: "#/components/schemas/FestivalSpot"
        unassigned_artists:
          type: array
          items:
            $ref: "#/components/schemas/UnassignedArtist"
```

Add to `paths` (at the end, before any final `---`):

```yaml
  /festivals/{festivalID}/spots:
    parameters:
      - name: festivalID
        in: path
        required: true
        schema:
          type: string
          format: uuid
    get:
      operationId: getFestivalSpots
      tags: [festival]
      summary: List spots with assignment status (map editor)
      security:
        - cookieAuth: []
        - bearerAuth: []
      responses:
        "200":
          description: All spots and unassigned accepted artists
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/FestivalSpotsResponse"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
        "404":
          $ref: "#/components/responses/NotFound"
    post:
      operationId: createFestivalSpot
      tags: [festival]
      summary: Create a new spot
      security:
        - cookieAuth: []
        - bearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [lat, lng]
              properties:
                lat:
                  type: number
                  format: float
                lng:
                  type: number
                  format: float
                w3w:
                  type: string
                  nullable: true
                width_m:
                  type: number
                  format: float
                  nullable: true
                height_m:
                  type: number
                  format: float
                  nullable: true
                notes:
                  type: string
                  nullable: true
      responses:
        "201":
          description: Created spot
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/FestivalSpot"
        "400":
          $ref: "#/components/responses/BadRequest"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"

  /festivals/{festivalID}/spots/{spotID}:
    parameters:
      - name: festivalID
        in: path
        required: true
        schema:
          type: string
          format: uuid
      - name: spotID
        in: path
        required: true
        schema:
          type: string
          format: uuid
    patch:
      operationId: updateFestivalSpot
      tags: [festival]
      summary: Update spot details
      security:
        - cookieAuth: []
        - bearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [lat, lng]
              properties:
                lat:
                  type: number
                  format: float
                lng:
                  type: number
                  format: float
                w3w:
                  type: string
                  nullable: true
                width_m:
                  type: number
                  format: float
                  nullable: true
                height_m:
                  type: number
                  format: float
                  nullable: true
                notes:
                  type: string
                  nullable: true
      responses:
        "200":
          description: Updated spot
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/FestivalSpot"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
        "404":
          $ref: "#/components/responses/NotFound"
    delete:
      operationId: deleteFestivalSpot
      tags: [festival]
      summary: Delete a spot (unassigns any assigned artist first)
      security:
        - cookieAuth: []
        - bearerAuth: []
      responses:
        "204":
          description: Deleted
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
        "404":
          $ref: "#/components/responses/NotFound"

  /festivals/{festivalID}/spots/{spotID}/artist:
    parameters:
      - name: festivalID
        in: path
        required: true
        schema:
          type: string
          format: uuid
      - name: spotID
        in: path
        required: true
        schema:
          type: string
          format: uuid
    put:
      operationId: setSpotArtist
      tags: [festival]
      summary: Assign an accepted artist to a spot
      security:
        - cookieAuth: []
        - bearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [artist_id]
              properties:
                artist_id:
                  type: string
                  format: uuid
      responses:
        "200":
          description: Updated spot
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/FestivalSpot"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
        "404":
          $ref: "#/components/responses/NotFound"
        "409":
          $ref: "#/components/responses/Conflict"
        "422":
          $ref: "#/components/responses/UnprocessableEntity"
    delete:
      operationId: clearSpotArtist
      tags: [festival]
      summary: Unassign the artist from a spot
      security:
        - cookieAuth: []
        - bearerAuth: []
      responses:
        "200":
          description: Updated spot with artist cleared
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/FestivalSpot"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
        "404":
          $ref: "#/components/responses/NotFound"
```

- [ ] **Step 7: Regenerate Go + TS clients**

```bash
task generate
```

Expected: `api/internal/openapi/api.gen.go` and `openapi/generated/client.ts` updated with new types.

- [ ] **Step 8: Verify build**

```bash
cd api && go build ./...
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add api/internal/festival/spots.go api/internal/festival/spots_test.go \
        api/cmd/api/main.go openapi/openapi.yaml \
        api/internal/openapi/api.gen.go openapi/generated/client.ts
git commit -m "feat: spots API — create, update, delete, assign artist"
```

---

## Task 4: Map editor UI rewrite + unit test

**Files:**
- Modify: `web/src/app/organiser/festivals/[id]/map/page.tsx`
- Modify: `web/src/__tests__/organiser/map-editor-page.test.tsx`

- [ ] **Step 1: Rewrite `web/src/app/organiser/festivals/[id]/map/page.tsx`**

```tsx
'use client'

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import icon from 'leaflet/dist/images/marker-icon.png'
import iconShadow from 'leaflet/dist/images/marker-shadow.png'
import Link from 'next/link'
import { apiClient } from '@/lib/api'
import type { components } from '@render/api-client'

type FestivalSpot = components['schemas']['FestivalSpot']
type FestivalSpotsResponse = components['schemas']['FestivalSpotsResponse']
type UnassignedArtist = components['schemas']['UnassignedArtist']

// Fix default Leaflet icon broken by webpack
const DefaultIcon = L.icon({
  iconUrl: (icon as { src: string }).src,
  shadowUrl: (iconShadow as { src: string }).src,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
})
L.Marker.prototype.options.icon = DefaultIcon

const AmberIcon = L.divIcon({
  className: '',
  html: '<div style="width:18px;height:18px;background:#E8A838;border-radius:50%;border:2.5px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3)"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
})

const TerracottaIcon = L.divIcon({
  className: '',
  html: '<div style="width:18px;height:18px;background:#C45C3A;border-radius:50%;border:2.5px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3)"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
})

// ─── Map click capture ────────────────────────────────────────────────────────

function MapClickCapture({ active, onMapClick }: { active: boolean; onMapClick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      if (active) onMapClick(e.latlng.lat, e.latlng.lng)
    },
  })
  return null
}

// ─── Spot panel ───────────────────────────────────────────────────────────────

type SpotPanelProps = {
  spot: FestivalSpot
  unassignedArtists: UnassignedArtist[]
  festivalId: string
  onClose: () => void
  onMutated: () => void
}

function SpotPanel({ spot, unassignedArtists, festivalId, onClose, onMutated }: SpotPanelProps) {
  const [lat, setLat] = useState(String(spot.lat ?? ''))
  const [lng, setLng] = useState(String(spot.lng ?? ''))
  const [w3w, setW3w] = useState(spot.w3w ?? '')
  const [widthM, setWidthM] = useState(spot.width_m != null ? String(spot.width_m) : '')
  const [heightM, setHeightM] = useState(spot.height_m != null ? String(spot.height_m) : '')
  const [notes, setNotes] = useState(spot.notes ?? '')
  const [artistId, setArtistId] = useState(spot.artist_id ?? '')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Rebuild local state when the spot prop changes (e.g. after another save)
  useEffect(() => {
    setLat(String(spot.lat ?? ''))
    setLng(String(spot.lng ?? ''))
    setW3w(spot.w3w ?? '')
    setWidthM(spot.width_m != null ? String(spot.width_m) : '')
    setHeightM(spot.height_m != null ? String(spot.height_m) : '')
    setNotes(spot.notes ?? '')
    setArtistId(spot.artist_id ?? '')
  }, [spot.id])

  const artistOptions: UnassignedArtist[] = spot.artist_id
    ? [{ artist_id: spot.artist_id, name: spot.artist_name ?? spot.artist_id }, ...unassignedArtists]
    : unassignedArtists

  async function handleSave() {
    setSaving(true)
    setSaveError(null)
    try {
      const latNum = parseFloat(lat)
      const lngNum = parseFloat(lng)
      if (isNaN(latNum) || isNaN(lngNum)) {
        setSaveError('Lat/lng must be valid numbers')
        return
      }

      // Update spot details
      const patchRes = await apiClient.PATCH('/festivals/{festivalID}/spots/{spotID}', {
        params: { path: { festivalID: festivalId, spotID: spot.id! } },
        body: {
          lat: latNum,
          lng: lngNum,
          w3w: w3w.trim() || null,
          width_m: widthM ? parseFloat(widthM) : null,
          height_m: heightM ? parseFloat(heightM) : null,
          notes: notes.trim() || null,
        },
      })
      if (patchRes.error) throw new Error('Failed to update spot')

      // Handle artist assignment change
      if (artistId && artistId !== spot.artist_id) {
        const putRes = await apiClient.PUT('/festivals/{festivalID}/spots/{spotID}/artist', {
          params: { path: { festivalID: festivalId, spotID: spot.id! } },
          body: { artist_id: artistId },
        })
        if (putRes.error) throw new Error('Failed to assign artist')
      } else if (!artistId && spot.artist_id) {
        const delRes = await apiClient.DELETE('/festivals/{festivalID}/spots/{spotID}/artist', {
          params: { path: { festivalID: festivalId, spotID: spot.id! } },
        })
        if (delRes.error) throw new Error('Failed to unassign artist')
      }

      onMutated()
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    setSaving(true)
    const res = await apiClient.DELETE('/festivals/{festivalID}/spots/{spotID}', {
      params: { path: { festivalID: festivalId, spotID: spot.id! } },
    })
    setSaving(false)
    if (res.error) {
      setSaveError('Failed to delete spot')
      return
    }
    onMutated()
    onClose()
  }

  return (
    <div className="mt-4 p-5 bg-warm border border-light rounded-lg" data-testid="spot-panel">
      <div className="flex justify-between items-start mb-3">
        <h2 className="font-serif text-xl text-ink">Spot {spot.number}</h2>
        <button onClick={onClose} className="font-sans text-xs text-mid hover:text-ink">✕</button>
      </div>

      <div className="space-y-3 max-w-sm">
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="font-sans text-xs text-mid block mb-1">Lat</label>
            <input value={lat} onChange={e => setLat(e.target.value)}
              className="w-full border border-light rounded-lg px-3 py-2 font-mono text-sm text-ink bg-offwhite focus:outline-none focus:border-amber" />
          </div>
          <div className="flex-1">
            <label className="font-sans text-xs text-mid block mb-1">Lng</label>
            <input value={lng} onChange={e => setLng(e.target.value)}
              className="w-full border border-light rounded-lg px-3 py-2 font-mono text-sm text-ink bg-offwhite focus:outline-none focus:border-amber" />
          </div>
        </div>

        <div>
          <label className="font-sans text-xs text-mid block mb-1">What3Words (optional)</label>
          <input value={w3w} onChange={e => setW3w(e.target.value)} placeholder="e.g. filled.count.soap"
            className="w-full border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite focus:outline-none focus:border-amber" />
        </div>

        <div className="flex gap-2">
          <div className="flex-1">
            <label className="font-sans text-xs text-mid block mb-1">Width (m)</label>
            <input value={widthM} onChange={e => setWidthM(e.target.value)} placeholder="—"
              className="w-full border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite focus:outline-none focus:border-amber" />
          </div>
          <div className="flex-1">
            <label className="font-sans text-xs text-mid block mb-1">Height (m)</label>
            <input value={heightM} onChange={e => setHeightM(e.target.value)} placeholder="—"
              className="w-full border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite focus:outline-none focus:border-amber" />
          </div>
        </div>

        <div>
          <label className="font-sans text-xs text-mid block mb-1">Notes (internal)</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
            placeholder="e.g. needs cherry picker"
            className="w-full border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite focus:outline-none focus:border-amber resize-none" />
        </div>

        <div>
          <label className="font-sans text-xs text-mid block mb-1">Artist</label>
          <select value={artistId} onChange={e => setArtistId(e.target.value)}
            className="w-full border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite focus:outline-none focus:border-amber">
            <option value="">— unassigned —</option>
            {artistOptions.map(a => (
              <option key={a.artist_id} value={a.artist_id ?? ''}>{a.name}</option>
            ))}
          </select>
        </div>

        {saveError && <p role="alert" className="font-sans text-sm text-clay">{saveError}</p>}

        <div className="flex gap-3 items-center">
          <button onClick={handleSave} disabled={saving}
            className="font-sans text-sm bg-amber text-ink font-medium px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={handleDelete} disabled={saving}
            className="font-sans text-sm text-clay hover:opacity-80 disabled:opacity-50">
            Delete spot
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Map editor ───────────────────────────────────────────────────────────────

function OrgFestivalMapEditor({ festivalId }: { festivalId: string }) {
  const queryClient = useQueryClient()
  const [placingSpot, setPlacingSpot] = useState(false)
  const [selectedSpotId, setSelectedSpotId] = useState<string | null>(null)
  const [placeError, setPlaceError] = useState<string | null>(null)

  const spotsQuery = useQuery({
    queryKey: ['spots', festivalId],
    queryFn: async () => {
      const res = await apiClient.GET('/festivals/{festivalID}/spots', {
        params: { path: { festivalID: festivalId } },
      })
      if (res.error) throw new Error('Failed to load spots')
      return res.data as FestivalSpotsResponse
    },
  })

  const createSpotMutation = useMutation({
    mutationFn: async ({ lat, lng }: { lat: number; lng: number }) => {
      const res = await apiClient.POST('/festivals/{festivalID}/spots', {
        params: { path: { festivalID: festivalId } },
        body: { lat, lng },
      })
      if (res.error) throw new Error('Failed to create spot')
      return res.data as FestivalSpot
    },
    onSuccess: (spot) => {
      queryClient.invalidateQueries({ queryKey: ['spots', festivalId] })
      setPlacingSpot(false)
      setSelectedSpotId(spot.id ?? null)
      setPlaceError(null)
    },
    onError: (e: Error) => setPlaceError(e.message),
  })

  function handleMapClick(lat: number, lng: number) {
    if (!placingSpot) return
    createSpotMutation.mutate({ lat, lng })
  }

  function handleMutated() {
    queryClient.invalidateQueries({ queryKey: ['spots', festivalId] })
  }

  const spots = spotsQuery.data?.spots ?? []
  const unassignedArtists = spotsQuery.data?.unassigned_artists ?? []
  const selectedSpot = spots.find(s => s.id === selectedSpotId) ?? null
  const assignedCount = spots.filter(s => s.artist_id).length

  const center: [number, number] = spots.length > 0
    ? [spots.reduce((s, p) => s + (p.lat ?? 0), 0) / spots.length,
       spots.reduce((s, p) => s + (p.lng ?? 0), 0) / spots.length]
    : [52.4, -1.5]
  const zoom = spots.length > 0 ? 15 : 6

  return (
    <div>
      <div className="mb-6">
        <Link href={`/organiser/festivals/${festivalId}`}
          className="font-mono text-xs text-mid uppercase tracking-widest hover:text-ink transition-colors">
          ← Festival
        </Link>
      </div>

      <h1 className="font-serif text-4xl text-ink mb-2">Map editor</h1>

      <div className="flex gap-6 items-start mt-4">
        {/* Sidebar */}
        <div className="w-56 flex-shrink-0">
          <button
            onClick={() => { setPlacingSpot(v => !v); setPlaceError(null) }}
            className={`w-full font-sans text-sm font-medium px-4 py-2 rounded-lg mb-4 transition-colors ${
              placingSpot
                ? 'bg-ink text-offwhite'
                : 'bg-amber text-ink hover:opacity-90'
            }`}
            data-testid="add-spot-btn"
          >
            {placingSpot ? 'Click map to place…' : '+ Add spot'}
          </button>

          {placeError && (
            <p role="alert" className="font-sans text-xs text-clay mb-3">{placeError}</p>
          )}

          {spots.length > 0 && (
            <ul className="space-y-1" data-testid="spots-list">
              {spots.map(s => (
                <li key={s.id}>
                  <button
                    onClick={() => setSelectedSpotId(s.id === selectedSpotId ? null : (s.id ?? null))}
                    className={`w-full text-left rounded-lg px-3 py-2 text-sm transition-colors ${
                      s.id === selectedSpotId
                        ? 'bg-amber/20 border border-amber'
                        : 'bg-warm border border-light hover:border-amber'
                    }`}
                  >
                    <span className="font-sans font-medium text-ink">Spot {s.number}</span>
                    <span className={`ml-2 font-mono text-xs uppercase tracking-widest px-1.5 py-0.5 rounded-full ${
                      s.artist_id ? 'bg-clay text-offwhite' : 'bg-amber/30 text-ink'
                    }`}>
                      {s.artist_id ? 'assigned' : 'empty'}
                    </span>
                    {s.artist_id && (
                      <div className="font-sans text-xs text-mid mt-0.5 truncate">{s.artist_name}</div>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {spots.length === 0 && !spotsQuery.isLoading && (
            <p className="font-sans text-xs text-mid">No spots yet.</p>
          )}

          {spots.length > 0 && (
            <p className="font-mono text-xs text-mid uppercase tracking-widest mt-3">
              {spots.length} spots · {assignedCount} assigned
            </p>
          )}
        </div>

        {/* Map */}
        <div className="flex-1">
          {spotsQuery.isError && (
            <p role="alert" className="font-sans text-sm text-clay mb-4">Failed to load spots.</p>
          )}

          {!spotsQuery.isLoading && (
            <div className="border border-light rounded-lg overflow-hidden" style={{ height: '500px' }}>
              <MapContainer center={center} zoom={zoom} className="w-full h-full bg-light">
                <TileLayer
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                />
                <MapClickCapture active={placingSpot} onMapClick={handleMapClick} />
                {spots.map(s => (
                  <Marker
                    key={s.id}
                    position={[s.lat ?? 0, s.lng ?? 0]}
                    icon={s.artist_id ? TerracottaIcon : AmberIcon}
                    eventHandlers={{ click: () => setSelectedSpotId(s.id === selectedSpotId ? null : (s.id ?? null)) }}
                  >
                    <Popup>
                      <span className="font-sans text-sm">
                        Spot {s.number}{s.artist_name ? ` — ${s.artist_name}` : ''}
                      </span>
                    </Popup>
                  </Marker>
                ))}
              </MapContainer>
            </div>
          )}

          {selectedSpot && (
            <SpotPanel
              spot={selectedSpot}
              unassignedArtists={unassignedArtists}
              festivalId={festivalId}
              onClose={() => setSelectedSpotId(null)}
              onMutated={handleMutated}
            />
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Page shell ───────────────────────────────────────────────────────────────

type Props = { params: Promise<{ id: string }> }

export default function OrgFestivalMapPage({ params }: Props) {
  const [festivalId, setFestivalId] = useState<string | null>(null)

  if (!festivalId) {
    params.then(p => setFestivalId(p.id))
    return <div className="font-sans text-mid text-sm p-8">Loading…</div>
  }

  return <OrgFestivalMapEditor festivalId={festivalId} />
}
```

- [ ] **Step 2: Rewrite `web/src/__tests__/organiser/map-editor-page.test.tsx`**

```tsx
import { vi, describe, it, expect, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('leaflet', () => ({
  default: {
    icon: vi.fn(() => ({})),
    divIcon: vi.fn(() => ({})),
    Marker: { prototype: { options: {} } },
  },
  icon: vi.fn(() => ({})),
  divIcon: vi.fn(() => ({})),
}))
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'map-container' }, children),
  TileLayer: () => null,
  Marker: ({ children, eventHandlers }: { children?: React.ReactNode; eventHandlers?: { click?: () => void } }) =>
    React.createElement('div', { 'data-testid': 'map-marker', onClick: eventHandlers?.click }, children),
  Popup: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'map-popup' }, children),
  useMapEvents: vi.fn(),
}))
vi.mock('leaflet/dist/leaflet.css', () => ({}))
vi.mock('leaflet/dist/images/marker-icon.png', () => ({ default: { src: '/marker-icon.png' } }))
vi.mock('leaflet/dist/images/marker-shadow.png', () => ({ default: { src: '/marker-shadow.png' } }))
vi.mock('@/lib/api', () => ({ apiClient: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn(), PUT: vi.fn() } }))
vi.mock('next/link', () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) =>
    React.createElement('a', { href, className }, children),
}))
vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
  useMutation: vi.fn().mockReturnValue({ mutate: vi.fn(), isPending: false }),
  useQueryClient: vi.fn().mockReturnValue({ invalidateQueries: vi.fn() }),
}))

import { useQuery } from '@tanstack/react-query'
import OrgFestivalMapPage from '@/app/organiser/festivals/[id]/map/page'

const mockUseQuery = vi.mocked(useQuery)
const mockParams = Promise.resolve({ id: 'fest-abc123' })

const spotsData = {
  spots: [
    { id: 'spot-1', number: 1, lat: 51.9007, lng: -2.0783, artist_id: null, artist_name: null },
    { id: 'spot-2', number: 2, lat: 51.901, lng: -2.079, artist_id: 'artist-1', artist_name: 'Rosa Vane' },
  ],
  unassigned_artists: [{ artist_id: 'artist-2', name: 'Kai Hollis' }],
}

describe('OrgFestivalMapPage', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('shows loading state before params resolve', () => {
    mockUseQuery.mockReturnValue({ data: undefined, isLoading: true, isError: false } as ReturnType<typeof useQuery>)
    render(React.createElement(OrgFestivalMapPage, { params: mockParams }))
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('renders map editor with spots list and Add spot button', async () => {
    mockUseQuery.mockReturnValue({ data: spotsData, isLoading: false, isError: false } as ReturnType<typeof useQuery>)
    render(React.createElement(OrgFestivalMapPage, { params: mockParams }))

    await waitFor(() => expect(screen.getByText('Map editor')).toBeInTheDocument())

    expect(screen.getByTestId('add-spot-btn')).toBeInTheDocument()
    expect(screen.getByTestId('spots-list')).toBeInTheDocument()
    expect(screen.getByText('Spot 1')).toBeInTheDocument()
    expect(screen.getByText('Spot 2')).toBeInTheDocument()
    expect(screen.getByText('Rosa Vane')).toBeInTheDocument()
    expect(screen.getByText('2 spots · 1 assigned')).toBeInTheDocument()
  })

  it('renders one marker per spot', async () => {
    mockUseQuery.mockReturnValue({ data: spotsData, isLoading: false, isError: false } as ReturnType<typeof useQuery>)
    render(React.createElement(OrgFestivalMapPage, { params: mockParams }))

    await waitFor(() => expect(screen.getByText('Map editor')).toBeInTheDocument())
    expect(screen.getAllByTestId('map-marker')).toHaveLength(2)
  })

  it('shows error state when spots fail to load', async () => {
    mockUseQuery.mockReturnValue({ data: undefined, isLoading: false, isError: true } as ReturnType<typeof useQuery>)
    render(React.createElement(OrgFestivalMapPage, { params: mockParams }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Failed to load spots.'))
  })

  it('clicking a spot in the sidebar opens the spot panel', async () => {
    mockUseQuery.mockReturnValue({ data: spotsData, isLoading: false, isError: false } as ReturnType<typeof useQuery>)
    render(React.createElement(OrgFestivalMapPage, { params: mockParams }))

    await waitFor(() => expect(screen.getByText('Spot 1')).toBeInTheDocument())
    await userEvent.click(screen.getByText('Spot 1'))

    expect(screen.getByTestId('spot-panel')).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run web tests**

```bash
task web:test
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add web/src/app/organiser/festivals/[id]/map/page.tsx \
        web/src/__tests__/organiser/map-editor-page.test.tsx
git commit -m "feat: rewrite map editor for spots-based flow"
```

---

## Task 5: E2E test update

**Files:**
- Modify: `e2e/fixtures/helpers.ts`
- Modify: `e2e/browser/map-pin-edit.spec.ts`

- [ ] **Step 1: Add spot helpers to `e2e/fixtures/helpers.ts`**

Locate the existing `setPin` helper and add these two helpers directly after it:

```ts
export async function createSpot(
  token: string,
  festivalId: string,
  lat: number,
  lng: number,
): Promise<{ spotId: string }> {
  const res = await fetch(`${API}/festivals/${festivalId}/spots`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ lat, lng }),
  })
  if (!res.ok) throw new Error(`createSpot failed: ${res.status} ${await res.text()}`)
  const data = (await res.json()) as { id: string }
  return { spotId: data.id }
}

export async function assignArtistToSpot(
  token: string,
  festivalId: string,
  spotId: string,
  artistId: string,
): Promise<void> {
  const res = await fetch(`${API}/festivals/${festivalId}/spots/${spotId}/artist`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ artist_id: artistId }),
  })
  if (!res.ok) throw new Error(`assignArtistToSpot failed: ${res.status} ${await res.text()}`)
}
```

Also remove the `setPin` import from any files that reference it (or leave it — it will be unused after the next step).

- [ ] **Step 2: Rewrite `e2e/browser/map-pin-edit.spec.ts`**

```ts
// Map editor spot flow.
//
// Covers: organiser pre-creates a spot via API, assigns an artist to it,
// opens the map editor, verifies the spot appears, and uses the UI to
// update the spot's notes.
import { test, expect, Browser } from '@playwright/test'
import {
  createArtist,
  createOrganiser,
  createProfile,
  createFestival,
  setFestivalStatus,
  upsertForm,
  submitApplication,
  acceptArtist,
  createSpot,
  assignArtistToSpot,
} from '../fixtures/helpers'

const API = process.env.API_URL ?? 'http://localhost:8080'

async function loginAs(browser: Browser, email: string, password: string, baseURL: string) {
  const ctx = await browser.newContext({ baseURL })
  const page = await ctx.newPage()
  await page.goto('/login')
  await page.fill('#email', email)
  await page.fill('#password', password)
  await page.click('button[type=submit]')
  await expect(page).toHaveURL('/dashboard')
  return { ctx, page }
}

test('organiser views and edits a pre-created spot', async ({ browser }) => {
  const suffix = `spot-${Date.now()}`
  const baseURL = process.env.BASE_URL ?? 'http://localhost:3000'

  // Arrange: festival, artist, acceptance, spot assignment
  const artist = await createArtist(suffix)
  await createProfile(artist.token, { displayName: `Spot Artist ${suffix}` })
  const organiser = await createOrganiser(suffix)
  const { festivalId, slug } = await createFestival(organiser.token, {
    name: `Spot Fest ${suffix}`,
    slug: `spot-${suffix}`,
  })
  await upsertForm(organiser.token, festivalId)
  await setFestivalStatus(organiser.token, festivalId, 'open')
  const { applicationId } = await submitApplication(artist.token, festivalId)
  await acceptArtist(organiser.token, festivalId, applicationId)

  // Get the artist profile ID from the spots endpoint
  const spotsRes = await fetch(`${API}/festivals/${festivalId}/spots`, {
    headers: { Authorization: `Bearer ${organiser.token}` },
  })
  expect(spotsRes.ok).toBe(true)
  const { unassigned_artists } = (await spotsRes.json()) as { unassigned_artists: { artist_id: string }[] }
  expect(unassigned_artists.length).toBe(1)
  const artistProfileId = unassigned_artists[0].artist_id

  // Create a spot and assign the artist via API
  const { spotId } = await createSpot(organiser.token, festivalId, 51.9007, -2.0783)
  await assignArtistToSpot(organiser.token, festivalId, spotId, artistProfileId)

  // Open map editor and verify the assigned spot is visible
  const { ctx, page } = await loginAs(browser, organiser.email, organiser.password, baseURL)
  try {
    await page.goto(`/organiser/festivals/${festivalId}/map`)
    await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 10_000 })

    // Spot appears in sidebar as assigned
    await expect(page.getByTestId('spots-list')).toBeVisible()
    await expect(page.getByText('assigned')).toBeVisible()

    // Click the spot in the sidebar to open the panel
    await page.getByText('Spot 1').click()
    await expect(page.getByTestId('spot-panel')).toBeVisible()

    // Update notes and save
    await page.getByPlaceholder('e.g. needs cherry picker').fill('corner of High St')
    await page.getByRole('button', { name: 'Save' }).click()

    // Panel stays open; save button returns to non-loading state
    await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled({ timeout: 5_000 })

    // Confirm via public map API that the spot is pinned correctly
    await setFestivalStatus(organiser.token, festivalId, 'live')
    const mapRes = await fetch(`${API}/festivals/slug/${slug}/map`)
    expect(mapRes.ok).toBe(true)
    const { pins } = (await mapRes.json()) as { pins: { lat: number; lng: number; artist_id: string }[] }
    expect(pins.length).toBe(1)
    expect(pins[0].lat).toBeCloseTo(51.9007, 3)
    expect(pins[0].artist_id).toBe(artistProfileId)
  } finally {
    await ctx.close()
  }
})

test('organiser creates a new spot via the UI', async ({ browser }) => {
  const suffix = `newspot-${Date.now()}`
  const baseURL = process.env.BASE_URL ?? 'http://localhost:3000'

  const organiser = await createOrganiser(suffix)
  const { festivalId } = await createFestival(organiser.token, {
    name: `New Spot Fest ${suffix}`,
    slug: `newspot-${suffix}`,
  })

  const { ctx, page } = await loginAs(browser, organiser.email, organiser.password, baseURL)
  try {
    await page.goto(`/organiser/festivals/${festivalId}/map`)
    await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 10_000 })

    // No spots yet
    await expect(page.getByText('No spots yet.')).toBeVisible()

    // Click "Add spot" to arm placement mode
    await page.getByTestId('add-spot-btn').click()
    await expect(page.getByTestId('add-spot-btn')).toHaveText('Click map to place…')

    // Click the map to place a spot
    await page.locator('.leaflet-container').click({ position: { x: 250, y: 200 } })

    // A spot should appear in the sidebar and the panel should open
    await expect(page.getByTestId('spot-panel')).toBeVisible({ timeout: 5_000 })
    await expect(page.getByText('Spot 1')).toBeVisible()
  } finally {
    await ctx.close()
  }
})
```

- [ ] **Step 3: Run the updated e2e spec against the running stack**

Ensure the stack is up (`task up`), then:

```bash
npx playwright test e2e/browser/map-pin-edit.spec.ts
```

Expected: both tests pass.

If the first test fails on the `spot-panel` assertion, check:
- `task up` logs show `api starting` (confirms the new routes are compiled in)
- `curl -sf -X POST http://localhost:8080/festivals/TEST_ID/spots -H 'Authorization: Bearer TOKEN' -H 'Content-Type: application/json' -d '{"lat":51.9,"lng":-2.07}'` returns 201

- [ ] **Step 4: Run the full e2e suite to check for regressions**

```bash
task e2e
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add e2e/fixtures/helpers.ts e2e/browser/map-pin-edit.spec.ts
git commit -m "test(e2e): update map editor spec for spots flow"
```
