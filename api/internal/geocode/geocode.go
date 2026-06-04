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
	defer func() { _ = resp.Body.Close() }()

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
