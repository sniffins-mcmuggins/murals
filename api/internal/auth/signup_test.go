package auth_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

func TestSignupHandler_Success(t *testing.T) {
	db := testutil.NewDB(t)
	handler := auth.SignupHandler(db)

	body := `{"email":"alice@example.com","password":"hunter2hunter","role":"artist"}`
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/auth/signup", bytes.NewBufferString(body))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, r)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var resp map[string]any
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp["email"] != "alice@example.com" {
		t.Errorf("expected alice@example.com, got %v", resp["email"])
	}
	if resp["role"] != "artist" {
		t.Errorf("expected artist, got %v", resp["role"])
	}
	if resp["password_hash"] != nil {
		t.Error("password_hash must not appear in response")
	}
}

func TestSignupHandler_DuplicateEmail(t *testing.T) {
	db := testutil.NewDB(t)
	handler := auth.SignupHandler(db)

	body := `{"email":"bob@example.com","password":"hunter2hunter"}`
	for i := range 2 {
		r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/auth/signup", bytes.NewBufferString(body))
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if i == 0 && w.Code != http.StatusCreated {
			t.Fatalf("first signup: expected 201, got %d", w.Code)
		}
		if i == 1 && w.Code != http.StatusConflict {
			t.Fatalf("duplicate signup: expected 409, got %d: %s", w.Code, w.Body.String())
		}
	}
}

func TestSignupHandler_WeakPassword(t *testing.T) {
	db := testutil.NewDB(t)
	handler := auth.SignupHandler(db)

	body := `{"email":"carol@example.com","password":"short"}`
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/auth/signup", bytes.NewBufferString(body))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, r)

	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422, got %d: %s", w.Code, w.Body.String())
	}
}

func TestSignupHandler_InvalidEmail(t *testing.T) {
	db := testutil.NewDB(t)
	handler := auth.SignupHandler(db)

	body := `{"email":"notanemail","password":"hunter2hunter"}`
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/auth/signup", bytes.NewBufferString(body))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, r)

	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422, got %d: %s", w.Code, w.Body.String())
	}
}
