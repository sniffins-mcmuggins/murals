package auth_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

func signupAndLogin(t *testing.T, db *pgxpool.Pool, email, password string) (cookie *http.Cookie, token string) {
	t.Helper()

	signupBody := `{"email":"` + email + `","password":"` + password + `"}`
	sr := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/auth/signup", toBody(signupBody))
	sr.Header.Set("Content-Type", "application/json")
	sw := httptest.NewRecorder()
	auth.SignupHandler(db).ServeHTTP(sw, sr)
	if sw.Code != http.StatusCreated {
		t.Fatalf("signup failed: %d %s", sw.Code, sw.Body.String())
	}

	loginBody := `{"email":"` + email + `","password":"` + password + `"}`
	lr := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/auth/login", toBody(loginBody))
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

func toBody(s string) *strings.Reader {
	return strings.NewReader(s)
}

func TestMeHandler_AuthedCookie(t *testing.T) {
	db := testutil.NewDB(t)
	cookie, _ := signupAndLogin(t, db, "frank@example.com", "password123")

	handler := auth.Middleware(testSecret)(auth.MeHandler(db))

	r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/me", nil)
	r.AddCookie(cookie)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp map[string]any
	_ = json.NewDecoder(w.Body).Decode(&resp)
	if resp["email"] != "frank@example.com" {
		t.Errorf("expected frank@example.com, got %v", resp["email"])
	}
	if resp["password_hash"] != nil {
		t.Error("password_hash must not appear in response")
	}
}

func TestMeHandler_AuthedBearer(t *testing.T) {
	db := testutil.NewDB(t)
	_, token := signupAndLogin(t, db, "grace@example.com", "password123")

	handler := auth.Middleware(testSecret)(auth.MeHandler(db))

	r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/me", nil)
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestMeHandler_Unauthenticated(t *testing.T) {
	db := testutil.NewDB(t)
	handler := auth.Middleware(testSecret)(auth.MeHandler(db))

	r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/me", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", w.Code, w.Body.String())
	}
}
