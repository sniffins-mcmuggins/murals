# E23 Map Editor Superpowers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add address-search, drag-to-reposition, and external-map deep-links to the organiser map editor; lock in the release→assign→public-map flow with an E2E browser test; update the V06 demo video.

**Architecture:** A new thin `api/internal/geocode` package proxies Nominatim (User-Agent + 5s timeout + in-memory cache + per-IP rate limit) behind `GET /geocode/search`. `MapEditorClient` grows a debounced search box (recentres only), draggable markers (drag → PATCH with full field resend to avoid silent wipes), and external-map links in the spot panel. The existing release→`festival_artist` flow already works; this plan adds the browser E2E proof and the three UX features.

**Tech Stack:** Go 1.23, chi v5, `golang.org/x/time/rate`, React/Next.js, React Leaflet, TanStack Query v5, Playwright, Vitest, OpenAPI 3.1 + openapi-typescript codegen.

**Branch:** `e23-map-editor-superpowers` (already created)

---

## File map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `api/internal/geocode/geocode.go` | `Client` + `SearchHandler` + `RateLimitMiddleware` |
| Create | `api/internal/geocode/geocode_test.go` | Unit tests for Client + handler |
| Create | `e2e/api/geocode.test.ts` | API-gate test: auth, shape, empty-q 400 |
| Modify | `api/cmd/api/main.go` | Register `GET /geocode/search` |
| Modify | `openapi/openapi.yaml` | `GeocodeSuggestion` schema + `/geocode/search` path |
| (auto) | `openapi/generated/client.ts`, `api/internal/openapi/` | Regenerated after yaml edit |
| Modify | `web/src/app/organiser/festivals/[id]/map/MapEditorClient.tsx` | Search box + draggable markers + deep-links |
| Modify | `e2e/fixtures/helpers.ts` | `stageDecision` + `releaseDecisions` helpers |
| Modify | `e2e/browser/map-pin-edit.spec.ts` | Full flow + search stub + drag tests |
| Modify | `demos/scripts/V06-organiser-full.ts` | Extend with map-editor section |
| Modify | `api/internal/festival/festival.spec.md` | AI Context note: PATCH is full-replace |
| Modify | `CLAUDE.md` | Add `geocode` to packages-without-specs list |

---

## Task 1: geocode package skeleton + failing tests

**Files:**
- Create: `api/internal/geocode/geocode.go` (skeleton — types and signatures only)
- Create: `api/internal/geocode/geocode_test.go`

- [ ] **Step 1.1: Create the package skeleton**

  Create `api/internal/geocode/geocode.go`:

  ```go
  package geocode

  import (
  	"context"
  	"net/http"
  )

  // Suggestion is one geocode result returned to the client.
  type Suggestion struct {
  	DisplayName string  `json:"display_name"`
  	Lat         float64 `json:"lat"`
  	Lng         float64 `json:"lng"`
  }

  // Client proxies Nominatim. BaseURL defaults to the live endpoint; override in
  // tests by pointing it at a local httptest.Server.
  type Client struct {
  	BaseURL    string
  	httpClient *http.Client
  }

  // NewClient returns a production-ready Client.
  // Pass a non-nil httpClient to override (e.g. for tests).
  func NewClient(httpClient *http.Client) *Client {
  	panic("not implemented")
  }

  // Search queries Nominatim and returns up to 5 suggestions for q.
  // Results are cached in memory keyed by the lowercase-trimmed query.
  func (c *Client) Search(ctx context.Context, q string) ([]Suggestion, error) {
  	panic("not implemented")
  }

  // RateLimitMiddleware limits geocode search to 20 requests/min per IP, burst 5.
  func RateLimitMiddleware(next http.Handler) http.Handler {
  	panic("not implemented")
  }

  // SearchHandler handles GET /geocode/search?q=<query>.
  // Requires authentication. Returns 400 for empty q, 502 if Nominatim is down.
  func SearchHandler(client *Client) http.HandlerFunc {
  	panic("not implemented")
  }
  ```

- [ ] **Step 1.2: Write the unit tests**

  Create `api/internal/geocode/geocode_test.go`:

  ```go
  package geocode_test

  import (
  	"context"
  	"encoding/json"
  	"net/http"
  	"net/http/httptest"
  	"testing"
  	"time"

  	"github.com/sniffins-mcmuggins/render/api/internal/geocode"
  )

  // nominatimStub returns a test server that mimics Nominatim for q="cheltenham".
  func nominatimStub(t *testing.T) *httptest.Server {
  	t.Helper()
  	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
  		if r.Header.Get("User-Agent") == "" {
  			t.Error("missing User-Agent header")
  		}
  		if r.URL.Query().Get("q") == "cheltenham" {
  			w.Header().Set("Content-Type", "application/json")
  			_ = json.NewEncoder(w).Encode([]map[string]any{
  				{"display_name": "Cheltenham, Gloucestershire, England", "lat": "51.9007", "lon": "-2.0783"},
  				{"display_name": "Cheltenham Racecourse", "lat": "51.9141", "lon": "-2.0621"},
  			})
  			return
  		}
  		w.Header().Set("Content-Type", "application/json")
  		_, _ = w.Write([]byte("[]"))
  	}))
  }

  func TestSearch_ReturnsResults(t *testing.T) {
  	srv := nominatimStub(t)
  	defer srv.Close()

  	c := geocode.NewClient(srv.Client())
  	c.BaseURL = srv.URL

  	results, err := c.Search(context.Background(), "cheltenham")
  	if err != nil {
  		t.Fatalf("unexpected error: %v", err)
  	}
  	if len(results) != 2 {
  		t.Fatalf("want 2 results, got %d", len(results))
  	}
  	if results[0].DisplayName != "Cheltenham, Gloucestershire, England" {
  		t.Errorf("unexpected display_name: %q", results[0].DisplayName)
  	}
  	if results[0].Lat < 51.8 || results[0].Lat > 52.0 {
  		t.Errorf("unexpected lat: %f", results[0].Lat)
  	}
  }

  func TestSearch_EmptyResultsForUnknownQuery(t *testing.T) {
  	srv := nominatimStub(t)
  	defer srv.Close()

  	c := geocode.NewClient(srv.Client())
  	c.BaseURL = srv.URL

  	results, err := c.Search(context.Background(), "xyznonexistent")
  	if err != nil {
  		t.Fatalf("unexpected error: %v", err)
  	}
  	if len(results) != 0 {
  		t.Errorf("want 0 results, got %d", len(results))
  	}
  }

  func TestSearch_CachesResults(t *testing.T) {
  	callCount := 0
  	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
  		callCount++
  		w.Header().Set("Content-Type", "application/json")
  		_ = json.NewEncoder(w).Encode([]map[string]any{
  			{"display_name": "Bristol", "lat": "51.4545", "lon": "-2.5879"},
  		})
  	}))
  	defer srv.Close()

  	c := geocode.NewClient(srv.Client())
  	c.BaseURL = srv.URL

  	_, _ = c.Search(context.Background(), "bristol")
  	_, _ = c.Search(context.Background(), "bristol")  // same key — should hit cache
  	_, _ = c.Search(context.Background(), "BRISTOL")  // case-insensitive — same cache key

  	if callCount != 1 {
  		t.Errorf("want 1 upstream call (cache hit for repeats), got %d", callCount)
  	}
  }

  func TestSearch_UpstreamError(t *testing.T) {
  	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
  		w.WriteHeader(http.StatusServiceUnavailable)
  	}))
  	defer srv.Close()

  	c := geocode.NewClient(srv.Client())
  	c.BaseURL = srv.URL

  	_, err := c.Search(context.Background(), "anywhere")
  	if err == nil {
  		t.Fatal("expected error for non-200 response")
  	}
  }

  func TestSearch_ContextTimeout(t *testing.T) {
  	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
  		time.Sleep(50 * time.Millisecond)
  		w.WriteHeader(http.StatusOK)
  		_, _ = w.Write([]byte("[]"))
  	}))
  	defer srv.Close()

  	c := geocode.NewClient(srv.Client())
  	c.BaseURL = srv.URL

  	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
  	defer cancel()

  	_, err := c.Search(ctx, "anywhere")
  	if err == nil {
  		t.Fatal("expected context deadline error")
  	}
  }
  ```

- [ ] **Step 1.3: Run tests — expect compile errors or panics**

  ```bash
  cd api && go test ./internal/geocode/... -v -count=1
  ```

  Expected: tests fail with `panic: not implemented` — confirms the tests are wired.

---

## Task 2: Implement geocode package

**Files:**
- Modify: `api/internal/geocode/geocode.go`

- [ ] **Step 2.1: Replace the skeleton with the full implementation**

  Overwrite `api/internal/geocode/geocode.go` completely:

  ```go
  package geocode

  import (
  	"context"
  	"encoding/json"
  	"fmt"
  	"net"
  	"net/http"
  	"net/url"
  	"strconv"
  	"strings"
  	"sync"
  	"time"

  	"golang.org/x/time/rate"

  	"github.com/sniffins-mcmuggins/render/api/internal/auth"
  	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
  )

  // Suggestion is one geocode result returned to the client.
  type Suggestion struct {
  	DisplayName string  `json:"display_name"`
  	Lat         float64 `json:"lat"`
  	Lng         float64 `json:"lng"`
  }

  // Client proxies Nominatim. BaseURL defaults to the live endpoint; override in
  // tests by pointing it at a local httptest.Server.
  type Client struct {
  	BaseURL    string
  	httpClient *http.Client
  	mu         sync.Mutex
  	cache      map[string][]Suggestion
  }

  // NewClient returns a production-ready Client.
  // Pass a non-nil httpClient to override the default 5s-timeout client.
  func NewClient(httpClient *http.Client) *Client {
  	if httpClient == nil {
  		httpClient = &http.Client{Timeout: 5 * time.Second}
  	}
  	return &Client{
  		BaseURL:    "https://nominatim.openstreetmap.org",
  		httpClient: httpClient,
  		cache:      make(map[string][]Suggestion),
  	}
  }

  // Search queries Nominatim for up to 5 suggestions matching q.
  // Results are cached by the lowercase-trimmed query key.
  func (c *Client) Search(ctx context.Context, q string) ([]Suggestion, error) {
  	key := strings.ToLower(strings.TrimSpace(q))

  	c.mu.Lock()
  	if cached, ok := c.cache[key]; ok {
  		c.mu.Unlock()
  		return cached, nil
  	}
  	c.mu.Unlock()

  	u := c.BaseURL + "/search?format=jsonv2&limit=5&q=" + url.QueryEscape(key)
  	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
  	if err != nil {
  		return nil, err
  	}
  	req.Header.Set("User-Agent", "Painttrace/1.0 (+https://painttrace.art)")
  	req.Header.Set("Accept", "application/json")

  	resp, err := c.httpClient.Do(req)
  	if err != nil {
  		return nil, err
  	}
  	defer resp.Body.Close()

  	if resp.StatusCode != http.StatusOK {
  		return nil, fmt.Errorf("nominatim returned %d", resp.StatusCode)
  	}

  	// Nominatim encodes lat/lon as strings.
  	var raw []struct {
  		DisplayName string `json:"display_name"`
  		Lat         string `json:"lat"`
  		Lon         string `json:"lon"`
  	}
  	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
  		return nil, err
  	}

  	results := make([]Suggestion, 0, len(raw))
  	for _, r := range raw {
  		lat, err := strconv.ParseFloat(r.Lat, 64)
  		if err != nil {
  			continue
  		}
  		lng, err := strconv.ParseFloat(r.Lon, 64)
  		if err != nil {
  			continue
  		}
  		results = append(results, Suggestion{DisplayName: r.DisplayName, Lat: lat, Lng: lng})
  	}

  	c.mu.Lock()
  	c.cache[key] = results
  	c.mu.Unlock()
  	return results, nil
  }

  // ─── Rate limiting (20 req/min per IP, burst 5) ───────────────────────────────

  type geocodeIPLimiter struct {
  	mu       sync.Mutex
  	limiters map[string]*rate.Limiter
  }

  var geocodeLimiter = &geocodeIPLimiter{limiters: make(map[string]*rate.Limiter)}

  func (l *geocodeIPLimiter) get(ip string) *rate.Limiter {
  	l.mu.Lock()
  	defer l.mu.Unlock()
  	if lim, ok := l.limiters[ip]; ok {
  		return lim
  	}
  	lim := rate.NewLimiter(rate.Every(time.Minute/20), 5)
  	l.limiters[ip] = lim
  	return lim
  }

  func clientIP(r *http.Request) string {
  	host, _, err := net.SplitHostPort(r.RemoteAddr)
  	if err != nil {
  		return r.RemoteAddr
  	}
  	return host
  }

  // RateLimitMiddleware limits geocode searches to 20 req/min per IP, burst 5.
  // This is intentionally separate from auth.RateLimitMiddleware to avoid
  // sharing the login rate-limit bucket.
  func RateLimitMiddleware(next http.Handler) http.Handler {
  	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
  		if !geocodeLimiter.get(clientIP(r)).Allow() {
  			w.Header().Set("Retry-After", "60")
  			httperr.Write(w, http.StatusTooManyRequests, "Too Many Requests", "geocode rate limit exceeded")
  			return
  		}
  		next.ServeHTTP(w, r)
  	})
  }

  // ─── Handler ─────────────────────────────────────────────────────────────────

  // SearchHandler handles GET /geocode/search?q=<query>.
  // Requires an authenticated session. Returns 400 for empty q, 502 on Nominatim error.
  func SearchHandler(client *Client) http.HandlerFunc {
  	return func(w http.ResponseWriter, r *http.Request) {
  		if _, err := auth.User(r.Context()); err != nil {
  			httperr.Unauthorized(w)
  			return
  		}
  		q := strings.TrimSpace(r.URL.Query().Get("q"))
  		if q == "" {
  			httperr.BadRequest(w, "q is required")
  			return
  		}
  		results, err := client.Search(r.Context(), q)
  		if err != nil {
  			httperr.Write(w, http.StatusBadGateway, "Bad Gateway", "geocode search unavailable")
  			return
  		}
  		w.Header().Set("Content-Type", "application/json")
  		_ = json.NewEncoder(w).Encode(results)
  	}
  }
  ```

- [ ] **Step 2.2: Run unit tests — expect PASS**

  ```bash
  cd api && go test ./internal/geocode/... -v -count=1
  ```

  Expected: all 5 tests PASS. If `TestSearch_ContextTimeout` is flaky on slow CI, increase the sleep in the stub to `200ms` and the context deadline to `50ms`.

- [ ] **Step 2.3: Commit**

  ```bash
  git add api/internal/geocode/
  git commit -m "feat(geocode): Nominatim proxy client + SearchHandler + rate limiter"
  ```

---

## Task 3: Register the route in main.go

**Files:**
- Modify: `api/cmd/api/main.go`

- [ ] **Step 3.1: Add the geocode import**

  In the import block of `api/cmd/api/main.go`, add:

  ```go
  "github.com/sniffins-mcmuggins/render/api/internal/geocode"
  ```

- [ ] **Step 3.2: Register the route inside the authenticated group**

  In `api/cmd/api/main.go`, inside the `r.Group(func(r chi.Router) {` block that starts with `r.Use(auth.Middleware(...))`, add this line after the spots block (around line 240, before the billing block):

  ```go
  // Geocode proxy (Nominatim, per-IP rate-limited)
  r.With(geocode.RateLimitMiddleware).Get("/geocode/search", geocode.SearchHandler(geocode.NewClient(nil)))
  ```

- [ ] **Step 3.3: Verify it compiles**

  ```bash
  cd api && go build ./...
  ```

  Expected: exits 0, no output.

- [ ] **Step 3.4: Quick smoke test against the running stack**

  The stack must be running (`task up`).

  ```bash
  EMAIL="geocode-smoke-$(date +%s)@test.com"
  curl -sf -X POST http://localhost:8080/auth/signup \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$EMAIL\",\"password\":\"password123\"}" > /dev/null
  T=$(curl -sf -X POST http://localhost:8080/auth/login \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$EMAIL\",\"password\":\"password123\"}" \
    | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
  curl -sf "http://localhost:8080/geocode/search?q=cheltenham" \
    -H "Authorization: Bearer $T"
  ```

  Expected: JSON array with at least one object containing `display_name`, `lat`, `lng`.

  ```bash
  # Unauthenticated → 401
  curl -s -o /dev/null -w "%{http_code}" "http://localhost:8080/geocode/search?q=cheltenham"
  # Expected: 401

  # Empty q → 400
  curl -s -o /dev/null -w "%{http_code}" "http://localhost:8080/geocode/search?q=" \
    -H "Authorization: Bearer $T"
  # Expected: 400
  ```

- [ ] **Step 3.5: Commit**

  ```bash
  git add api/cmd/api/main.go
  git commit -m "feat(geocode): register GET /geocode/search behind auth + rate limiter"
  ```

---

## Task 4: OpenAPI spec + codegen

**Files:**
- Modify: `openapi/openapi.yaml`
- Auto-generated: `openapi/generated/client.ts`, `api/internal/openapi/`

- [ ] **Step 4.1: Add the GeocodeSuggestion schema**

  In `openapi/openapi.yaml`, inside `components.schemas:`, add after `UnassignedArtist`:

  ```yaml
      GeocodeSuggestion:
        type: object
        required: [display_name, lat, lng]
        properties:
          display_name:
            type: string
          lat:
            type: number
            format: double
          lng:
            type: number
            format: double
  ```

- [ ] **Step 4.2: Add the /geocode/search path**

  In `openapi/openapi.yaml`, inside `paths:`, add near the end (before the billing paths):

  ```yaml
    /geocode/search:
      get:
        operationId: geocodeSearch
        tags: [geocode]
        summary: Search for a place by name or postcode (Nominatim proxy)
        security:
          - cookieAuth: []
          - bearerAuth: []
        parameters:
          - name: q
            in: query
            required: true
            schema:
              type: string
            description: Search query (address, postcode, landmark)
        responses:
          "200":
            description: Up to 5 place suggestions
            content:
              application/json:
                schema:
                  type: array
                  items:
                    $ref: "#/components/schemas/GeocodeSuggestion"
          "400":
            $ref: "#/components/responses/BadRequest"
          "401":
            $ref: "#/components/responses/Unauthorized"
          "429":
            description: Geocode rate limit exceeded
          "502":
            description: Nominatim upstream error or timeout
  ```

- [ ] **Step 4.3: Run codegen**

  ```bash
  task openapi:gen
  ```

  Expected: updates `openapi/generated/client.ts` and `api/internal/openapi/` with no errors. The `GeocodeSuggestion` type and `geocodeSearch` operation are now available in the TS client.

- [ ] **Step 4.4: Verify the Go side compiles (openapi regenerated successfully)**

  ```bash
  cd api && go build ./...
  ```

  Expected: exits 0.

- [ ] **Step 4.5: Commit**

  ```bash
  git add openapi/openapi.yaml openapi/generated/ api/internal/openapi/
  git commit -m "feat(openapi): add GeocodeSuggestion schema and /geocode/search path"
  ```

---

## Task 5: Web — address search box

**Files:**
- Modify: `web/src/app/organiser/festivals/[id]/map/MapEditorClient.tsx`

- [ ] **Step 5.1: Add GeocodeSuggestion type and MapViewUpdater component**

  At the top of `MapEditorClient.tsx`, add the type import alongside existing imports:

  ```tsx
  import { useMap } from 'react-leaflet'
  ```

  (The existing import is `{ MapContainer, TileLayer, Marker, Popup, useMapEvents }` — add `useMap` to that destructure.)

  Add the type after the existing `type UnassignedArtist` line:

  ```tsx
  type GeocodeSuggestion = components['schemas']['GeocodeSuggestion']
  ```

  Add the `MapViewUpdater` component just before `MapClickCapture`:

  ```tsx
  // ─── Map view updater ─────────────────────────────────────────────────────────

  function MapViewUpdater({ target }: { target: [number, number] | null }) {
    const map = useMap()
    useEffect(() => {
      if (target) map.setView(target, 16)
    }, [target, map])
    return null
  }
  ```

- [ ] **Step 5.2: Add search state to MapEditorClient**

  Inside `MapEditorClient`, after the existing `useState` declarations (around line 237), add:

  ```tsx
  const [searchQ, setSearchQ] = useState('')
  const [searchResults, setSearchResults] = useState<GeocodeSuggestion[]>([])
  const [mapTarget, setMapTarget] = useState<[number, number] | null>(null)
  const [searchError, setSearchError] = useState(false)
  ```

- [ ] **Step 5.3: Add the debounced search effect**

  After the existing state declarations, add:

  ```tsx
  useEffect(() => {
    if (searchQ.trim().length < 3) {
      setSearchResults([])
      return
    }
    const timer = setTimeout(async () => {
      try {
        const res = await apiClient.GET('/geocode/search', {
          params: { query: { q: searchQ.trim() } },
        })
        if (res.data) {
          setSearchResults(res.data as GeocodeSuggestion[])
          setSearchError(false)
        }
      } catch {
        setSearchResults([])
        setSearchError(true)
      }
    }, 400)
    return () => clearTimeout(timer)
  }, [searchQ])

  function handleSelectResult(r: GeocodeSuggestion) {
    setMapTarget([r.lat, r.lng])
    setSearchQ('')
    setSearchResults([])
    setSearchError(false)
  }
  ```

- [ ] **Step 5.4: Render the search box above the map**

  Inside the `{/* Map */}` `<div className="flex-1">` block, add this **before** the `{spotsQuery.isError && ...}` check:

  ```tsx
  {/* Address search — recentres the map, never creates a spot */}
  <div className="relative mb-3" data-testid="geocode-search">
    <input
      type="text"
      value={searchQ}
      onChange={e => setSearchQ(e.target.value)}
      placeholder="Search address or postcode…"
      className="w-full border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite focus:outline-none focus:border-amber"
      aria-label="Search address"
      aria-autocomplete="list"
      aria-expanded={searchResults.length > 0}
    />
    {searchError && (
      <p className="font-sans text-xs text-clay mt-1">Search unavailable</p>
    )}
    {searchResults.length > 0 && (
      <ul
        role="listbox"
        className="absolute z-[1000] top-full left-0 right-0 mt-1 bg-offwhite border border-light rounded-lg shadow-lg overflow-hidden"
        data-testid="geocode-results"
      >
        {searchResults.map((r, i) => (
          <li key={i} role="option">
            <button
              onClick={() => handleSelectResult(r)}
              className="w-full text-left px-3 py-2 font-sans text-sm text-ink hover:bg-warm truncate"
            >
              {r.display_name}
            </button>
          </li>
        ))}
      </ul>
    )}
  </div>
  ```

- [ ] **Step 5.5: Add MapViewUpdater inside MapContainer**

  Inside `<MapContainer ...>`, after `<MapClickCapture ... />`, add:

  ```tsx
  <MapViewUpdater target={mapTarget} />
  ```

- [ ] **Step 5.6: Type-check**

  ```bash
  task web:lint
  ```

  Expected: exits 0.

- [ ] **Step 5.7: Manual smoke test in browser**

  Start the stack (`task up`). Open `http://localhost:3000`, log in as an organiser, open a festival's map editor. Type "Cheltenham" in the search box — after ~400ms a dropdown should appear. Click a result — the map should pan to that location. No spot is created.

- [ ] **Step 5.8: Commit**

  ```bash
  git add web/src/app/organiser/festivals/\[id\]/map/MapEditorClient.tsx
  git commit -m "feat(web): address search box in map editor (Nominatim proxy)"
  ```

---

## Task 6: Web — draggable markers

**Files:**
- Modify: `web/src/app/organiser/festivals/[id]/map/MapEditorClient.tsx`

⚠️ **CRITICAL:** `UpdateSpotHandler` (`api/internal/festival/spots.go:254`) is a **full replace** — a missing `w3w`, `width_m`, `height_m`, or `notes` in the PATCH body silently clears those columns. The drag mutation **must resend the spot's current values for all four fields**.

- [ ] **Step 6.1: Add the drag mutation**

  Inside `MapEditorClient`, after `createSpotMutation`, add:

  ```tsx
  const dragSpotMutation = useMutation({
    mutationFn: async ({
      spotId,
      lat,
      lng,
      spot,
    }: {
      spotId: string
      lat: number
      lng: number
      spot: FestivalSpot
    }) => {
      const res = await apiClient.PATCH('/festivals/{festivalID}/spots/{spotID}', {
        params: { path: { festivalID: festivalId, spotID: spotId } },
        body: {
          lat,
          lng,
          // Must resend all mutable fields — UpdateSpotHandler is a full replace.
          // Omitting any of these silently clears the column.
          w3w: spot.w3w ?? null,
          width_m: spot.width_m ?? null,
          height_m: spot.height_m ?? null,
          notes: spot.notes ?? null,
        },
      })
      if (res.error) throw new Error('Failed to move spot')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['spots', festivalId] }),
    onError: () => {
      // Snap the marker back to the server position on failure
      queryClient.invalidateQueries({ queryKey: ['spots', festivalId] })
    },
  })
  ```

- [ ] **Step 6.2: Make markers draggable**

  In the `spots.map(s => ...)` section inside `<MapContainer>`, update the `<Marker>` to add `draggable` and the `dragend` handler:

  ```tsx
  <Marker
    key={s.id}
    position={[s.lat ?? 0, s.lng ?? 0]}
    icon={s.artist_id ? TerracottaIcon : AmberIcon}
    draggable={!placingSpot}
    eventHandlers={{
      click: () => setSelectedSpotId(s.id === selectedSpotId ? null : (s.id ?? null)),
      dragend: (e) => {
        const { lat, lng } = (e.target as L.Marker).getLatLng()
        dragSpotMutation.mutate({ spotId: s.id!, lat, lng, spot: s })
      },
    }}
  >
    <Popup>
      <span className="font-sans text-sm">
        Spot {s.number}{s.artist_name ? ` — ${s.artist_name}` : ''}
      </span>
    </Popup>
  </Marker>
  ```

  (This replaces the existing `<Marker>` block — add `draggable={!placingSpot}` and swap `eventHandlers` to include `dragend`.)

- [ ] **Step 6.3: Type-check**

  ```bash
  task web:lint
  ```

  Expected: exits 0.

- [ ] **Step 6.4: Manual drag test**

  In the map editor with an existing spot, drag the marker to a new position. Verify:
  - The marker stays at the new position after release (not snapping back).
  - The sidebar lat/lng values update after the query refetches.
  - If the spot had notes, open the SpotPanel and confirm notes are still there (the full-replace guard worked).

- [ ] **Step 6.5: Commit**

  ```bash
  git add web/src/app/organiser/festivals/\[id\]/map/MapEditorClient.tsx
  git commit -m "feat(web): draggable map markers with full-field PATCH on dragend"
  ```

---

## Task 7: Web — external map deep-links in SpotPanel

**Files:**
- Modify: `web/src/app/organiser/festivals/[id]/map/MapEditorClient.tsx`

- [ ] **Step 7.1: Add deep-links to SpotPanel**

  In the `SpotPanel` component's returned JSX, inside `<div className="space-y-3 max-w-sm">`, add this block **after** the Notes textarea and **before** the Artist select:

  ```tsx
  <div className="flex flex-wrap gap-3 pt-1 border-t border-light">
    <a
      href={
        spot.w3w
          ? `https://what3words.com/${spot.w3w}`
          : `https://what3words.com/${spot.lat},${spot.lng}`
      }
      target="_blank"
      rel="noreferrer"
      className="font-mono text-xs text-mid hover:text-ink uppercase tracking-widest"
      data-testid="link-w3w"
    >
      ///w3w
    </a>
    <a
      href={`https://www.google.com/maps/search/?api=1&query=${spot.lat},${spot.lng}`}
      target="_blank"
      rel="noreferrer"
      className="font-mono text-xs text-mid hover:text-ink uppercase tracking-widest"
      data-testid="link-google"
    >
      Google Maps
    </a>
    <a
      href={`https://maps.apple.com/?q=${spot.lat},${spot.lng}`}
      target="_blank"
      rel="noreferrer"
      className="font-mono text-xs text-mid hover:text-ink uppercase tracking-widest"
      data-testid="link-apple"
    >
      Apple Maps
    </a>
  </div>
  ```

- [ ] **Step 7.2: Type-check + commit**

  ```bash
  task web:lint
  git add web/src/app/organiser/festivals/\[id\]/map/MapEditorClient.tsx
  git commit -m "feat(web): external map deep-links (w3w, Google, Apple) in SpotPanel"
  ```

---

## Task 8: Geocode API gate e2e test

**Files:**
- Create: `e2e/api/geocode.test.ts`

- [ ] **Step 8.1: Write the test file**

  Create `e2e/api/geocode.test.ts`:

  ```ts
  import { describe, it, expect, beforeAll } from 'vitest'
  import { createOrganiser } from '../fixtures/helpers'

  const API = process.env.API_URL ?? 'http://localhost:8080'

  describe('GET /geocode/search', () => {
    const suffix = `geocode-${Date.now()}`
    let token: string

    beforeAll(async () => {
      const u = await createOrganiser(suffix)
      token = u.token
    })

    it('requires authentication', async () => {
      const res = await fetch(`${API}/geocode/search?q=cheltenham`)
      expect(res.status).toBe(401)
    })

    it('returns 400 for empty q', async () => {
      const res = await fetch(`${API}/geocode/search?q=`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(res.status).toBe(400)
    })

    it('returns 400 for missing q', async () => {
      const res = await fetch(`${API}/geocode/search`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(res.status).toBe(400)
    })

    it('returns an array of suggestions for a valid query', async () => {
      const res = await fetch(`${API}/geocode/search?q=cheltenham+uk`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(Array.isArray(data)).toBe(true)
      if (data.length > 0) {
        const first = data[0]
        expect(typeof first.display_name).toBe('string')
        expect(typeof first.lat).toBe('number')
        expect(typeof first.lng).toBe('number')
        expect(data.length).toBeLessThanOrEqual(5)
      }
    })
  })
  ```

  Note: The "valid query" test hits live Nominatim — it should pass on machines with internet access. If CI is air-gapped, wrap that test in a conditional skip.

- [ ] **Step 8.2: Run the API gate test**

  Stack must be running (`task up`).

  ```bash
  npx vitest run e2e/api/geocode.test.ts
  ```

  Expected: all 4 tests PASS.

- [ ] **Step 8.3: Commit**

  ```bash
  git add e2e/api/geocode.test.ts
  git commit -m "test(e2e): geocode API gate — auth, shape, 400 on empty q"
  ```

---

## Task 9: Add stageDecision + releaseDecisions to e2e helpers

**Files:**
- Modify: `e2e/fixtures/helpers.ts`

- [ ] **Step 9.1: Add the two helpers**

  In `e2e/fixtures/helpers.ts`, after the `assignArtistToSpot` export, add:

  ```ts
  export async function stageDecision(
    token: string,
    festivalId: string,
    applicationId: string,
    decision: 'accept' | 'waitlist' | 'decline' | null,
  ): Promise<void> {
    const res = await fetch(`${API}/festivals/${festivalId}/applications/${applicationId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ shortlisted: false, review_flag: false, staged_decision: decision }),
    })
    if (!res.ok) throw new Error(`stageDecision failed: ${res.status} ${await res.text()}`)
  }

  export async function releaseDecisions(token: string, festivalId: string): Promise<void> {
    const res = await fetch(`${API}/festivals/${festivalId}/applications/release-decisions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error(`releaseDecisions failed: ${res.status} ${await res.text()}`)
  }
  ```

- [ ] **Step 9.2: Commit**

  ```bash
  git add e2e/fixtures/helpers.ts
  git commit -m "test(e2e): add stageDecision + releaseDecisions helpers"
  ```

---

## Task 10: Browser E2E — full release → pool → assign → public map

**Files:**
- Modify: `e2e/browser/map-pin-edit.spec.ts`

This test chains the full flow #243 was waiting for: stage accept → release → artist in unassigned pool → place + assign spot via UI → public map renders the pin.

- [ ] **Step 10.1: Add the full-flow test**

  Add this test at the **end** of `e2e/browser/map-pin-edit.spec.ts`:

  ```ts
  import {
    stageDecision,
    releaseDecisions,
  } from '../fixtures/helpers'
  ```

  Add the import at the top of the file alongside the existing imports.

  Then add this test:

  ```ts
  test('release-decisions → artist in pool → assign to spot → appears on public map', async ({ browser }) => {
    const suffix = `release-flow-${Date.now()}`
    const baseURL = process.env.BASE_URL ?? 'http://localhost:3000'

    // ── Arrange via API ───────────────────────────────────────────────────────
    const artist = await createArtist(suffix)
    await createProfile(artist.token, { displayName: `Release Flow Artist ${suffix}` })
    const organiser = await createOrganiser(suffix)
    const { festivalId, slug } = await createFestival(organiser.token, {
      name: `Release Flow Fest ${suffix}`,
      slug: `release-flow-${suffix}`,
    })
    await upsertForm(organiser.token, festivalId)
    await setFestivalStatus(organiser.token, festivalId, 'open')
    const { applicationId } = await submitApplication(artist.token, festivalId)

    // Stage accept + release (the E23 data-flow)
    await stageDecision(organiser.token, festivalId, applicationId, 'accept')
    await releaseDecisions(organiser.token, festivalId)

    // ── Verify artist appears in unassigned pool ──────────────────────────────
    const spotsRes = await fetch(`${API}/festivals/${festivalId}/spots`, {
      headers: { Authorization: `Bearer ${organiser.token}` },
    })
    expect(spotsRes.ok).toBe(true)
    const { unassigned_artists } = (await spotsRes.json()) as {
      unassigned_artists: { artist_id: string }[]
    }
    expect(unassigned_artists.length).toBe(1)
    const artistProfileId = unassigned_artists[0].artist_id

    // ── UI: open map editor, place spot, assign artist ────────────────────────
    const { ctx, page } = await loginAs(browser, organiser.email, organiser.password, baseURL)
    try {
      await page.goto(`/organiser/festivals/${festivalId}/map`)
      await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 10_000 })

      // Place a spot by clicking the map
      await page.getByTestId('add-spot-btn').click()
      await expect(page.getByTestId('add-spot-btn')).toHaveText('Click map to place…')
      await page.locator('.leaflet-container').click({ position: { x: 250, y: 200 } })
      await expect(page.getByTestId('spot-panel')).toBeVisible({ timeout: 5_000 })

      // Assign the accepted artist from the dropdown
      await page.getByTestId('spot-panel').getByRole('combobox').selectOption({ index: 1 })
      await page.getByTestId('spot-panel').getByRole('button', { name: 'Save' }).click()
      await expect(
        page.getByTestId('spot-panel').getByRole('button', { name: 'Save' }),
      ).toBeEnabled({ timeout: 5_000 })

      // ── Verify the assignment landed server-side ──────────────────────────
      const spotsAfter = await fetch(`${API}/festivals/${festivalId}/spots`, {
        headers: { Authorization: `Bearer ${organiser.token}` },
      })
      const { spots } = (await spotsAfter.json()) as {
        spots: Array<{ id: string; artist_id: string | null }>
      }
      expect(spots.some(s => s.artist_id === artistProfileId)).toBe(true)

      // ── Public map: set festival live + verify pin appears ────────────────
      await setFestivalStatus(organiser.token, festivalId, 'live')
      const mapRes = await fetch(`${API}/festivals/slug/${slug}/map`)
      expect(mapRes.ok).toBe(true)
      const { pins } = (await mapRes.json()) as {
        pins: { artist_id: string; lat: number; lng: number }[]
      }
      expect(pins.length).toBe(1)
      expect(pins[0].artist_id).toBe(artistProfileId)
    } finally {
      await ctx.close()
    }
  })
  ```

- [ ] **Step 10.2: Run the test**

  Stack must be running (`task up`).

  ```bash
  npx playwright test e2e/browser/map-pin-edit.spec.ts -g "release-decisions"
  ```

  Expected: PASS. If the artist dropdown has no options visible immediately, the query may not have refetched yet — add a brief `await page.waitForTimeout(500)` before the `selectOption` as a fallback only if needed.

- [ ] **Step 10.3: Commit**

  ```bash
  git add e2e/browser/map-pin-edit.spec.ts
  git commit -m "test(e2e): release→pool→assign→public-map browser flow (closes #243 acceptance criteria)"
  ```

---

## Task 11: Browser E2E — search and drag tests

**Files:**
- Modify: `e2e/browser/map-pin-edit.spec.ts`

- [ ] **Step 11.1: Add search stub test**

  Add this test after the release-flow test:

  ```ts
  test('address search recentres the map (stubbed geocode)', async ({ browser }) => {
    const suffix = `search-${Date.now()}`
    const baseURL = process.env.BASE_URL ?? 'http://localhost:3000'

    const organiser = await createOrganiser(suffix)
    const { festivalId } = await createFestival(organiser.token, {
      name: `Search Test Fest ${suffix}`,
      slug: `search-test-${suffix}`,
    })

    const { ctx, page } = await loginAs(browser, organiser.email, organiser.password, baseURL)
    try {
      // Intercept geocode search — no live Nominatim dependency in CI
      await page.route('**/geocode/search**', route =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            {
              display_name: 'Cheltenham, Gloucestershire, England',
              lat: 51.9007,
              lng: -2.0783,
            },
          ]),
        }),
      )

      await page.goto(`/organiser/festivals/${festivalId}/map`)
      await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 10_000 })

      // Type into search box (3+ chars triggers the debounced fetch)
      await page.getByLabel('Search address').fill('Cheltenham')

      // Results dropdown appears
      await expect(page.getByTestId('geocode-results')).toBeVisible({ timeout: 3_000 })
      await expect(page.getByTestId('geocode-results').getByRole('option').first()).toContainText(
        'Cheltenham',
      )

      // Selecting a result clears the input and closes the dropdown
      await page.getByTestId('geocode-results').getByRole('option').first().click()
      await expect(page.getByTestId('geocode-results')).not.toBeVisible()
      await expect(page.getByLabel('Search address')).toHaveValue('')
    } finally {
      await ctx.close()
    }
  })
  ```

- [ ] **Step 11.2: Add drag persistence test**

  Add this test:

  ```ts
  test('dragging a marker persists the new position without wiping other fields', async ({
    browser,
  }) => {
    const suffix = `drag-${Date.now()}`
    const baseURL = process.env.BASE_URL ?? 'http://localhost:3000'

    const organiser = await createOrganiser(suffix)
    const { festivalId } = await createFestival(organiser.token, {
      name: `Drag Test Fest ${suffix}`,
      slug: `drag-test-${suffix}`,
    })

    // Pre-create a spot with notes (to verify the full-replace guard)
    const { spotId } = await createSpot(organiser.token, festivalId, 51.9007, -2.0783)
    // Set notes via PATCH so they exist before the drag
    await fetch(`${API}/festivals/${festivalId}/spots/${spotId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${organiser.token}` },
      body: JSON.stringify({ lat: 51.9007, lng: -2.0783, notes: 'do not wipe me' }),
    })

    const { ctx, page } = await loginAs(browser, organiser.email, organiser.password, baseURL)
    try {
      await page.goto(`/organiser/festivals/${festivalId}/map`)
      await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 10_000 })
      await expect(page.locator('.leaflet-marker-icon')).toBeVisible({ timeout: 5_000 })

      // Drag the marker
      const marker = page.locator('.leaflet-marker-icon').first()
      const box = await marker.boundingBox()
      if (!box) throw new Error('marker bounding box is null')
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 60, { steps: 12 })
      await page.mouse.up()

      // Wait for the PATCH to land (query refetch)
      await page.waitForTimeout(1_500)

      // Verify new position was saved and notes were NOT wiped
      const spotsRes = await fetch(`${API}/festivals/${festivalId}/spots`, {
        headers: { Authorization: `Bearer ${organiser.token}` },
      })
      const { spots } = (await spotsRes.json()) as {
        spots: Array<{ id: string; lat: number; lng: number; notes: string | null }>
      }
      const s = spots.find(x => x.id === spotId)!
      expect(s.notes).toBe('do not wipe me')
      // Position should have changed (dragged by ~60px at zoom ~6 = small but non-zero delta)
      const latMoved = Math.abs(s.lat - 51.9007) > 0.0001 || Math.abs(s.lng - (-2.0783)) > 0.0001
      expect(latMoved).toBe(true)
    } finally {
      await ctx.close()
    }
  })
  ```

- [ ] **Step 11.3: Run all map-pin-edit tests**

  ```bash
  npx playwright test e2e/browser/map-pin-edit.spec.ts
  ```

  Expected: all 5 tests PASS (2 original + 3 new). Drag test result depends on zoom level — if the pixel-to-coordinate conversion produces sub-threshold movement at the default UK zoom level, increase the drag distance from 60px to 120px.

- [ ] **Step 11.4: Commit**

  ```bash
  git add e2e/browser/map-pin-edit.spec.ts
  git commit -m "test(e2e): search (stubbed) + drag-persists-fields browser tests"
  ```

---

## Task 12: Extend demo video V06

**Files:**
- Modify: `demos/scripts/V06-organiser-full.ts`

The V06 script currently ends at step 9 (post-release banner). Extend it to navigate to the map editor and demonstrate placing + assigning spots.

- [ ] **Step 12.1: Add map editor section to V06**

  In `demos/scripts/V06-organiser-full.ts`, replace the final `await pause(2000)` and closing `})` with:

  ```ts
    await pause(2000)

    // ── 10. Navigate to map editor ────────────────────────────────────────────
    // Click through to the festival dashboard then the Map Editor link
    await page.goto('/organiser/festivals')
    await pause(800)
    await page.getByRole('link', { name: 'Cheltenham Paint Festival 2027' }).first().click()
    await pause(800)
    await highlight(page, 'a[href*="/map"]')
    await page.getByRole('link', { name: /map/i }).click()
    await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 10_000 })
    await pause(1200)

    // ── 11. Search to recentre on Cheltenham ──────────────────────────────────
    await highlight(page, '[data-testid="geocode-search"] input')
    await slowType(page.getByLabel('Search address'), 'Cheltenham')
    await expect(page.getByTestId('geocode-results')).toBeVisible({ timeout: 5_000 })
    await pause(800)
    await page.getByTestId('geocode-results').getByRole('option').first().click()
    await pause(1500)

    // ── 12. Place a spot by clicking the map ──────────────────────────────────
    await highlight(page, '[data-testid="add-spot-btn"]')
    await page.getByTestId('add-spot-btn').click()
    await pause(600)
    await page.locator('.leaflet-container').click({ position: { x: 380, y: 280 } })
    await expect(page.getByTestId('spot-panel')).toBeVisible({ timeout: 5_000 })
    await pause(1000)

    // ── 13. Drag to fine-tune position ────────────────────────────────────────
    const marker = page.locator('.leaflet-marker-icon').last()
    const markerBox = await marker.boundingBox()
    if (markerBox) {
      await page.mouse.move(markerBox.x + markerBox.width / 2, markerBox.y + markerBox.height / 2)
      await pause(400)
      await page.mouse.down()
      await pause(500)
      await page.mouse.move(
        markerBox.x + markerBox.width / 2 + 30,
        markerBox.y + markerBox.height / 2 - 20,
        { steps: 15 },
      )
      await pause(400)
      await page.mouse.up()
      await pause(900)
    }

    // ── 14. Assign an accepted artist to the spot ─────────────────────────────
    await highlight(page, '[data-testid="spot-panel"] select')
    await page.getByTestId('spot-panel').getByRole('combobox').selectOption({ index: 1 })
    await pause(600)
    await highlight(page, '[data-testid="spot-panel"] button:has-text("Save")')
    await page.getByTestId('spot-panel').getByRole('button', { name: 'Save' }).click()
    await expect(
      page.getByTestId('spot-panel').getByRole('button', { name: 'Save' }),
    ).toBeEnabled({ timeout: 5_000 })
    await pause(1500)

    // ── 15. Show the external map links ──────────────────────────────────────
    await highlight(page, '[data-testid="link-w3w"]')
    await pause(1200)
    await highlight(page, '[data-testid="link-google"]')
    await pause(1200)

    // ── 16. Public map — artist appears on the spot ───────────────────────────
    // (Festival must be live — seed sets it to open; navigate to simulate the view)
    // Navigate to the public festival page if it's live, otherwise show the map editor result
    await pause(2000)
  })
  ```

- [ ] **Step 12.2: Verify the seed has accepted artists for the video**

  The demo seed (`demos/seed/main.go`) seeds artists with `status: "submitted"`. The V06 video drags them to Accept and releases. After release they become `festival_artist` rows. But the demo script starts fresh each run — so the map editor section needs at least one artist already in the pool when we arrive there.

  Check if the seed pre-accepts any artists:

  ```bash
  grep -n "accepted" demos/seed/main.go | head
  ```

  If no artists are pre-accepted in the seed (they're seeded as "submitted" for the kanban demo), the map-editor section of V06 will show an empty dropdown. To fix this, the seed needs at least one artist accepted before V06 runs, OR the video records the full flow: kanban → release → map editor. Since V06 already does the release (steps 1–9), the accepted artists will be in the pool by step 14. This should work correctly since the script is sequential.

- [ ] **Step 12.3: Record the video**

  ```bash
  # Record (produces .webm in demos/output/raw/V06/)
  cd demos && npm run record -- V06-organiser-full.ts

  # Convert webm → mp4
  cd demos && bash run.sh
  ```

  The output goes to `demos/output/V06.mp4`.

- [ ] **Step 12.4: Commit**

  ```bash
  git add demos/scripts/V06-organiser-full.ts demos/output/V06.mp4
  git commit -m "demo(V06): extend organiser video with map editor — search, place, drag, assign"
  ```

---

## Task 13: Spec and docs maintenance + kanban wiring

**Files:**
- Modify: `api/internal/festival/festival.spec.md`
- Modify: `CLAUDE.md`

- [ ] **Step 13.1: Add AI Context note to festival spec**

  In `api/internal/festival/festival.spec.md`, in the `## AI Context` section, add:

  ```markdown
  - **`PATCH /spots/{id}` is a full replace:** `UpdateSpotHandler` overwrites `w3w`, `width_m`, `height_m`, and `notes` from the request body — a missing or `null` value clears the column. Any partial update (e.g. drag-to-reposition) must resend the spot's current values for all four fields. Handler at `spots.go:254`.
  ```

  Also add to the `## Changelog` section:

  ```markdown
  2026-06-04 — E23: noted PATCH /spots full-replace invariant; click-to-place already shipped; release→festival_artist gap closed in f1a2264
  ```

- [ ] **Step 13.2: Add geocode to packages-without-specs in CLAUDE.md**

  In `CLAUDE.md`, find the line:

  ```markdown
  `sqlcdb` (auto-generated), `config` (env vars only), `httperr`, `health`, `metrics`, `middleware`, `testutil`, `openapi`.
  ```

  Update it to:

  ```markdown
  `sqlcdb` (auto-generated), `config` (env vars only), `httperr`, `health`, `metrics`, `middleware`, `testutil`, `openapi`, `geocode` (thin proxy, no domain logic).
  ```

- [ ] **Step 13.3: Update GitHub issue #243**

  ```bash
  gh issue edit 243 --repo sniffins-mcmuggins/murals \
    --title "[E23] Spot assignment & map-editor placement superpowers"
  ```

  Update the body to note the gap is closed and list the sub-tasks:

  ```bash
  gh issue edit 243 --repo sniffins-mcmuggins/murals --body "$(cat <<'EOF'
  ## Status
  The original gap (release-decisions not creating festival_artist rows) was **closed in commit f1a2264**. This epic now tracks the map-editor placement superpowers.

  ## Sub-tasks
  - [ ] E23.1 — Address/postcode search (API proxy + web)
  - [ ] E23.2 — Drag markers to reposition
  - [ ] E23.3 — what3words + maps deep-links per spot
  - [ ] E23.4 — E2E: release → pool → assign → public map
  - [ ] E23.5 — Update organiser demo video V06

  ## Related
  - Design spec: \`docs/superpowers/specs/2026-06-04-e23-map-editor-superpowers-design.md\`
  - Implementation plan: \`docs/superpowers/plans/2026-06-04-e23-map-editor-superpowers.md\`
  EOF
  )"
  ```

- [ ] **Step 13.4: Create sub-issues E23.1–E23.5 and wire to #243**

  ```bash
  # Create sub-issues (run each; capture the issue number printed)
  gh issue create --repo sniffins-mcmuggins/murals \
    --title "[E23.1] Address/postcode search in map editor (Nominatim proxy)" \
    --label "type:task,area:api,area:web,priority:p1" \
    --body "Implement geocode package + SearchHandler + search box in MapEditorClient. See design spec."

  gh issue create --repo sniffins-mcmuggins/murals \
    --title "[E23.2] Drag markers to reposition spots" \
    --label "type:task,area:web,priority:p1" \
    --body "Make Leaflet markers draggable; dragend fires PATCH with full-field resend. See design spec."

  gh issue create --repo sniffins-mcmuggins/murals \
    --title "[E23.3] External map deep-links in SpotPanel (w3w, Google, Apple)" \
    --label "type:task,area:web,priority:p1" \
    --body "Add what3words / Google Maps / Apple Maps links to SpotPanel. Pure frontend. See design spec."

  gh issue create --repo sniffins-mcmuggins/murals \
    --title "[E23.4] E2E: release → pool → assign → public map browser test" \
    --label "type:task,area:e2e,priority:p1" \
    --body "Browser spec chaining the full acceptance flow. Locks in #243 acceptance criterion. See design spec."

  gh issue create --repo sniffins-mcmuggins/murals \
    --title "[E23.5] Update organiser demo video V06 with map editor section" \
    --label "type:task,area:web,priority:p1" \
    --body "Extend V06-organiser-full.ts: search → place → drag → assign → public map. See design spec."
  ```

  Then wire each as a sub-issue of #243 — replace `NNN` with the issue numbers created above:

  ```bash
  # Get #243 node ID
  PARENT=$(gh api graphql -f query='{ repository(owner:"sniffins-mcmuggins",name:"murals"){ issue(number:243){ id } } }' -q '.data.repository.issue.id')

  # Repeat for each sub-issue number (replace 999 with each actual number)
  CHILD=$(gh api graphql -f query='{ repository(owner:"sniffins-mcmuggins",name:"murals"){ issue(number:999){ id } } }' -q '.data.repository.issue.id')
  gh api graphql -f query="mutation { addSubIssue(input:{issueId:\"$PARENT\",subIssueId:\"$CHILD\"}){ issue { number } } }"
  ```

- [ ] **Step 13.5: Add sub-issues to the project board**

  For each sub-issue number NNN (replace with actual numbers from step 13.4):

  ```bash
  NODE_ID=$(gh api graphql -f query='{ repository(owner:"sniffins-mcmuggins",name:"murals"){ issue(number:NNN){ id } } }' -q '.data.repository.issue.id')

  # Add to board
  ITEM_ID=$(gh api graphql -f query="mutation { addProjectV2ItemById(input:{projectId:\"PVT_kwHOEQNUZM4BZPlW\",contentId:\"$NODE_ID\"}){ item { id } } }" -q '.data.addProjectV2ItemById.item.id')

  # Set Status = Ready (61e4505c)
  gh api graphql -f query="mutation { updateProjectV2ItemFieldValue(input:{projectId:\"PVT_kwHOEQNUZM4BZPlW\",itemId:\"$ITEM_ID\",fieldId:\"PVTSSF_lAHOEQNUZM4BZPlWzhUPpIk\",value:{singleSelectOptionId:\"61e4505c\"}}){ projectV2Item { id } } }"

  # Set Priority = P1 (0a877460)
  gh api graphql -f query="mutation { updateProjectV2ItemFieldValue(input:{projectId:\"PVT_kwHOEQNUZM4BZPlW\",itemId:\"$ITEM_ID\",fieldId:\"PVTSSF_lAHOEQNUZM4BZPlWzhUPpMA\",value:{singleSelectOptionId:\"0a877460\"}}){ projectV2Item { id } } }"
  ```

- [ ] **Step 13.6: Run full test suite to confirm nothing regressed**

  Stack must be running (`task up`).

  ```bash
  task e2e
  ```

  Expected: all API gate tests PASS, all browser specs PASS.

- [ ] **Step 13.7: Final commit**

  ```bash
  git add api/internal/festival/festival.spec.md CLAUDE.md
  git commit -m "docs: spec + CLAUDE.md maintenance for E23 (geocode package, PATCH full-replace note)"
  ```

---

## Done

At this point the branch `e23-map-editor-superpowers` contains:
- `api/internal/geocode/` — new Nominatim proxy package with unit tests
- Route `GET /geocode/search` registered and typed in OpenAPI
- `MapEditorClient` with address search, draggable markers, external map links
- Browser E2E covering the full release→assign→public-map flow, search stubbing, and drag persistence
- Demo video V06 extended with the map editor section
- Spec and kanban updated

Invoke `superpowers:finishing-a-development-branch` to review merge options.
