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
	_, _ = c.Search(context.Background(), "bristol") // same key — should hit cache
	_, _ = c.Search(context.Background(), "BRISTOL") // case-insensitive — same cache key

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
