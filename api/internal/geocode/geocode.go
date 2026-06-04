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
	httpClient *http.Client //nolint:unused // will be used in implementation
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
