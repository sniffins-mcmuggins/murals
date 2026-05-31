package auth_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/config"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

func signupAndLogin(t *testing.T, db *pgxpool.Pool, email, password string) (cookie *http.Cookie, token string) {
	t.Helper()

	signupBody := `{"email":"` + email + `","password":"` + password + `"}`
	sr := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/auth/signup", strings.NewReader(signupBody))
	sr.Header.Set("Content-Type", "application/json")
	sw := httptest.NewRecorder()
	auth.SignupHandler(db, config.Config{}).ServeHTTP(sw, sr)
	if sw.Code != http.StatusCreated {
		t.Fatalf("signup failed: %d %s", sw.Code, sw.Body.String())
	}

	loginBody := `{"email":"` + email + `","password":"` + password + `"}`
	lr := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/auth/login", strings.NewReader(loginBody))
	lr.Header.Set("Content-Type", "application/json")
	lw := httptest.NewRecorder()
	auth.LoginHandler(db, testSecret).ServeHTTP(lw, lr)
	if lw.Code != http.StatusOK {
		t.Fatalf("login failed: %d %s", lw.Code, lw.Body.String())
	}

	var body map[string]any
	_ = json.NewDecoder(lw.Body).Decode(&body)
	token = body["token"].(string)

	for _, c := range lw.Result().Cookies() {
		if c.Name == "session" {
			cookie = c
		}
	}
	return cookie, token
}

func TestMeHandler_AuthedCookie(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	cookie, _ := signupAndLogin(t, db, "frank@example.com", "password123")

	handler := auth.Middleware(db, testSecret)(auth.MeHandler(db))

	r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/me", nil)
	r.AddCookie(cookie)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	var resp map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	assert.Equal(t, "frank@example.com", resp["email"])
	assert.Nil(t, resp["password_hash"], "password_hash must not appear in response")
}

func TestMeHandler_AuthedBearer(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	_, token := signupAndLogin(t, db, "grace@example.com", "password123")

	handler := auth.Middleware(db, testSecret)(auth.MeHandler(db))

	r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/me", nil)
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	assert.Equal(t, http.StatusOK, w.Code, w.Body.String())
}

func TestMeHandler_Unauthenticated(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	handler := auth.Middleware(db, testSecret)(auth.MeHandler(db))

	r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/me", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	assert.Equal(t, http.StatusUnauthorized, w.Code, w.Body.String())
}
