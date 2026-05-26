package auth_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
)

const testSecret = "test-secret"

func TestMiddleware_ValidCookie(t *testing.T) {
	t.Parallel()
	token, err := auth.IssueToken("user-123", "artist", testSecret)
	require.NoError(t, err)

	var capturedPrincipal auth.Principal
	handler := auth.Middleware(testSecret)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p, err := auth.User(r.Context())
		require.NoError(t, err)
		capturedPrincipal = p
	}))

	r := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/me", nil)
	r.AddCookie(&http.Cookie{Name: "session", Value: token})
	handler.ServeHTTP(httptest.NewRecorder(), r)

	assert.Equal(t, "user-123", capturedPrincipal.UserID)
	assert.Equal(t, "artist", capturedPrincipal.Role)
}

func TestMiddleware_ValidBearerHeader(t *testing.T) {
	t.Parallel()
	token, err := auth.IssueToken("user-456", "organiser", testSecret)
	require.NoError(t, err)

	var capturedPrincipal auth.Principal
	handler := auth.Middleware(testSecret)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p, _ := auth.User(r.Context())
		capturedPrincipal = p
	}))

	r := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/me", nil)
	r.Header.Set("Authorization", "Bearer "+token)
	handler.ServeHTTP(httptest.NewRecorder(), r)

	assert.Equal(t, "user-456", capturedPrincipal.UserID)
}

func TestMiddleware_NoToken_PassesThrough(t *testing.T) {
	t.Parallel()
	called := false
	handler := auth.Middleware(testSecret)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		_, err := auth.User(r.Context())
		assert.ErrorIs(t, err, auth.ErrUnauthenticated)
	}))

	r := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	handler.ServeHTTP(httptest.NewRecorder(), r)

	assert.True(t, called, "handler was not called")
}

func TestMiddleware_InvalidToken_PassesThrough(t *testing.T) {
	t.Parallel()
	called := false
	handler := auth.Middleware(testSecret)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		_, err := auth.User(r.Context())
		assert.Error(t, err, "expected error for invalid token")
	}))

	r := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	r.AddCookie(&http.Cookie{Name: "session", Value: "not-a-jwt"})
	handler.ServeHTTP(httptest.NewRecorder(), r)

	assert.True(t, called, "handler was not called")
}

func TestMiddleware_CookieTakesPrecedenceOverHeader(t *testing.T) {
	t.Parallel()
	cookieToken, err := auth.IssueToken("cookie-user", "artist", testSecret)
	require.NoError(t, err)
	headerToken, err := auth.IssueToken("header-user", "organiser", testSecret)
	require.NoError(t, err)

	var capturedID string
	handler := auth.Middleware(testSecret)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p, _ := auth.User(r.Context())
		capturedID = p.UserID
	}))

	r := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	r.AddCookie(&http.Cookie{Name: "session", Value: cookieToken})
	r.Header.Set("Authorization", "Bearer "+headerToken)
	handler.ServeHTTP(httptest.NewRecorder(), r)

	assert.Equal(t, "cookie-user", capturedID)
}

func TestMiddleware_IgnoresWrongContext(t *testing.T) {
	t.Parallel()
	_, err := auth.User(context.Background())
	assert.ErrorIs(t, err, auth.ErrUnauthenticated)
}
