package auth_test

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

const testSecret = "test-secret"

// createUserAndIssueToken creates a real user row and returns the user's UUID
// (as a string, suitable for JWT subject) plus a valid token bound to that
// user's current session_version. The auth middleware reads the row from the
// DB to validate the embedded sv, so the token has to refer to a real user.
func createUserAndIssueToken(t *testing.T, db *pgxpool.Pool, isAdmin bool) (userID, token, email string) {
	t.Helper()
	email = fmt.Sprintf("t-%d@t.local", authUserSeq.Add(1))
	q := sqlcdb.New(db)
	pwHash := "x"
	user, err := q.CreateUser(t.Context(), sqlcdb.CreateUserParams{
		Email:        email,
		PasswordHash: &pwHash,
	})
	require.NoError(t, err)
	userID = user.ID.String()
	token, err = auth.IssueToken(userID, isAdmin, user.SessionVersion, testSecret)
	require.NoError(t, err)
	return userID, token, email
}

func TestMiddleware_ValidCookie(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	userID, token, _ := createUserAndIssueToken(t, db, false)

	var capturedPrincipal auth.Principal
	handler := auth.Middleware(db, testSecret)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p, err := auth.User(r.Context())
		require.NoError(t, err)
		capturedPrincipal = p
	}))

	r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/me", nil)
	r.AddCookie(&http.Cookie{Name: "session", Value: token})
	handler.ServeHTTP(httptest.NewRecorder(), r)

	assert.Equal(t, userID, capturedPrincipal.UserID)
	assert.Equal(t, false, capturedPrincipal.IsAdmin)
}

func TestMiddleware_ValidBearerHeader(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	userID, token, _ := createUserAndIssueToken(t, db, false)

	var capturedPrincipal auth.Principal
	handler := auth.Middleware(db, testSecret)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p, _ := auth.User(r.Context())
		capturedPrincipal = p
	}))

	r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/me", nil)
	r.Header.Set("Authorization", "Bearer "+token)
	handler.ServeHTTP(httptest.NewRecorder(), r)

	assert.Equal(t, userID, capturedPrincipal.UserID)
}

func TestMiddleware_NoToken_PassesThrough(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	called := false
	handler := auth.Middleware(db, testSecret)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		_, err := auth.User(r.Context())
		assert.ErrorIs(t, err, auth.ErrUnauthenticated)
	}))

	r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/", nil)
	handler.ServeHTTP(httptest.NewRecorder(), r)

	assert.True(t, called, "handler was not called")
}

func TestMiddleware_InvalidToken_PassesThrough(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	called := false
	handler := auth.Middleware(db, testSecret)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		_, err := auth.User(r.Context())
		assert.Error(t, err, "expected error for invalid token")
	}))

	r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/", nil)
	r.AddCookie(&http.Cookie{Name: "session", Value: "not-a-jwt"})
	handler.ServeHTTP(httptest.NewRecorder(), r)

	assert.True(t, called, "handler was not called")
}

func TestMiddleware_CookieTakesPrecedenceOverHeader(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	cookieUserID, cookieToken, _ := createUserAndIssueToken(t, db, false)
	_, headerToken, _ := createUserAndIssueToken(t, db, false)

	var capturedID string
	handler := auth.Middleware(db, testSecret)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p, _ := auth.User(r.Context())
		capturedID = p.UserID
	}))

	r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/", nil)
	r.AddCookie(&http.Cookie{Name: "session", Value: cookieToken})
	r.Header.Set("Authorization", "Bearer "+headerToken)
	handler.ServeHTTP(httptest.NewRecorder(), r)

	assert.Equal(t, cookieUserID, capturedID)
}

func TestMiddleware_IgnoresWrongContext(t *testing.T) {
	t.Parallel()
	_, err := auth.User(context.Background())
	assert.ErrorIs(t, err, auth.ErrUnauthenticated)
}

// TestMiddleware_StaleSessionVersionRejected proves the password-reset
// revocation path actually works: after IncrementSessionVersion is called on
// a user, any JWT issued before the bump fails the middleware's sv check and
// is treated as if no token was supplied.
func TestMiddleware_StaleSessionVersionRejected(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	_, staleToken, staleEmail := createUserAndIssueToken(t, db, false)

	// Look the user up, bump session_version (simulating a password reset).
	q := sqlcdb.New(db)
	user, err := q.GetUserByEmail(t.Context(), staleEmail)
	require.NoError(t, err)
	_, err = q.IncrementSessionVersion(t.Context(), user.ID)
	require.NoError(t, err)

	// The old token should now be rejected — handler runs, but no Principal.
	called := false
	handler := auth.Middleware(db, testSecret)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		_, err := auth.User(r.Context())
		assert.ErrorIs(t, err, auth.ErrUnauthenticated, "stale token must not produce a Principal")
	}))
	r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/", nil)
	r.AddCookie(&http.Cookie{Name: "session", Value: staleToken})
	handler.ServeHTTP(httptest.NewRecorder(), r)
	assert.True(t, called)

	// A fresh token (with the new sv) should still work.
	freshToken, err := auth.IssueToken(user.ID.String(), false, user.SessionVersion+1, testSecret)
	require.NoError(t, err)
	freshCalled := false
	freshHandler := auth.Middleware(db, testSecret)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		freshCalled = true
		_, err := auth.User(r.Context())
		assert.NoError(t, err, "fresh token must produce a Principal")
	}))
	r2 := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/", nil)
	r2.AddCookie(&http.Cookie{Name: "session", Value: freshToken})
	freshHandler.ServeHTTP(httptest.NewRecorder(), r2)
	assert.True(t, freshCalled)
}
