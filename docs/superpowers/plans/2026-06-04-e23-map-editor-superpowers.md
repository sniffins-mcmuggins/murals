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
| Modify | `web/src/app/organiser/festivals/[id]/map/MapEditorClient.tsx` | Search box + draggable markers + deep-links + drag-drop artist rail |
| Modify | `e2e/fixtures/helpers.ts` | `stageDecision` + `releaseDecisions` helpers |
| Modify | `e2e/browser/map-pin-edit.spec.ts` | Full flow + search stub + drag tests + drag-drop assign |
| Modify | `demos/scripts/V06-organiser-full.ts` | Extend with map-editor section (drag-drop assign) |
| Modify | `api/internal/festival/festival.spec.md` | AI Context + Invariants: PATCH full-replace, eligibility, no-awareness |
| Modify | `CLAUDE.md` | Add `geocode` to packages-without-specs list |
| **Part 2 — assignment workflow** | | |
| Modify | `db/queries/festival_spots.sql` | `GetUnassignedSpotEligibleArtists`, `ClearSpotAssignmentForArtist` |
| Modify | `db/queries/festival_artists.sql` | `GetSpotEligibleArtist`; gate appearances spot-branch on `live` |
| (auto) | `api/internal/sqlcdb/*.sql.go` | Regenerated via `task db:generate` |
| Modify | `api/internal/festival/spots.go` | Switch pool query + relax assignment guard |
| Modify | `api/internal/festival/patch.go` | Clear spot when staged_decision ≠ accept |
| Modify | `api/internal/festival/waitlist.go`, `review.go` | Clear spot on waitlist/decline |
| Modify | `api/internal/festival/release.go` | Release-time spot-clear sweep for non-accepts |
| Modify | `api/internal/festival/my_applications.go`, `application.go` | `toMyApplicationResponse` (no review fields) |
| Modify | `openapi/openapi.yaml` | `MyApplication` schema; `/me/applications` returns it |
| Modify | `web/src/app/organiser/festivals/[id]/page.tsx` | Spot-assignment summary section |
| Create | `e2e/api/spot-assignment-privacy.test.ts` | Pre-release assign + orphan-clear + no-awareness |

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

- [ ] **Step 12.3: Do NOT record yet — recording is deferred to Task 21**

  The assignment portion of this script (step 14, `selectOption`) will be **replaced by
  drag-and-drop** in Task 21 once the drag-drop rail (Task 18) exists, and the single
  recording happens there. Commit the script edits now; record later.

  ```bash
  git add demos/scripts/V06-organiser-full.ts
  git commit -m "demo(V06): stage map-editor section (search, place, drag-reposition)"
  ```

> **Note:** Step 12.4 (final commit with `V06.mp4`) is folded into Task 21 after the
> recording is made. Nothing else to commit here beyond the script staged in Step 12.3.

---

## Task 13: Spec and docs maintenance + kanban wiring (Part 1)

> **Scope:** This task covers the **Part 1** docs only (geocode + PATCH full-replace note,
> E23.1–E23.5 issues). The Part 2 invariants (eligibility, no-awareness) and E23.6–E23.8
> issues are handled in **Task 22**. Step 13.6 (full e2e) verifies Part 1; Task 22 re-runs
> it for the whole epic.

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

# Part 2 — Pre-release assignment workflow

> **Execution order:** Do Part 2 tasks **after** Part 1, **in order**. The web drag-drop
> (Task 18) and the demo recording (Task 21) depend on the API foundation (Tasks 14–17).
>
> **TDD is mandatory for every Go change in this part** (user requirement). Each API task
> writes a failing Go test first (`testutil.NewDB`, `testutil.CreateUser`,
> `testutil.DoRequest` — see `.claude/rules/go-testing.md`), runs it red, implements, runs
> it green. Every `Test*` starts with `t.Parallel()`. Run Go tests with
> `cd api && go test ./internal/festival/... -race -count=1` (or `task api:test`).

## Task 14: DB query layer — eligibility, clear, guard (additive)

**Files:**
- Modify: `db/queries/festival_spots.sql`
- Modify: `db/queries/festival_artists.sql`
- Auto: `api/internal/sqlcdb/*.sql.go`

These are **additive** SQL queries — nothing calls them yet, so the build stays green.
They are exercised (and thus tested) by the handler tests in Tasks 15–17.

- [ ] **Step 14.1: Add the widened pool query to `festival_spots.sql`**

  Add (do not delete `GetUnassignedAcceptedArtists` yet — Task 15 removes it):

  ```sql
  -- name: GetUnassignedSpotEligibleArtists :many
  -- Artists eligible to be placed on a spot: released accepts (festival_artists) OR
  -- provisional accepts (applications.staged_decision = 'accept'), minus those already
  -- assigned a spot. Feeds the map editor pool and the dashboard summary.
  SELECT elig.artist_id, elig.name
  FROM (
      SELECT fa.artist_id, ap.display_name AS name
      FROM festival_artists fa
      JOIN artist_profiles ap ON ap.id = fa.artist_id
      WHERE fa.festival_id = $1 AND fa.status = 'accepted'
      UNION
      SELECT a.artist_id, ap.display_name AS name
      FROM applications a
      JOIN application_forms af ON af.id = a.form_id
      JOIN artist_profiles ap ON ap.id = a.artist_id
      WHERE af.festival_id = $1 AND a.staged_decision = 'accept'
  ) elig
  WHERE NOT EXISTS (
      SELECT 1 FROM festival_spots fs
      WHERE fs.festival_id = $1 AND fs.artist_id = elig.artist_id
  )
  ORDER BY elig.name;
  ```

- [ ] **Step 14.2: Add the clear-assignment query to `festival_spots.sql`**

  ```sql
  -- name: ClearSpotAssignmentForArtist :exec
  -- Removes an artist from any spot they hold in this festival (the spot itself,
  -- with its location/dimensions/notes, is preserved). Called whenever an artist
  -- stops being a spot-eligible accept.
  UPDATE festival_spots
  SET artist_id = NULL, updated_at = now()
  WHERE festival_id = $1 AND artist_id = $2;
  ```

- [ ] **Step 14.3: Add the eligibility guard query to `festival_artists.sql`**

  ```sql
  -- name: GetSpotEligibleArtist :one
  -- Returns the artist_id iff the artist is spot-eligible for this festival:
  -- a released accept OR a provisional accept (staged_decision = 'accept').
  -- Used as the assignment guard in SetSpotArtistHandler. ErrNoRows => not eligible.
  SELECT @artist_id::uuid AS artist_id
  WHERE EXISTS (
      SELECT 1 FROM festival_artists fa
      WHERE fa.festival_id = @festival_id AND fa.artist_id = @artist_id
        AND fa.status = 'accepted'
  )
  OR EXISTS (
      SELECT 1 FROM applications a
      JOIN application_forms af ON af.id = a.form_id
      WHERE af.festival_id = @festival_id AND a.artist_id = @artist_id
        AND a.staged_decision = 'accept'
  );
  ```

- [ ] **Step 14.4: Regenerate sqlc and verify build**

  ```bash
  task db:generate
  cd api && go build ./...
  ```

  Expected: regenerates `api/internal/sqlcdb/`; build exits 0 (new funcs unused but valid).
  Confirm the generated funcs exist:

  ```bash
  grep -l "GetUnassignedSpotEligibleArtists\|ClearSpotAssignmentForArtist" api/internal/sqlcdb/festival_spots.sql.go
  grep -l "GetSpotEligibleArtist" api/internal/sqlcdb/festival_artists.sql.go
  ```

- [ ] **Step 14.5: Commit**

  ```bash
  git add db/queries/ api/internal/sqlcdb/
  git commit -m "feat(db): spot-eligibility, clear-assignment, eligibility-guard queries"
  ```

---

## Task 15: Widen the spot pool + relax the assignment guard (TDD)

**Files:**
- Test: `api/internal/festival/spots_test.go`
- Modify: `api/internal/festival/spots.go`
- Modify: `db/queries/festival_spots.sql`, `db/queries/festival_artists.sql` (remove now-dead queries)

- [ ] **Step 15.1: Write the failing tests**

  Add to `api/internal/festival/spots_test.go` (imports: `chi`, `auth`, `festival`,
  `sqlcdb`, `testutil`, `httptest`, `net/http`, `encoding/json`, `require` — match the
  file's existing import block):

  ```go
  func TestSpots_ProvisionalAcceptIsSpotEligible(t *testing.T) {
  	t.Parallel()
  	db := testutil.NewDB(t)

  	orgID, orgToken, _ := testutil.CreateUser(t, db)
  	artistUserID, _, _ := testutil.CreateUser(t, db)

  	festID, _ := createTestFestival(t, db, orgID, "open")
  	createTestApplicationForm(t, db, festID)
  	profileID := createTestArtistProfile(t, db, artistUserID, "Prov Artist")
  	appID := createTestApplicationInFestival(t, db, festID, artistUserID)

  	// Stage 'accept' WITHOUT releasing — no festival_artists row exists.
  	dec := "accept"
  	_, err := sqlcdb.New(db).UpdateApplicationFlags(t.Context(), sqlcdb.UpdateApplicationFlagsParams{
  		ID: pgUUID(t, appID), Shortlisted: false, ReviewFlag: false, StagedDecision: &dec,
  	})
  	require.NoError(t, err)

  	r := chi.NewRouter()
  	r.Use(auth.Middleware(db, testSecret))
  	r.Get("/festivals/{festivalID}/spots", festival.GetSpotsHandler(db))
  	r.Post("/festivals/{festivalID}/spots", festival.CreateSpotHandler(db))
  	r.Put("/festivals/{festivalID}/spots/{spotID}/artist", festival.SetSpotArtistHandler(db))
  	srv := httptest.NewServer(r)
  	t.Cleanup(srv.Close)

  	// Provisional accept appears in the unassigned pool.
  	resp := testutil.DoRequest(t, srv, "GET", "/festivals/"+festID+"/spots", "", orgToken)
  	require.Equal(t, http.StatusOK, resp.StatusCode)
  	var pool struct {
  		UnassignedArtists []struct {
  			ArtistID string `json:"artist_id"`
  		} `json:"unassigned_artists"`
  	}
  	require.NoError(t, json.NewDecoder(resp.Body).Decode(&pool))
  	_ = resp.Body.Close()
  	require.Len(t, pool.UnassignedArtists, 1)
  	require.Equal(t, profileID, pool.UnassignedArtists[0].ArtistID)

  	// Create a spot and assign the provisional accept — must succeed (200, not 422).
  	cr := testutil.DoRequest(t, srv, "POST", "/festivals/"+festID+"/spots", `{"lat":51.9,"lng":-2.07}`, orgToken)
  	require.Equal(t, http.StatusCreated, cr.StatusCode)
  	var spot struct {
  		ID string `json:"id"`
  	}
  	require.NoError(t, json.NewDecoder(cr.Body).Decode(&spot))
  	_ = cr.Body.Close()

  	ar := testutil.DoRequest(t, srv, "PUT",
  		"/festivals/"+festID+"/spots/"+spot.ID+"/artist",
  		`{"artist_id":"`+profileID+`"}`, orgToken)
  	require.Equal(t, http.StatusOK, ar.StatusCode, "provisional accept must be assignable pre-release")
  	_ = ar.Body.Close()
  }

  func TestSpots_IneligibleArtistRejected(t *testing.T) {
  	t.Parallel()
  	db := testutil.NewDB(t)

  	orgID, orgToken, _ := testutil.CreateUser(t, db)
  	artistUserID, _, _ := testutil.CreateUser(t, db)

  	festID, _ := createTestFestival(t, db, orgID, "open")
  	createTestApplicationForm(t, db, festID)
  	profileID := createTestArtistProfile(t, db, artistUserID, "Undecided Artist")
  	_ = createTestApplicationInFestival(t, db, festID, artistUserID) // submitted, no decision

  	r := chi.NewRouter()
  	r.Use(auth.Middleware(db, testSecret))
  	r.Post("/festivals/{festivalID}/spots", festival.CreateSpotHandler(db))
  	r.Put("/festivals/{festivalID}/spots/{spotID}/artist", festival.SetSpotArtistHandler(db))
  	srv := httptest.NewServer(r)
  	t.Cleanup(srv.Close)

  	cr := testutil.DoRequest(t, srv, "POST", "/festivals/"+festID+"/spots", `{"lat":51.9,"lng":-2.07}`, orgToken)
  	require.Equal(t, http.StatusCreated, cr.StatusCode)
  	var spot struct {
  		ID string `json:"id"`
  	}
  	require.NoError(t, json.NewDecoder(cr.Body).Decode(&spot))
  	_ = cr.Body.Close()

  	ar := testutil.DoRequest(t, srv, "PUT",
  		"/festivals/"+festID+"/spots/"+spot.ID+"/artist",
  		`{"artist_id":"`+profileID+`"}`, orgToken)
  	require.Equal(t, http.StatusUnprocessableEntity, ar.StatusCode, "undecided artist must not be assignable")
  	_ = ar.Body.Close()
  }
  ```

- [ ] **Step 15.2: Run — expect failure**

  ```bash
  cd api && go test ./internal/festival/ -race -count=1 -run 'TestSpots_ProvisionalAcceptIsSpotEligible|TestSpots_IneligibleArtistRejected'
  ```

  Expected: `TestSpots_ProvisionalAcceptIsSpotEligible` FAILS (the old pool query only
  returns released accepts, so the provisional accept is absent and assignment 422s).

- [ ] **Step 15.3: Switch the handler to the widened queries**

  In `api/internal/festival/spots.go`, in `GetSpotsHandler`, replace:

  ```go
  		artists, err := q.GetUnassignedAcceptedArtists(r.Context(), festUUID)
  ```

  with:

  ```go
  		artists, err := q.GetUnassignedSpotEligibleArtists(r.Context(), festUUID)
  ```

  The row type changes name but keeps fields `ArtistID` and `Name`, so the loop building
  `artistResps` is unchanged.

  In `SetSpotArtistHandler`, replace the guard block:

  ```go
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
  ```

  with:

  ```go
  		// Verify the artist is spot-eligible (released accept OR provisional accept).
  		if _, err = q.GetSpotEligibleArtist(r.Context(), sqlcdb.GetSpotEligibleArtistParams{
  			FestivalID: festUUID, ArtistID: artistUUID,
  		}); err != nil {
  			if errors.Is(err, pgx.ErrNoRows) {
  				httperr.UnprocessableEntity(w, "artist is not eligible to be placed for this festival")
  				return
  			}
  			httperr.InternalServerError(w)
  			return
  		}
  ```

- [ ] **Step 15.4: Remove the now-dead queries and regenerate**

  `GetUnassignedAcceptedArtists` and `GetAcceptedArtistForFestival` are now unused. Confirm,
  then delete them from `db/queries/festival_spots.sql` / `db/queries/festival_artists.sql`:

  ```bash
  grep -rn "GetUnassignedAcceptedArtists\|GetAcceptedArtistForFestival" api/internal/ | grep -v sqlcdb
  # Expected: no matches outside generated sqlcdb. If any remain, leave the query in place.
  ```

  If clean, remove both query blocks, then:

  ```bash
  task db:generate && cd api && go build ./...
  ```

- [ ] **Step 15.5: Run — expect pass**

  ```bash
  cd api && go test ./internal/festival/ -race -count=1 -run 'TestSpots_'
  ```

  Expected: all spots tests PASS (the 2 new + pre-existing). Then `task api:lint`.

- [ ] **Step 15.6: Commit**

  ```bash
  git add api/internal/festival/spots.go api/internal/festival/spots_test.go db/queries/ api/internal/sqlcdb/
  git commit -m "feat(festival): allow pre-release spot assignment for provisional accepts"
  ```

---

## Task 16: Auto-clear spot on revocation (TDD)

**Files:**
- Test: `api/internal/festival/spots_test.go`
- Modify: `api/internal/festival/patch.go`, `waitlist.go`, `review.go`, `release.go`

- [ ] **Step 16.1: Write the failing test**

  Add to `spots_test.go`:

  ```go
  func TestSpots_RestagingAwayFromAcceptClearsSpot(t *testing.T) {
  	t.Parallel()
  	db := testutil.NewDB(t)

  	orgID, orgToken, _ := testutil.CreateUser(t, db)
  	artistUserID, _, _ := testutil.CreateUser(t, db)

  	festID, _ := createTestFestival(t, db, orgID, "open")
  	createTestApplicationForm(t, db, festID)
  	profileID := createTestArtistProfile(t, db, artistUserID, "Flip Artist")
  	appID := createTestApplicationInFestival(t, db, festID, artistUserID)

  	dec := "accept"
  	_, err := sqlcdb.New(db).UpdateApplicationFlags(t.Context(), sqlcdb.UpdateApplicationFlagsParams{
  		ID: pgUUID(t, appID), Shortlisted: false, ReviewFlag: false, StagedDecision: &dec,
  	})
  	require.NoError(t, err)

  	r := chi.NewRouter()
  	r.Use(auth.Middleware(db, testSecret))
  	r.Post("/festivals/{festivalID}/spots", festival.CreateSpotHandler(db))
  	r.Put("/festivals/{festivalID}/spots/{spotID}/artist", festival.SetSpotArtistHandler(db))
  	r.Get("/festivals/{festivalID}/spots", festival.GetSpotsHandler(db))
  	r.Patch("/festivals/{festivalID}/applications/{applicationID}", festival.PatchApplicationHandler(db))
  	srv := httptest.NewServer(r)
  	t.Cleanup(srv.Close)

  	// Assign the provisional accept to a spot.
  	cr := testutil.DoRequest(t, srv, "POST", "/festivals/"+festID+"/spots", `{"lat":51.9,"lng":-2.07}`, orgToken)
  	require.Equal(t, http.StatusCreated, cr.StatusCode)
  	var spot struct{ ID string `json:"id"` }
  	require.NoError(t, json.NewDecoder(cr.Body).Decode(&spot))
  	_ = cr.Body.Close()
  	ar := testutil.DoRequest(t, srv, "PUT", "/festivals/"+festID+"/spots/"+spot.ID+"/artist",
  		`{"artist_id":"`+profileID+`"}`, orgToken)
  	require.Equal(t, http.StatusOK, ar.StatusCode)
  	_ = ar.Body.Close()

  	// Re-stage to decline — the spot assignment must be cleared.
  	pr := testutil.DoRequest(t, srv, "PATCH", "/festivals/"+festID+"/applications/"+appID,
  		`{"shortlisted":false,"review_flag":false,"staged_decision":"decline"}`, orgToken)
  	require.Equal(t, http.StatusOK, pr.StatusCode)
  	_ = pr.Body.Close()

  	// The spot still exists but is now unassigned.
  	gr := testutil.DoRequest(t, srv, "GET", "/festivals/"+festID+"/spots", "", orgToken)
  	require.Equal(t, http.StatusOK, gr.StatusCode)
  	var body struct {
  		Spots []struct {
  			ID       string  `json:"id"`
  			ArtistID *string `json:"artist_id"`
  		} `json:"spots"`
  	}
  	require.NoError(t, json.NewDecoder(gr.Body).Decode(&body))
  	_ = gr.Body.Close()
  	require.Len(t, body.Spots, 1)
  	require.Nil(t, body.Spots[0].ArtistID, "spot must be cleared after re-staging away from accept")
  }
  ```

- [ ] **Step 16.2: Run — expect failure**

  ```bash
  cd api && go test ./internal/festival/ -race -count=1 -run TestSpots_RestagingAwayFromAcceptClearsSpot
  ```

  Expected: FAIL — the spot keeps the artist after re-staging to decline.

- [ ] **Step 16.3: Clear in `patch.go`**

  In `api/internal/festival/patch.go`, capture the application (it's currently discarded
  at line 54):

  ```go
  		app, ok := getApplicationForFestival(r.Context(), q, w, festUUID, appUUID)
  		if !ok {
  			return
  		}
  ```

  Then after the successful `UpdateApplicationFlags` (after line 89, before writing the
  response), add:

  ```go
  		// No-awareness invariant: a spot may only belong to a (provisional or final)
  		// accept. If this application is no longer staged 'accept', clear any spot it holds.
  		if req.StagedDecision == nil || *req.StagedDecision != "accept" {
  			if err := q.ClearSpotAssignmentForArtist(r.Context(), sqlcdb.ClearSpotAssignmentForArtistParams{
  				FestivalID: festUUID, ArtistID: app.ArtistID,
  			}); err != nil {
  				httperr.InternalServerError(w)
  				return
  			}
  		}
  ```

- [ ] **Step 16.4: Clear in the direct waitlist + decline handlers**

  In `api/internal/festival/waitlist.go`, after the successful `UpdateApplicationStatus`
  (before `sendApplicationNotification`), add:

  ```go
  		if err := q.ClearSpotAssignmentForArtist(r.Context(), sqlcdb.ClearSpotAssignmentForArtistParams{
  			FestivalID: festUUID, ArtistID: app.ArtistID,
  		}); err != nil {
  			httperr.InternalServerError(w)
  			return
  		}
  ```

  In `api/internal/festival/review.go`, in `DeclineApplicationHandler`, add the identical
  block after its `UpdateApplicationStatus` and before `sendApplicationNotification`.

- [ ] **Step 16.5: Clear in the release sweep**

  In `api/internal/festival/release.go`, change the per-application loop so non-accepts
  clear any spot held during a provisional-accept window:

  ```go
  		for _, app := range released {
  			if app.Status == sqlcdb.ApplicationStatusAccepted {
  				if _, err := q.AddFestivalArtist(r.Context(), sqlcdb.AddFestivalArtistParams{
  					FestivalID: festUUID,
  					ArtistID:   app.ArtistID,
  					Status:     sqlcdb.FestivalArtistStatusAccepted,
  				}); err != nil {
  					httperr.InternalServerError(w)
  					return
  				}
  			} else {
  				// Safety net: an artist provisionally assigned a spot, then downgraded,
  				// must not keep the spot into the live festival.
  				if err := q.ClearSpotAssignmentForArtist(r.Context(), sqlcdb.ClearSpotAssignmentForArtistParams{
  					FestivalID: festUUID, ArtistID: app.ArtistID,
  				}); err != nil {
  					httperr.InternalServerError(w)
  					return
  				}
  			}
  			sendApplicationNotification(pool, mailer, app.ArtistID, fest.Name, string(app.Status))
  		}
  ```

- [ ] **Step 16.6: Run — expect pass**

  ```bash
  cd api && go test ./internal/festival/ -race -count=1
  ```

  Expected: all festival tests PASS (new clear test green; `release_test.go`,
  `waitlist_test.go`, `patch_test.go` still green). Then `task api:lint`.

- [ ] **Step 16.7: Commit**

  ```bash
  git add api/internal/festival/patch.go api/internal/festival/waitlist.go api/internal/festival/review.go api/internal/festival/release.go api/internal/festival/spots_test.go
  git commit -m "feat(festival): auto-clear spot assignment when artist loses accept status"
  ```

---

## Task 17: No artist awareness pre-release (TDD)

Closes the artist-queryable leaks: `/me/applications` exposing review signals, and the
public appearances query surfacing pre-release spot assignments.

**Files:**
- Test: `api/internal/festival/my_applications_test.go`, `appearances_test.go`
- Modify: `api/internal/festival/application.go` (add `toMyApplicationResponse`)
- Modify: `api/internal/festival/my_applications.go`
- Modify: `db/queries/festival_artists.sql` (gate appearances spot-branch on `live`)
- Modify: `openapi/openapi.yaml` (+ codegen)

- [ ] **Step 17.1: Write the failing tests**

  Add to `api/internal/festival/my_applications_test.go`:

  ```go
  func TestMyApplications_HidesReviewSignals(t *testing.T) {
  	t.Parallel()
  	db := testutil.NewDB(t)

  	orgID, _, _ := testutil.CreateUser(t, db)
  	artistUserID, artistToken, _ := testutil.CreateUser(t, db)

  	festID, _ := createTestFestival(t, db, orgID, "open")
  	createTestApplicationForm(t, db, festID)
  	createTestArtistProfile(t, db, artistUserID, "Privacy Artist")
  	appID := createTestApplicationInFestival(t, db, festID, artistUserID)

  	// Organiser stages 'accept' and shortlists — internal review signals.
  	dec := "accept"
  	_, err := sqlcdb.New(db).UpdateApplicationFlags(t.Context(), sqlcdb.UpdateApplicationFlagsParams{
  		ID: pgUUID(t, appID), Shortlisted: true, ReviewFlag: true, StagedDecision: &dec,
  	})
  	require.NoError(t, err)

  	handler := auth.Middleware(db, testSecret)(festival.GetMyApplicationsHandler(db))
  	r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/me/applications", nil)
  	r.Header.Set("Authorization", "Bearer "+artistToken)
  	w := httptest.NewRecorder()
  	handler.ServeHTTP(w, r)

  	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
  	body := w.Body.String()
  	// Artist must see status (still 'submitted') but NONE of the review signals.
  	require.Contains(t, body, `"status":"submitted"`)
  	require.NotContains(t, body, "staged_decision")
  	require.NotContains(t, body, "shortlisted")
  	require.NotContains(t, body, "review_flag")
  	require.NotContains(t, body, `"rank"`)
  }
  ```

  Add to `api/internal/festival/appearances_test.go`:

  ```go
  func TestAppearances_PreReleaseSpotDoesNotLeak(t *testing.T) {
  	t.Parallel()
  	db := testutil.NewDB(t)

  	orgID, _, _ := testutil.CreateUser(t, db)
  	artistUserID, _, _ := testutil.CreateUser(t, db)

  	festID, _ := createTestFestival(t, db, orgID, "open") // open = under review, not released
  	createTestApplicationForm(t, db, festID)
  	profileID := createTestArtistProfile(t, db, artistUserID, "Appear Artist")
  	appID := createTestApplicationInFestival(t, db, festID, artistUserID)

  	q := sqlcdb.New(db)
  	dec := "accept"
  	_, err := q.UpdateApplicationFlags(t.Context(), sqlcdb.UpdateApplicationFlagsParams{
  		ID: pgUUID(t, appID), Shortlisted: false, ReviewFlag: false, StagedDecision: &dec,
  	})
  	require.NoError(t, err)
  	// Provisionally assign a spot to this artist on the still-open festival.
  	lat, _ := numericForTest(t, 51.9)
  	lng, _ := numericForTest(t, -2.07)
  	spot, err := q.CreateFestivalSpot(t.Context(), sqlcdb.CreateFestivalSpotParams{
  		FestivalID: pgUUID(t, festID), Lat: lat, Lng: lng,
  	})
  	require.NoError(t, err)
  	_, err = q.SetFestivalSpotArtist(t.Context(), sqlcdb.SetFestivalSpotArtistParams{
  		ID: spot.ID, FestivalID: pgUUID(t, festID), ArtistID: pgUUID(t, profileID),
  	})
  	require.NoError(t, err)

  	// Public appearances for this artist must NOT include the open festival.
  	r := chi.NewRouter()
  	r.Get("/profiles/{profileID}/festivals", festival.ListArtistFestivalsHandler(db))
  	srv := httptest.NewServer(r)
  	t.Cleanup(srv.Close)

  	resp := testutil.DoRequest(t, srv, "GET", "/profiles/"+profileID+"/festivals", "", "")
  	require.Equal(t, http.StatusOK, resp.StatusCode)
  	var appearances []map[string]any
  	require.NoError(t, json.NewDecoder(resp.Body).Decode(&appearances))
  	_ = resp.Body.Close()
  	require.Empty(t, appearances, "a pre-release spot assignment must not surface publicly")
  }
  ```

  > **Helper note:** if `spots_test.go` already has a numeric helper, reuse it; otherwise add
  > a small `numericForTest(t, f float64) (pgtype.Numeric, error)` that wraps
  > `(&pgtype.Numeric{}).Scan(strconv.FormatFloat(f,'f',-1,64))` — or create the spot via the
  > `CreateSpotHandler` HTTP route instead (mirrors `TestSpots_*`), avoiding the numeric type.

- [ ] **Step 17.2: Run — expect failure**

  ```bash
  cd api && go test ./internal/festival/ -race -count=1 -run 'TestMyApplications_HidesReviewSignals|TestAppearances_PreReleaseSpotDoesNotLeak'
  ```

  Expected: both FAIL — `/me/applications` currently emits `staged_decision` etc., and the
  appearances query currently matches the open festival via its spot branch.

- [ ] **Step 17.3: Add the artist-safe response and use it**

  In `api/internal/festival/application.go`, add:

  ```go
  // myApplicationResponse is the artist-facing view of their own application. It
  // deliberately omits all organiser/review signals (staged_decision, shortlisted,
  // review_flag, rank, scores, notes) — an artist must learn nothing about the outcome
  // until decisions are released. `status` stays 'submitted' until release, so it leaks
  // nothing.
  type myApplicationResponse struct {
  	ID        string          `json:"id"`
  	FormID    string          `json:"form_id"`
  	ArtistID  string          `json:"artist_id"`
  	Status    string          `json:"status"`
  	Answers   json.RawMessage `json:"answers"`
  	CreatedAt string          `json:"created_at"`
  	UpdatedAt string          `json:"updated_at"`
  }

  func toMyApplicationResponse(a sqlcdb.Application) myApplicationResponse {
  	return myApplicationResponse{
  		ID:        a.ID.String(),
  		FormID:    a.FormID.String(),
  		ArtistID:  a.ArtistID.String(),
  		Status:    string(a.Status),
  		Answers:   a.Answers,
  		CreatedAt: a.CreatedAt.Time.Format(time.RFC3339),
  		UpdatedAt: a.UpdatedAt.Time.Format(time.RFC3339),
  	}
  }
  ```

  In `api/internal/festival/my_applications.go`, change the response builder:

  ```go
  		resp := make([]myApplicationResponse, len(apps))
  		for i, a := range apps {
  			resp[i] = toMyApplicationResponse(a)
  		}
  ```

  And update the empty-profile early return from `[]applicationResponse{}` to
  `[]myApplicationResponse{}`.

- [ ] **Step 17.4: Gate the appearances spot-branch on `live`**

  In `db/queries/festival_artists.sql`, in `ListPublicFestivalsForArtist`, change the spot
  `EXISTS` branch to only match live festivals:

  ```sql
      OR (f.status = 'live' AND EXISTS (
        SELECT 1 FROM festival_spots fs
        WHERE fs.festival_id = f.id
          AND fs.artist_id = $1
      ))
  ```

  Then regenerate:

  ```bash
  task db:generate && cd api && go build ./...
  ```

- [ ] **Step 17.5: Run — expect pass**

  ```bash
  cd api && go test ./internal/festival/ -race -count=1
  ```

  Expected: both new tests PASS; existing `my_applications_test.go` / `appearances_test.go`
  still green (adjust any existing assertion that expected the old `/me/applications` shape —
  if a prior test asserted `staged_decision` on that endpoint, it was asserting the leak;
  update it to assert absence).

- [ ] **Step 17.6: Update OpenAPI + codegen**

  In `openapi/openapi.yaml`, add a `MyApplication` schema (after `Application`):

  ```yaml
      MyApplication:
        type: object
        required: [id, form_id, artist_id, status, answers, created_at, updated_at]
        properties:
          id: { type: string, format: uuid }
          form_id: { type: string, format: uuid }
          artist_id: { type: string, format: uuid }
          status: { $ref: "#/components/schemas/ApplicationStatus" }
          answers: { type: object, additionalProperties: true }
          created_at: { type: string, format: date-time }
          updated_at: { type: string, format: date-time }
  ```

  Change the `/me/applications` response items ref from `Application` to `MyApplication`:

  ```yaml
                items:
                  $ref: "#/components/schemas/MyApplication"
  ```

  Then:

  ```bash
  task openapi:gen && task web:lint
  ```

  Expected: codegen succeeds; web type-check passes (the artist applications page only reads
  `app.status`, so the narrower type is compatible). If the React Native app consumes
  `/me/applications`, confirm it doesn't reference the removed fields (`grep -rn "staged_decision\|shortlisted" mobile/src` → expected: no artist-facing usage).

- [ ] **Step 17.7: Commit**

  ```bash
  git add api/internal/festival/application.go api/internal/festival/my_applications.go api/internal/festival/my_applications_test.go api/internal/festival/appearances_test.go db/queries/ api/internal/sqlcdb/ openapi/openapi.yaml openapi/generated/ api/internal/openapi/
  git commit -m "feat(festival): no artist awareness pre-release — hide review signals + gate appearances"
  ```

---

## Task 18: Web — drag-and-drop artist rail

**Files:**
- Modify: `web/src/app/organiser/festivals/[id]/map/MapEditorClient.tsx`

- [ ] **Step 18.1: Add assign mutation + drag-state**

  In `MapEditorClient`, after `dragSpotMutation`, add an assignment mutation:

  ```tsx
  const assignArtistMutation = useMutation({
    mutationFn: async ({ spotId, artistId }: { spotId: string; artistId: string }) => {
      const res = await apiClient.PUT('/festivals/{festivalID}/spots/{spotID}/artist', {
        params: { path: { festivalID: festivalId, spotID: spotId } },
        body: { artist_id: artistId },
      })
      if (res.error) throw new Error('Failed to assign artist')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['spots', festivalId] }),
    onError: (e: Error) => setPlaceError(e.message),
  })

  const [draggingArtistId, setDraggingArtistId] = useState<string | null>(null)
  ```

- [ ] **Step 18.2: Add a nearest-spot hit-test helper component**

  The map drop needs access to the Leaflet map instance. Add a ref-capturing child inside
  `<MapContainer>` that records the map, plus the drop logic on the container. Add this
  component near `MapViewUpdater`:

  ```tsx
  function MapRefCapture({ onReady }: { onReady: (map: L.Map) => void }) {
    const map = useMap()
    useEffect(() => { onReady(map) }, [map, onReady])
    return null
  }
  ```

  In `MapEditorClient`, add `const mapRef = useRef<L.Map | null>(null)` (import `useRef`),
  and inside `<MapContainer>` add `<MapRefCapture onReady={(m) => { mapRef.current = m }} />`.

- [ ] **Step 18.3: Make the map container a drop target**

  Wrap the map `<div className="border ...">` with native DnD handlers that hit-test the
  drop point against spot markers:

  ```tsx
  <div
    className="border border-light rounded-lg overflow-hidden"
    style={{ height: '500px' }}
    onDragOver={(e) => { if (draggingArtistId) e.preventDefault() }}
    onDrop={(e) => {
      e.preventDefault()
      const artistId = e.dataTransfer.getData('text/artist-id') || draggingArtistId
      const map = mapRef.current
      if (!artistId || !map) return
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const dropPt = L.point(e.clientX - rect.left, e.clientY - rect.top)
      // Find the nearest spot marker within 35px.
      let nearest: { id: string; dist: number } | null = null
      for (const s of spots) {
        if (s.lat == null || s.lng == null || !s.id) continue
        const pt = map.latLngToContainerPoint([s.lat, s.lng])
        const dist = pt.distanceTo(dropPt)
        if (dist <= 35 && (!nearest || dist < nearest.dist)) nearest = { id: s.id, dist }
      }
      setDraggingArtistId(null)
      if (nearest) assignArtistMutation.mutate({ spotId: nearest.id, artistId })
    }}
  >
    <MapContainer ...> ... </MapContainer>
  </div>
  ```

  (Keep the existing `<MapContainer>` children; only the wrapping `<div>` gains the handlers.)

- [ ] **Step 18.4: Render the unassigned-artist rail**

  Add a third column to the editor layout (after the map column, inside the
  `flex gap-6` row), listing the pool as draggable cards:

  ```tsx
  <div className="w-56 flex-shrink-0">
    <h2 className="font-mono text-xs text-mid uppercase tracking-widest mb-2">
      Unassigned · {unassignedArtists.length}
    </h2>
    <ul className="space-y-1" data-testid="artist-rail">
      {unassignedArtists.map(a => (
        <li
          key={a.artist_id}
          draggable
          onDragStart={(e) => {
            if (a.artist_id) {
              e.dataTransfer.setData('text/artist-id', a.artist_id)
              setDraggingArtistId(a.artist_id)
            }
          }}
          onDragEnd={() => setDraggingArtistId(null)}
          className="cursor-grab active:cursor-grabbing bg-warm border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink hover:border-amber"
        >
          {a.name}
        </li>
      ))}
      {unassignedArtists.length === 0 && (
        <li className="font-sans text-xs text-mid">All placed 🎉</li>
      )}
    </ul>
    <p className="font-sans text-xs text-mid mt-2">Drag a name onto a pin to assign.</p>
  </div>
  ```

- [ ] **Step 18.5: Type-check + manual test**

  ```bash
  task web:lint
  ```

  Manual: with a released (or provisionally-accepted) artist in the pool, drag a card onto a
  pin → it assigns (card leaves the rail, pin turns terracotta). Drop on empty map → no-op.

- [ ] **Step 18.6: Commit**

  ```bash
  git add web/src/app/organiser/festivals/\[id\]/map/MapEditorClient.tsx
  git commit -m "feat(web): drag artist cards from rail onto map pins to assign"
  ```

---

## Task 19: Web — organiser assignment summary

**Files:**
- Modify: `web/src/app/organiser/festivals/[id]/page.tsx`

- [ ] **Step 19.1: Add a Spot assignments section**

  This page is a Server Component. Add a small `'use client'` component that fetches
  `/festivals/{id}/spots` and renders the summary, then render it on the page. Create
  `web/src/app/organiser/festivals/[id]/SpotAssignmentSummary.tsx`:

  ```tsx
  'use client'

  import Link from 'next/link'
  import { useQuery } from '@tanstack/react-query'
  import { apiClient } from '@/lib/api'
  import type { components } from '@render/api-client'

  type FestivalSpotsResponse = components['schemas']['FestivalSpotsResponse']

  export function SpotAssignmentSummary({ festivalId }: { festivalId: string }) {
    const { data } = useQuery({
      queryKey: ['spots', festivalId],
      queryFn: async () => {
        const res = await apiClient.GET('/festivals/{festivalID}/spots', {
          params: { path: { festivalID: festivalId } },
        })
        if (res.error) throw new Error('Failed to load spots')
        return res.data as FestivalSpotsResponse
      },
    })

    const spots = data?.spots ?? []
    const unassigned = data?.unassigned_artists ?? []
    const assigned = spots.filter(s => s.artist_id)

    return (
      <section className="mt-8" data-testid="spot-assignment-summary">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-serif text-2xl text-ink">Spot assignments</h2>
          <Link href={`/organiser/festivals/${festivalId}/map`}
            className="font-mono text-xs text-mid uppercase tracking-widest hover:text-ink">
            Map editor{unassigned.length > 0 ? ` · ${unassigned.length} unassigned` : ''} →
          </Link>
        </div>
        <ul className="space-y-1">
          {assigned.map(s => (
            <li key={s.id} className="flex justify-between font-sans text-sm">
              <span className="text-ink">{s.artist_name}</span>
              <span className="text-mid">Spot {s.number} ✓</span>
            </li>
          ))}
          {unassigned.map(a => (
            <li key={a.artist_id} className="flex justify-between font-sans text-sm">
              <span className="text-ink">{a.name}</span>
              <span className="text-clay">unassigned ⚠</span>
            </li>
          ))}
          {assigned.length === 0 && unassigned.length === 0 && (
            <li className="font-sans text-sm text-mid">No accepted artists to place yet.</li>
          )}
        </ul>
      </section>
    )
  }
  ```

  In `web/src/app/organiser/festivals/[id]/page.tsx`, import and render
  `<SpotAssignmentSummary festivalId={...} />` in an appropriate spot (e.g. below the
  existing festival detail content). Pass the festival id the page already has.

- [ ] **Step 19.2: Type-check + commit**

  ```bash
  task web:lint
  git add web/src/app/organiser/festivals/\[id\]/page.tsx web/src/app/organiser/festivals/\[id\]/SpotAssignmentSummary.tsx
  git commit -m "feat(web): organiser spot-assignment summary on festival page"
  ```

---

## Task 20: e2e — assignment privacy + drag-drop

**Files:**
- Create: `e2e/api/spot-assignment-privacy.test.ts`
- Modify: `e2e/browser/map-pin-edit.spec.ts`

- [ ] **Step 20.1: API-gate privacy test (the "techie artist" threat model)**

  Create `e2e/api/spot-assignment-privacy.test.ts`:

  ```ts
  import { describe, it, expect } from 'vitest'
  import {
    createArtist, createOrganiser, createProfile, createFestival,
    setFestivalStatus, upsertForm, submitApplication, stageDecision,
    createSpot, assignArtistToSpot,
  } from '../fixtures/helpers'

  const API = process.env.API_URL ?? 'http://localhost:8080'

  describe('no artist awareness before release', () => {
    it('pre-release: artist can be assigned a spot but learns nothing via the API', async () => {
      const suffix = `privacy-${Date.now()}`
      const artist = await createArtist(suffix)
      await createProfile(artist.token, { displayName: `Privacy Artist ${suffix}` })
      const org = await createOrganiser(suffix)
      const { festivalId, slug } = await createFestival(org.token, {
        name: `Privacy Fest ${suffix}`, slug: `privacy-${suffix}`,
      })
      await upsertForm(org.token, festivalId)
      await setFestivalStatus(org.token, festivalId, 'open')
      const { applicationId } = await submitApplication(artist.token, festivalId)

      // Organiser stages accept (NO release) and assigns a spot pre-release.
      await stageDecision(org.token, festivalId, applicationId, 'accept')
      const spotsRes = await fetch(`${API}/festivals/${festivalId}/spots`, {
        headers: { Authorization: `Bearer ${org.token}` },
      })
      const { unassigned_artists } = await spotsRes.json()
      expect(unassigned_artists.length).toBe(1) // provisional accept is eligible
      const artistProfileId = unassigned_artists[0].artist_id
      const { spotId } = await createSpot(org.token, festivalId, 51.9, -2.07)
      await assignArtistToSpot(org.token, festivalId, spotId, artistProfileId)

      // 1. Artist's own /me/applications leaks no review signal.
      const mine = await fetch(`${API}/me/applications`, {
        headers: { Authorization: `Bearer ${artist.token}` },
      })
      const mineBody = await mine.text()
      expect(mine.status).toBe(200)
      expect(mineBody).toContain('"status":"submitted"')
      expect(mineBody).not.toContain('staged_decision')
      expect(mineBody).not.toContain('shortlisted')

      // 2. Public artist appearances don't show the unreleased festival.
      const appearances = await fetch(`${API}/profiles/${artistProfileId}/festivals`).then(r => r.json())
      expect(appearances.find((f: { slug: string }) => f.slug === slug)).toBeUndefined()

      // 3. Public map 404s (festival not live).
      const map = await fetch(`${API}/festivals/slug/${slug}/map`)
      expect(map.status).toBe(404)
    })

    it('re-staging away from accept clears the pre-release spot', async () => {
      const suffix = `clear-${Date.now()}`
      const artist = await createArtist(suffix)
      await createProfile(artist.token, { displayName: `Clear Artist ${suffix}` })
      const org = await createOrganiser(suffix)
      const { festivalId } = await createFestival(org.token, {
        name: `Clear Fest ${suffix}`, slug: `clear-${suffix}`,
      })
      await upsertForm(org.token, festivalId)
      await setFestivalStatus(org.token, festivalId, 'open')
      const { applicationId } = await submitApplication(artist.token, festivalId)
      await stageDecision(org.token, festivalId, applicationId, 'accept')

      const spotsRes = await fetch(`${API}/festivals/${festivalId}/spots`, {
        headers: { Authorization: `Bearer ${org.token}` },
      })
      const { unassigned_artists } = await spotsRes.json()
      const artistProfileId = unassigned_artists[0].artist_id
      const { spotId } = await createSpot(org.token, festivalId, 51.9, -2.07)
      await assignArtistToSpot(org.token, festivalId, spotId, artistProfileId)

      // Flip to decline → spot must clear.
      await stageDecision(org.token, festivalId, applicationId, 'decline')
      const after = await fetch(`${API}/festivals/${festivalId}/spots`, {
        headers: { Authorization: `Bearer ${org.token}` },
      }).then(r => r.json())
      const spot = after.spots.find((s: { id: string }) => s.id === spotId)
      expect(spot.artist_id).toBeNull()
    })
  })
  ```

- [ ] **Step 20.2: Run the privacy test**

  ```bash
  npx vitest run e2e/api/spot-assignment-privacy.test.ts
  ```

  Expected: both tests PASS.

- [ ] **Step 20.3: Browser drag-drop assignment test**

  Add to `e2e/browser/map-pin-edit.spec.ts` (the `stageDecision`/`releaseDecisions` imports
  from Task 10 are already present):

  ```ts
  test('drag an artist card onto a pin to assign (pre-release)', async ({ browser }) => {
    const suffix = `dragdrop-${Date.now()}`
    const baseURL = process.env.BASE_URL ?? 'http://localhost:3000'

    const artist = await createArtist(suffix)
    await createProfile(artist.token, { displayName: `DragDrop Artist ${suffix}` })
    const organiser = await createOrganiser(suffix)
    const { festivalId } = await createFestival(organiser.token, {
      name: `DragDrop Fest ${suffix}`, slug: `dragdrop-${suffix}`,
    })
    await upsertForm(organiser.token, festivalId)
    await setFestivalStatus(organiser.token, festivalId, 'open')
    const { applicationId } = await submitApplication(artist.token, festivalId)
    // Provisional accept — assignable before release.
    await stageDecision(organiser.token, festivalId, applicationId, 'accept')
    // Pre-create a spot to drop onto.
    await createSpot(organiser.token, festivalId, 51.9007, -2.0783)

    const { ctx, page } = await loginAs(browser, organiser.email, organiser.password, baseURL)
    try {
      await page.goto(`/organiser/festivals/${festivalId}/map`)
      await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 10_000 })
      await expect(page.getByTestId('artist-rail')).toContainText('DragDrop Artist')

      const card = page.getByTestId('artist-rail').getByText(/DragDrop Artist/)
      const marker = page.locator('.leaflet-marker-icon').first()
      await expect(marker).toBeVisible({ timeout: 5_000 })

      // Native HTML5 DnD: Playwright's dragTo drives dragstart/dragover/drop.
      await card.dragTo(marker)

      // Assignment landed: the card leaves the rail.
      await expect(page.getByTestId('artist-rail')).not.toContainText('DragDrop Artist', { timeout: 5_000 })

      // Confirm server-side.
      const spots = await fetch(`${API}/festivals/${festivalId}/spots`, {
        headers: { Authorization: `Bearer ${organiser.token}` },
      }).then(r => r.json())
      expect(spots.spots.some((s: { artist_name: string | null }) => s.artist_name?.includes('DragDrop Artist'))).toBe(true)
    } finally {
      await ctx.close()
    }
  })
  ```

  > If `card.dragTo(marker)` proves flaky over the Leaflet canvas, fall back to manual
  > `dispatchEvent` of `dragstart`/`drop` with a `DataTransfer`, or drop onto the sidebar
  > spot-list item instead of the marker (both are valid drop targets per the design).

- [ ] **Step 20.4: Run + commit**

  ```bash
  npx playwright test e2e/browser/map-pin-edit.spec.ts -g "drag an artist card"
  git add e2e/api/spot-assignment-privacy.test.ts e2e/browser/map-pin-edit.spec.ts
  git commit -m "test(e2e): pre-release assignment privacy + drag-drop assign"
  ```

---

## Task 21: Finalize + record demo V06

**Files:**
- Modify: `demos/scripts/V06-organiser-full.ts`

- [ ] **Step 21.1: Replace the dropdown-assignment step with drag-drop**

  In `demos/scripts/V06-organiser-full.ts`, replace the "── 14. Assign an accepted artist"
  block (the `selectOption` + Save) with a drag from the rail onto a pin:

  ```ts
    // ── 14. Drag an accepted artist from the rail onto the pin ────────────────
    await highlight(page, '[data-testid="artist-rail"]')
    await pause(800)
    const artistCard = page.getByTestId('artist-rail').getByText(/Kit Harrow/).first()
    const targetPin = page.locator('.leaflet-marker-icon').last()
    await artistCard.dragTo(targetPin)
    await pause(1500)
  ```

- [ ] **Step 21.2: Record + convert**

  ```bash
  cd demos && npm run record -- V06-organiser-full.ts
  cd demos && bash run.sh
  ```

  Produces `demos/output/V06.mp4`. Watch it back: search recenters, spot placed, marker
  dragged, artist card dragged onto pin, assignment shown.

- [ ] **Step 21.3: Commit**

  ```bash
  git add demos/scripts/V06-organiser-full.ts demos/output/V06.mp4
  git commit -m "demo(V06): drag-drop artist assignment + record"
  ```

---

## Task 22: Part 2 docs, invariants & kanban finalize

**Files:**
- Modify: `api/internal/festival/festival.spec.md`

- [ ] **Step 22.1: Update the festival spec Invariants + AI Context**

  In `api/internal/festival/festival.spec.md`:

  Update the existing spot-assignment invariant line (`spots.application_id` / accepted) to:

  ```markdown
  - A spot may be assigned to any *spot-eligible* artist: a `festival_artists` status=`accepted`
    row OR an application with `staged_decision = 'accept'` (provisional, pre-release). The
    guard is `GetSpotEligibleArtist`.
  ```

  Add to `## Invariants`:

  ```markdown
  - `festival_spots.artist_id` may only reference a spot-eligible artist. Revoking eligibility
    (re-stage to non-accept, un-stage, direct decline/waitlist, or release-as-non-accept)
    auto-clears the assignment via `ClearSpotAssignmentForArtist`. This keeps declined artists
    off the public map.
  - **No artist awareness before release.** Nothing artist-facing may reveal an outcome before
    `release-decisions`: `GET /me/applications` uses `toMyApplicationResponse` (no
    `staged_decision`/`shortlisted`/`review_flag`/`rank`); `ListPublicFestivalsForArtist`'s
    spot branch is gated on `status = 'live'`; spot assignment fires no notification.
  ```

  Add to `## AI Context`:

  ```markdown
  - `PATCH /spots/{id}` is a full replace of mutable fields — partial updates (e.g. drag) must
    resend `w3w`/`width_m`/`height_m`/`notes` or they're cleared.
  - The organiser-facing `ListApplicationsHandler` keeps the full `applicationResponse`
    (incl. `staged_decision`); only the artist-facing `/me/applications` is trimmed. Don't
    "unify" them back together.
  ```

  Add to `## Changelog`:

  ```markdown
  2026-06-04 — E23: pre-release spot eligibility + auto-clear invariant; no-artist-awareness
  (trimmed /me/applications, gated appearances); PATCH /spots full-replace note.
  ```

- [ ] **Step 22.2: Create sub-issues E23.6–E23.8 and wire to #243**

  ```bash
  gh issue create --repo sniffins-mcmuggins/murals \
    --title "[E23.6] Pre-release spot eligibility + orphan-pin / no-awareness invariants" \
    --label "type:task,area:api,area:db,priority:p1" \
    --body "Widen spot eligibility to provisional accepts; auto-clear on revocation; close artist-awareness leaks (/me/applications, public appearances). See design spec."

  gh issue create --repo sniffins-mcmuggins/murals \
    --title "[E23.7] Drag-and-drop artist assignment in map editor" \
    --label "type:task,area:web,priority:p1" \
    --body "Unassigned-artist rail beside the map; drag cards onto pins to assign. See design spec."

  gh issue create --repo sniffins-mcmuggins/murals \
    --title "[E23.8] Organiser spot-assignment summary on festival page" \
    --label "type:task,area:web,priority:p1" \
    --body "Compact assigned/unassigned summary + count badge on the festival detail page. See design spec."
  ```

  Wire each as a sub-issue of #243 and add to the board following the same `addSubIssue` /
  `addProjectV2ItemById` pattern as Task 13 steps 13.4–13.5.

- [ ] **Step 22.3: Run the full suite (whole epic)**

  Stack must be running (`task up`).

  ```bash
  task api:test
  task e2e
  ```

  Expected: all Go tests, API gate tests, and browser specs PASS.

- [ ] **Step 22.4: Commit**

  ```bash
  git add api/internal/festival/festival.spec.md
  git commit -m "docs(festival): E23 invariants — spot eligibility, auto-clear, no-awareness"
  ```

---

## Done

At this point the branch `e23-map-editor-superpowers` contains:

**Part 1 — map-editor UX**
- `api/internal/geocode/` — Nominatim proxy package with unit tests; `GET /geocode/search`
- `MapEditorClient` with address search, draggable markers, external map deep-links
- Browser E2E: full release→assign→public-map flow, search stub, drag persistence

**Part 2 — assignment workflow**
- Pre-release spot assignment for provisional accepts (widened eligibility + guard)
- Auto-clear invariant: a spot never points to a non-accept (patch/waitlist/decline/release)
- No artist awareness pre-release: trimmed `/me/applications`, gated public appearances,
  silent assignment — verified by a "techie artist" API-gate test
- Drag-and-drop artist rail; organiser assignment summary on the festival page
- Demo video V06 recorded with the full search→place→drag→assign flow
- `festival.spec.md` invariants updated; E23.1–E23.8 issues created and boarded

All Go API changes were built test-first (TDD). Invoke
`superpowers:finishing-a-development-branch` to review merge options.
