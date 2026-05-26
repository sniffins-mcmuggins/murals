# Task 7: Festival Map Data Handler

**Files:**
- Create: `api/internal/festival/map.go`
- Create: `api/internal/festival/map_test.go`

**Context:** Public endpoint. Fetches festival by slug (not ID), checks status == 'live' (else 404), calls GetFestivalMapPins to get accepted artists with non-null pins. Returns `{pins:[{artist_id, name, lat, lng, w3w}]}`. The response uses `artist_id` (profile UUID as string) — not a slug, since artist_profiles has no slug field. Pin lat/lng are pgtype.Numeric; convert to float64 for JSON.

---

- [ ] **Step 1: Write failing tests**

Create `api/internal/festival/map_test.go`:

```go
package festival_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/festival"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

func TestGetMapData_LiveFestivalReturnsPins(t *testing.T) {
	db := testutil.NewDB(t)
	orgID, _ := createTestUser(t, db, "maporg@example.com", "organiser")
	festID := createTestFestival(t, db, orgID, "map-fest-live", "live")

	// Create artist and accept them with a pin
	artistUserID, _ := createTestUser(t, db, "mapartist@example.com", "artist")
	artistProfileID := createTestArtistProfile(t, db, artistUserID, "Map Artist")

	q := sqlcdb.New(db)
	lat := pgtype.Numeric{}
	_ = lat.Scan("51.900740")
	lng := pgtype.Numeric{}
	_ = lng.Scan("-2.074060")
	w3w := strPtr("filled.count.soap")

	_, err := q.AddFestivalArtist(context.Background(), sqlcdb.AddFestivalArtistParams{
		FestivalID: pgUUID(t, festID),
		ArtistID:   pgUUID(t, artistProfileID),
		Status:     sqlcdb.FestivalArtistStatusAccepted,
		PinLat:     lat,
		PinLng:     lng,
		W3w:        w3w,
	})
	if err != nil {
		t.Fatalf("add festival artist: %v", err)
	}

	r := chi.NewRouter()
	r.Use(auth.Middleware(testSecret))
	r.Get("/festivals/slug/{slug}/map", festival.GetMapDataHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "GET", "/festivals/slug/map-fest-live/map", "", "")
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("expected 200, got %d: %s", resp.StatusCode, b)
	}
	var body map[string]any
	json.NewDecoder(resp.Body).Decode(&body)
	resp.Body.Close()

	pins, ok := body["pins"].([]any)
	if !ok || len(pins) != 1 {
		t.Fatalf("expected 1 pin, got %v", body["pins"])
	}
	pin := pins[0].(map[string]any)
	if pin["artist_id"] != artistProfileID {
		t.Errorf("expected artist_id %s, got %v", artistProfileID, pin["artist_id"])
	}
	if pin["name"] != "Map Artist" {
		t.Errorf("expected name 'Map Artist', got %v", pin["name"])
	}
}

func TestGetMapData_NonLiveFestivalReturns404(t *testing.T) {
	db := testutil.NewDB(t)
	orgID, _ := createTestUser(t, db, "maporg2@example.com", "organiser")
	createTestFestival(t, db, orgID, "map-fest-draft", "draft")

	r := chi.NewRouter()
	r.Use(auth.Middleware(testSecret))
	r.Get("/festivals/slug/{slug}/map", festival.GetMapDataHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "GET", "/festivals/slug/map-fest-draft/map", "", "")
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404 for non-live festival, got %d", resp.StatusCode)
	}
	resp.Body.Close()
}

func strPtr(s string) *string { return &s }
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd api && go test ./internal/festival/... -run TestGetMapData -v 2>&1 | head -10
```

Expected: compile error — festival.GetMapDataHandler undefined.

- [ ] **Step 3: Implement api/internal/festival/map.go**

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
	ArtistID string   `json:"artist_id"`
	Name     string   `json:"name"`
	Lat      float64  `json:"lat"`
	Lng      float64  `json:"lng"`
	W3W      *string  `json:"w3w,omitempty"`
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

- [ ] **Step 4: Run tests**

```bash
cd api && go test ./internal/festival/... -run TestGetMapData -v
```

Expected: both map tests pass.

- [ ] **Step 5: Commit**

```bash
git add api/internal/festival/map.go api/internal/festival/map_test.go
git commit -m "feat(festival): add festival map data endpoint"
```
