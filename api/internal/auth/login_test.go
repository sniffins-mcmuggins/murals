package auth_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
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
	db := testutil.NewDB(t)
	createTestUser(t, db, "dave@example.com", "correctpassword")

	handler := auth.LoginHandler(db, testSecret)

	body := `{"email":"dave@example.com","password":"correctpassword"}`
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/auth/login", bytes.NewBufferString(body))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, r)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]any
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp["token"] == nil || resp["token"] == "" {
		t.Error("expected token in response body")
	}
	if resp["user"] == nil {
		t.Error("expected user in response body")
	}

	cookies := w.Result().Cookies()
	var sessionCookie *http.Cookie
	for _, c := range cookies {
		if c.Name == "session" {
			sessionCookie = c
		}
	}
	if sessionCookie == nil {
		t.Fatal("session cookie not set")
	}
	if !sessionCookie.HttpOnly {
		t.Error("session cookie must be HttpOnly")
	}
}

func TestLoginHandler_WrongPassword(t *testing.T) {
	db := testutil.NewDB(t)
	createTestUser(t, db, "eve@example.com", "correctpassword")

	handler := auth.LoginHandler(db, testSecret)

	body := `{"email":"eve@example.com","password":"wrongpassword"}`
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/auth/login", bytes.NewBufferString(body))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, r)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", w.Code, w.Body.String())
	}
}

func TestLoginHandler_UnknownEmail(t *testing.T) {
	db := testutil.NewDB(t)
	handler := auth.LoginHandler(db, testSecret)

	body := `{"email":"nobody@example.com","password":"somepassword"}`
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/auth/login", bytes.NewBufferString(body))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, r)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", w.Code, w.Body.String())
	}
}
