package auth_test

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	chiMiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/stretchr/testify/assert"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
)

func TestRateLimit_AllowsBurst(t *testing.T) {
	// Use a unique IP so this test doesn't share state with other tests
	ip := "10.0.0.100:12345"
	handler := auth.RateLimitMiddleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// Burst of 5 should all succeed
	for i := 0; i < 5; i++ {
		r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/test", nil)
		r.RemoteAddr = ip
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		assert.Equal(t, http.StatusOK, w.Code, "request %d should be allowed", i+1)
	}

	// 6th request should be rate-limited
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/test", nil)
	r.RemoteAddr = ip
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	assert.Equal(t, http.StatusTooManyRequests, w.Code)
	assert.Equal(t, "60", w.Header().Get("Retry-After"))
}

func TestRateLimit_DifferentIPsIndependent(t *testing.T) {
	handler := auth.RateLimitMiddleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// Exhaust IP A
	for i := 0; i < 6; i++ {
		r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/test", nil)
		r.RemoteAddr = "10.0.0.200:1"
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		_ = w
	}

	// IP B should still be allowed
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/test", nil)
	r.RemoteAddr = "10.0.0.201:1"
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	assert.Equal(t, http.StatusOK, w.Code)
}

func TestRateLimit_DifferentPortsSameIP(t *testing.T) {
	handler := auth.RateLimitMiddleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// 5 requests from same IP with different ports — should count as same bucket
	for i := 0; i < 5; i++ {
		r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/test", nil)
		r.RemoteAddr = fmt.Sprintf("10.0.0.150:%d", 10000+i)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		assert.Equal(t, http.StatusOK, w.Code)
	}

	// 6th from yet another port should be limited
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/test", nil)
	r.RemoteAddr = "10.0.0.150:30000"
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	assert.Equal(t, http.StatusTooManyRequests, w.Code)
}

// TestRateLimit_RealIPRewritesRemoteAddr is the integration test for the
// production setup: in main.go the router applies chiMiddleware.RealIP before
// RateLimitMiddleware. RealIP rewrites r.RemoteAddr from X-Forwarded-For; the
// limiter then keys on the rewritten value. This ensures the two middlewares
// cooperate correctly (and that we haven't reintroduced double XFF parsing).
func TestRateLimit_RealIPRewritesRemoteAddr(t *testing.T) {
	handler := chiMiddleware.RealIP(auth.RateLimitMiddleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})))

	// Exhaust: XFF "203.0.113.99" is what RealIP will rewrite RemoteAddr to.
	for i := 0; i < 6; i++ {
		r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/test", nil)
		r.RemoteAddr = "10.0.0.50:1"
		r.Header.Set("X-Forwarded-For", "203.0.113.99")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		_ = w
	}

	// Same XFF (via RealIP) should be limited.
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/test", nil)
	r.RemoteAddr = "10.0.0.50:1"
	r.Header.Set("X-Forwarded-For", "203.0.113.99")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	assert.Equal(t, http.StatusTooManyRequests, w.Code)
}
