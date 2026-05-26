package auth_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
)

const testSecret = "test-secret"

func TestMiddleware_ValidCookie(t *testing.T) {
	token, err := auth.IssueToken("user-123", "artist", testSecret)
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}

	var capturedPrincipal auth.Principal
	handler := auth.Middleware(testSecret)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p, err := auth.User(r.Context())
		if err != nil {
			t.Errorf("expected principal, got error: %v", err)
			return
		}
		capturedPrincipal = p
	}))

	r := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/me", nil)
	r.AddCookie(&http.Cookie{Name: "session", Value: token})
	handler.ServeHTTP(httptest.NewRecorder(), r)

	if capturedPrincipal.UserID != "user-123" {
		t.Errorf("expected user-123, got %q", capturedPrincipal.UserID)
	}
	if capturedPrincipal.Role != "artist" {
		t.Errorf("expected artist, got %q", capturedPrincipal.Role)
	}
}

func TestMiddleware_ValidBearerHeader(t *testing.T) {
	token, _ := auth.IssueToken("user-456", "organiser", testSecret)

	var capturedPrincipal auth.Principal
	handler := auth.Middleware(testSecret)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p, _ := auth.User(r.Context())
		capturedPrincipal = p
	}))

	r := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/me", nil)
	r.Header.Set("Authorization", "Bearer "+token)
	handler.ServeHTTP(httptest.NewRecorder(), r)

	if capturedPrincipal.UserID != "user-456" {
		t.Errorf("expected user-456, got %q", capturedPrincipal.UserID)
	}
}

func TestMiddleware_NoToken_PassesThrough(t *testing.T) {
	called := false
	handler := auth.Middleware(testSecret)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		_, err := auth.User(r.Context())
		if err == nil {
			t.Error("expected ErrUnauthenticated, got nil")
		}
	}))

	r := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	handler.ServeHTTP(httptest.NewRecorder(), r)

	if !called {
		t.Error("handler was not called")
	}
}

func TestMiddleware_InvalidToken_PassesThrough(t *testing.T) {
	called := false
	handler := auth.Middleware(testSecret)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		_, err := auth.User(r.Context())
		if err == nil {
			t.Error("expected error for invalid token")
		}
	}))

	r := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	r.AddCookie(&http.Cookie{Name: "session", Value: "not-a-jwt"})
	handler.ServeHTTP(httptest.NewRecorder(), r)

	if !called {
		t.Error("handler was not called")
	}
}

func TestMiddleware_CookieTakesPrecedenceOverHeader(t *testing.T) {
	cookieToken, _ := auth.IssueToken("cookie-user", "artist", testSecret)
	headerToken, _ := auth.IssueToken("header-user", "organiser", testSecret)

	var capturedID string
	handler := auth.Middleware(testSecret)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p, _ := auth.User(r.Context())
		capturedID = p.UserID
	}))

	r := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	r.AddCookie(&http.Cookie{Name: "session", Value: cookieToken})
	r.Header.Set("Authorization", "Bearer "+headerToken)
	handler.ServeHTTP(httptest.NewRecorder(), r)

	if capturedID != "cookie-user" {
		t.Errorf("expected cookie-user, got %q", capturedID)
	}
}

func TestMiddleware_IgnoresWrongContext(t *testing.T) {
	_, err := auth.User(context.Background())
	if err != auth.ErrUnauthenticated {
		t.Errorf("expected ErrUnauthenticated, got %v", err)
	}
}
