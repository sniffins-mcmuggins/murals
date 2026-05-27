package auth_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

func TestSignupHandler_Success(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	handler := auth.SignupHandler(db)

	body := `{"email":"alice@example.com","password":"hunter2hunter"}`
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/auth/signup", bytes.NewBufferString(body))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, r)

	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
	var resp map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	assert.Equal(t, "alice@example.com", resp["email"])
	assert.Equal(t, false, resp["is_admin"])
	assert.Nil(t, resp["password_hash"], "password_hash must not appear in response")
}

func TestSignupHandler_DuplicateEmail(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	handler := auth.SignupHandler(db)

	body := `{"email":"bob@example.com","password":"hunter2hunter"}`
	for i := range 2 {
		r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/auth/signup", bytes.NewBufferString(body))
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if i == 0 {
			require.Equal(t, http.StatusCreated, w.Code, "first signup: %s", w.Body.String())
		} else {
			assert.Equal(t, http.StatusConflict, w.Code, "duplicate signup: %s", w.Body.String())
		}
	}
}

func TestSignupHandler_WeakPassword(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	handler := auth.SignupHandler(db)

	body := `{"email":"carol@example.com","password":"short"}`
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/auth/signup", bytes.NewBufferString(body))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, r)

	assert.Equal(t, http.StatusUnprocessableEntity, w.Code, w.Body.String())
}

func TestSignupHandler_InvalidEmail(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	handler := auth.SignupHandler(db)

	body := `{"email":"notanemail","password":"hunter2hunter"}`
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/auth/signup", bytes.NewBufferString(body))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, r)

	assert.Equal(t, http.StatusUnprocessableEntity, w.Code, w.Body.String())
}
