package beta_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/sniffins-mcmuggins/render/api/internal/beta"
	"github.com/sniffins-mcmuggins/render/api/internal/config"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

func TestBetaStatusHandler_BetaModeOff(t *testing.T) {
	t.Parallel()
	cfg := config.Config{BetaMode: false}
	handler := beta.BetaStatusHandler(cfg)
	r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/public/beta-status", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	assert.Equal(t, http.StatusOK, w.Code)
	var resp struct {
		BetaMode bool `json:"beta_mode"`
	}
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	assert.False(t, resp.BetaMode)
}

func TestBetaStatusHandler_BetaModeOn(t *testing.T) {
	t.Parallel()
	cfg := config.Config{BetaMode: true}
	handler := beta.BetaStatusHandler(cfg)
	r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/public/beta-status", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	assert.Equal(t, http.StatusOK, w.Code)
	var resp struct {
		BetaMode bool `json:"beta_mode"`
	}
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	assert.True(t, resp.BetaMode)
}

func TestWaitlistHandler_AcceptsEmail(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	handler := beta.WaitlistHandler(db)
	body := `{"email":"test@example.com"}`
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/waitlist", strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	assert.Equal(t, http.StatusNoContent, w.Code)
}

func TestWaitlistHandler_Idempotent(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	handler := beta.WaitlistHandler(db)
	body := `{"email":"idempotent@example.com"}`
	for i := 0; i < 2; i++ {
		r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/waitlist", strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		assert.Equal(t, http.StatusNoContent, w.Code, "call %d should succeed", i+1)
	}
}

func TestWaitlistHandler_MissingEmail_Returns422(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	handler := beta.WaitlistHandler(db)
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/waitlist", strings.NewReader(`{}`))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	assert.Equal(t, http.StatusUnprocessableEntity, w.Code)
}

func TestWaitlistHandler_InvalidJSON_Returns400(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	handler := beta.WaitlistHandler(db)
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/waitlist", strings.NewReader(`{"email": bad json`))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}
