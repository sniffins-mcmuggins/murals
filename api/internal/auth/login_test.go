package auth_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

func createTestUser(t *testing.T, db *pgxpool.Pool, email, password string) {
	t.Helper()
	hash, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	if err != nil {
		t.Fatalf("bcrypt: %v", err)
	}
	q := sqlcdb.New(db)
	_, err = q.CreateUser(t.Context(), sqlcdb.CreateUserParams{
		Email:        email,
		PasswordHash: string(hash),
		Role:         sqlcdb.UserRoleArtist,
	})
	if err != nil {
		t.Fatalf("create test user: %v", err)
	}
}

func TestLoginHandler_Success(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	createTestUser(t, db, "dave@example.com", "correctpassword")

	handler := auth.LoginHandler(db, testSecret)

	body := `{"email":"dave@example.com","password":"correctpassword"}`
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/auth/login", bytes.NewBufferString(body))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, r)

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())

	var resp map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	assert.NotEmpty(t, resp["token"], "expected token in response body")
	assert.NotNil(t, resp["user"], "expected user in response body")

	var sessionCookie *http.Cookie
	for _, c := range w.Result().Cookies() {
		if c.Name == "session" {
			sessionCookie = c
		}
	}
	require.NotNil(t, sessionCookie, "session cookie not set")
	assert.True(t, sessionCookie.HttpOnly, "session cookie must be HttpOnly")
}

func TestLoginHandler_WrongPassword(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	createTestUser(t, db, "eve@example.com", "correctpassword")

	handler := auth.LoginHandler(db, testSecret)

	body := `{"email":"eve@example.com","password":"wrongpassword"}`
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/auth/login", bytes.NewBufferString(body))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, r)

	assert.Equal(t, http.StatusUnauthorized, w.Code, w.Body.String())
}

func TestLoginHandler_UnknownEmail(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	handler := auth.LoginHandler(db, testSecret)

	body := `{"email":"nobody@example.com","password":"somepassword"}`
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/auth/login", bytes.NewBufferString(body))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, r)

	assert.Equal(t, http.StatusUnauthorized, w.Code, w.Body.String())
}
