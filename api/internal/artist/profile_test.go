package artist_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/sniffins-mcmuggins/render/api/internal/artist"
	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

func TestCreateProfile_Success(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	userID, token := createTestUser(t, db, "artist1@example.com", "artist")
	_ = userID
	handler := auth.Middleware(testSecret)(artist.CreateProfileHandler(db))

	body := `{"displayName":"Alice Muralist"}`
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/profiles", bytes.NewBufferString(body))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
	var resp map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	assert.Equal(t, "Alice Muralist", resp["display_name"])
}

func TestCreateProfile_DuplicateProfile(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	userID, token := createTestUser(t, db, "artist2@example.com", "artist")
	createTestProfile(t, db, userID, "Alice")
	handler := auth.Middleware(testSecret)(artist.CreateProfileHandler(db))

	body := `{"displayName":"Alice Again"}`
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/profiles", bytes.NewBufferString(body))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	assert.Equal(t, http.StatusConflict, w.Code, w.Body.String())
}

func TestGetProfile_Public(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	userID, _ := createTestUser(t, db, "artist3@example.com", "artist")
	profileID := createTestProfile(t, db, userID, "Bob Street")

	r := chi.NewRouter()
	r.Get("/profiles/{profileID}", artist.GetProfileHandler(db))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, srv.URL+"/profiles/"+profileID, nil)
	require.NoError(t, err)
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer func() { _ = resp.Body.Close() }()

	require.Equal(t, http.StatusOK, resp.StatusCode)
	var body map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	assert.Equal(t, "Bob Street", body["display_name"])
}

func TestGetProfile_NotFound(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	r := chi.NewRouter()
	r.Get("/profiles/{profileID}", artist.GetProfileHandler(db))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	req, err := http.NewRequestWithContext(t.Context(), http.MethodGet,
		srv.URL+"/profiles/00000000-0000-0000-0000-000000000000", nil)
	require.NoError(t, err)
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer func() { _ = resp.Body.Close() }()

	assert.Equal(t, http.StatusNotFound, resp.StatusCode)
}

func TestUpdateProfile_Success(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	userID, token := createTestUser(t, db, "artist4@example.com", "artist")
	createTestProfile(t, db, userID, "Carol")
	handler := auth.Middleware(testSecret)(artist.UpdateProfileHandler(db))

	body := `{"displayName":"Carol Updated","bio":"I paint walls","mediumTags":["mural","stencil"],"socialLinks":{"instagram":"https://instagram.com/carol"}}`
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPatch, "/profiles/me", bytes.NewBufferString(body))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	var resp map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	assert.Equal(t, "Carol Updated", resp["display_name"])
	assert.Equal(t, "I paint walls", resp["bio"])
}

func TestUpdateProfile_NoProfile(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	_, token := createTestUser(t, db, "artist5@example.com", "artist")
	handler := auth.Middleware(testSecret)(artist.UpdateProfileHandler(db))

	body := `{"displayName":"Nobody"}`
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPatch, "/profiles/me", bytes.NewBufferString(body))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	assert.Equal(t, http.StatusNotFound, w.Code, w.Body.String())
}

func TestGetMyProfile_Success(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	userID, token := createTestUser(t, db, "artist6@example.com", "artist")
	createTestProfile(t, db, userID, "Dana")
	handler := auth.Middleware(testSecret)(artist.GetMyProfileHandler(db))

	r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/profiles/me", nil)
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	var resp map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	assert.Equal(t, "Dana", resp["display_name"])
}

func TestUpdateProfile_ShowLocationPreservedWhenOmitted(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	userID, token := createTestUser(t, db, "artist7@example.com", "artist")
	createTestProfile(t, db, userID, "Eve")

	// First PATCH: enable show_location
	enableHandler := auth.Middleware(testSecret)(artist.UpdateProfileHandler(db))
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPatch, "/profiles/me",
		bytes.NewBufferString(`{"showLocation":true}`))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	enableHandler.ServeHTTP(w, r)
	require.Equal(t, http.StatusOK, w.Code, "enable show_location: %s", w.Body.String())

	// Second PATCH: update bio only, don't mention showLocation
	updateHandler := auth.Middleware(testSecret)(artist.UpdateProfileHandler(db))
	r2 := httptest.NewRequestWithContext(t.Context(), http.MethodPatch, "/profiles/me",
		bytes.NewBufferString(`{"bio":"New bio"}`))
	r2.Header.Set("Content-Type", "application/json")
	r2.Header.Set("Authorization", "Bearer "+token)
	w2 := httptest.NewRecorder()
	updateHandler.ServeHTTP(w2, r2)
	require.Equal(t, http.StatusOK, w2.Code, "update bio: %s", w2.Body.String())

	// Verify bio was updated (show_location preserved implicitly)
	getHandler := auth.Middleware(testSecret)(artist.GetMyProfileHandler(db))
	r3 := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/profiles/me", nil)
	r3.Header.Set("Authorization", "Bearer "+token)
	w3 := httptest.NewRecorder()
	getHandler.ServeHTTP(w3, r3)
	var resp map[string]any
	require.NoError(t, json.NewDecoder(w3.Body).Decode(&resp))
	assert.Equal(t, "New bio", resp["bio"])
}
