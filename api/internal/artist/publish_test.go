package artist_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/sniffins-mcmuggins/render/api/internal/artist"
	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

// ── Publish ──────────────────────────────────────────────────────────────────

func TestPublishHandler_EntitledArtist(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	userID, token, _ := testutil.CreateUser(t, db)
	createTestProfile(t, db, userID, "Alice")
	grantArtistBasic(t, db, userID)

	handler := auth.Middleware(db, testSecret)(artist.PublishHandler(db))
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/profiles/me/publish", bytes.NewBufferString("{}"))
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	var resp map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	assert.Equal(t, "public", resp["visibility"])
}

func TestPublishHandler_NotEntitled(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	userID, token, _ := testutil.CreateUser(t, db)
	createTestProfile(t, db, userID, "Bob")

	handler := auth.Middleware(db, testSecret)(artist.PublishHandler(db))
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/profiles/me/publish", bytes.NewBufferString("{}"))
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	require.Equal(t, http.StatusPaymentRequired, w.Code, w.Body.String())
	var resp map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	assert.Equal(t, "payment_required", resp["code"])
}

func TestPublishHandler_AlreadyPublic(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	userID, token, _ := testutil.CreateUser(t, db)
	profileID := createTestProfile(t, db, userID, "Carol")
	publishTestProfile(t, db, profileID)

	handler := auth.Middleware(db, testSecret)(artist.PublishHandler(db))
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/profiles/me/publish", bytes.NewBufferString("{}"))
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	var resp map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	assert.Equal(t, "public", resp["visibility"])
}

func TestPublishHandler_NoProfile(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	_, token, _ := testutil.CreateUser(t, db)

	handler := auth.Middleware(db, testSecret)(artist.PublishHandler(db))
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/profiles/me/publish", bytes.NewBufferString("{}"))
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestPublishHandler_Unauthenticated(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)

	handler := auth.Middleware(db, testSecret)(artist.PublishHandler(db))
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/profiles/me/publish", bytes.NewBufferString("{}"))
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

// ── Unpublish ─────────────────────────────────────────────────────────────────

func TestUnpublishHandler_Success(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	userID, token, _ := testutil.CreateUser(t, db)
	profileID := createTestProfile(t, db, userID, "Dave")
	publishTestProfile(t, db, profileID)

	handler := auth.Middleware(db, testSecret)(artist.UnpublishHandler(db))
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/profiles/me/unpublish", bytes.NewBufferString("{}"))
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	var resp map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	assert.Equal(t, "draft", resp["visibility"])
}

func TestUnpublishHandler_AlreadyDraft(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	userID, token, _ := testutil.CreateUser(t, db)
	createTestProfile(t, db, userID, "Eve")

	handler := auth.Middleware(db, testSecret)(artist.UnpublishHandler(db))
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/profiles/me/unpublish", bytes.NewBufferString("{}"))
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	var resp map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	assert.Equal(t, "draft", resp["visibility"])
}

func TestUnpublishHandler_NoProfile(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	_, token, _ := testutil.CreateUser(t, db)

	handler := auth.Middleware(db, testSecret)(artist.UnpublishHandler(db))
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/profiles/me/unpublish", bytes.NewBufferString("{}"))
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestUnpublishHandler_Unauthenticated(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)

	handler := auth.Middleware(db, testSecret)(artist.UnpublishHandler(db))
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/profiles/me/unpublish", bytes.NewBufferString("{}"))
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}
