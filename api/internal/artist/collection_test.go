package artist_test

import (
	"bytes"
	"encoding/json"
	"fmt"
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

func TestCreateCollection_Success(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	userID, token := createTestUser(t, db, "col1@example.com", "artist")
	createTestProfile(t, db, userID, "Dave")
	handler := auth.Middleware(testSecret)(artist.CreateCollectionHandler(db))

	body := `{"name":"Bristol 2024","description":"My Bristol work"}`
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/collections", bytes.NewBufferString(body))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
	var resp map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	assert.Equal(t, "Bristol 2024", resp["name"])
}

func TestCreateCollection_NoProfile(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	_, token := createTestUser(t, db, "col2@example.com", "artist")
	handler := auth.Middleware(testSecret)(artist.CreateCollectionHandler(db))

	body := `{"name":"My Work"}`
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/collections", bytes.NewBufferString(body))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	assert.Equal(t, http.StatusNotFound, w.Code, w.Body.String())
}

func TestListCollections_Public(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	userID, token := createTestUser(t, db, "col3@example.com", "artist")
	profileID := createTestProfile(t, db, userID, "Eve")
	createHandler := auth.Middleware(testSecret)(artist.CreateCollectionHandler(db))

	for _, name := range []string{"Alpha", "Beta"} {
		body := fmt.Sprintf(`{"name":%q}`, name)
		r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/collections", bytes.NewBufferString(body))
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		createHandler.ServeHTTP(w, r)
		require.Equal(t, http.StatusCreated, w.Code, "create collection %s: %s", name, w.Body.String())
	}

	router := chi.NewRouter()
	router.Get("/profiles/{profileID}/collections", artist.ListCollectionsHandler(db))
	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)

	req, err := http.NewRequestWithContext(t.Context(), http.MethodGet,
		srv.URL+"/profiles/"+profileID+"/collections", nil)
	require.NoError(t, err)
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer func() { _ = resp.Body.Close() }()

	require.Equal(t, http.StatusOK, resp.StatusCode)
	var list []map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&list))
	assert.Len(t, list, 2)
}

func TestUpdateCollection_Success(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	userID, token := createTestUser(t, db, "col4@example.com", "artist")
	createTestProfile(t, db, userID, "Frank")

	createH := auth.Middleware(testSecret)(artist.CreateCollectionHandler(db))
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/collections",
		bytes.NewBufferString(`{"name":"Original"}`))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	createH.ServeHTTP(w, r)
	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
	var created map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&created))
	collectionID := created["id"].(string)

	router := chi.NewRouter()
	router.Use(auth.Middleware(testSecret))
	router.Patch("/collections/{collectionID}", artist.UpdateCollectionHandler(db))
	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)

	req, err := http.NewRequestWithContext(t.Context(), http.MethodPatch,
		srv.URL+"/collections/"+collectionID,
		bytes.NewBufferString(`{"name":"Renamed","status":"archived"}`))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer func() { _ = resp.Body.Close() }()

	require.Equal(t, http.StatusOK, resp.StatusCode)
	var updated map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&updated))
	assert.Equal(t, "Renamed", updated["name"])
	assert.Equal(t, "archived", updated["status"])
}

func TestDeleteCollection_Success(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	userID, token := createTestUser(t, db, "col5@example.com", "artist")
	createTestProfile(t, db, userID, "Grace")

	createH := auth.Middleware(testSecret)(artist.CreateCollectionHandler(db))
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/collections",
		bytes.NewBufferString(`{"name":"ToDelete"}`))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	createH.ServeHTTP(w, r)
	var created map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&created))
	collectionID := created["id"].(string)

	router := chi.NewRouter()
	router.Use(auth.Middleware(testSecret))
	router.Delete("/collections/{collectionID}", artist.DeleteCollectionHandler(db))
	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)

	req, err := http.NewRequestWithContext(t.Context(), http.MethodDelete,
		srv.URL+"/collections/"+collectionID, nil)
	require.NoError(t, err)
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer func() { _ = resp.Body.Close() }()

	assert.Equal(t, http.StatusNoContent, resp.StatusCode)
}

func TestUpdateCollection_WrongOwner(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	ownerID, ownerToken := createTestUser(t, db, "col6owner@example.com", "artist")
	createTestProfile(t, db, ownerID, "Owner")
	createH := auth.Middleware(testSecret)(artist.CreateCollectionHandler(db))
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/collections",
		bytes.NewBufferString(`{"name":"Private"}`))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+ownerToken)
	w := httptest.NewRecorder()
	createH.ServeHTTP(w, r)
	var created map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&created))
	collectionID := created["id"].(string)

	otherID, otherToken := createTestUser(t, db, "col6other@example.com", "artist")
	createTestProfile(t, db, otherID, "Other")

	router := chi.NewRouter()
	router.Use(auth.Middleware(testSecret))
	router.Patch("/collections/{collectionID}", artist.UpdateCollectionHandler(db))
	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)

	req, err := http.NewRequestWithContext(t.Context(), http.MethodPatch,
		srv.URL+"/collections/"+collectionID,
		bytes.NewBufferString(`{"name":"Stolen"}`))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+otherToken)
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer func() { _ = resp.Body.Close() }()

	assert.Equal(t, http.StatusForbidden, resp.StatusCode)
}
