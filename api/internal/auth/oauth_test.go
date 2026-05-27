package auth_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
)

func TestGoogleRedirectHandler_SetsStateAndRedirects(t *testing.T) {
	t.Parallel()
	handler := auth.GoogleRedirectHandler("client-id", "client-secret", "http://localhost:3000")
	r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/auth/oauth/google", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	assert.Equal(t, http.StatusTemporaryRedirect, w.Code)
	assert.Contains(t, w.Header().Get("Location"), "accounts.google.com")

	var stateCookie *http.Cookie
	for _, c := range w.Result().Cookies() {
		if c.Name == "oauth_state" {
			stateCookie = c
		}
	}
	assert.NotNil(t, stateCookie)
	assert.True(t, stateCookie.HttpOnly)
}
