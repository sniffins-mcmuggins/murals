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

func TestAttachImage_Success(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	userID, token := createTestUser(t, db, "img1@example.com", "artist")
	createTestProfile(t, db, userID, "Hank")

	createColH := auth.Middleware(db, testSecret)(artist.CreateCollectionHandler(db))
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/collections",
		bytes.NewBufferString(`{"name":"My Work"}`))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	createColH.ServeHTTP(w, r)
	require.Equal(t, http.StatusCreated, w.Code)
	var col map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&col))
	collectionID := col["id"].(string)

	router := chi.NewRouter()
	router.Use(auth.Middleware(db, testSecret))
	router.Post("/collections/{collectionID}/images", artist.AttachImageHandler(db))
	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)

	body := `{"s3Key":"abc123.jpg","cdnUrl":"http://localhost:9000/render-images/abc123.jpg"}`
	req, err := http.NewRequestWithContext(t.Context(), http.MethodPost,
		srv.URL+"/collections/"+collectionID+"/images", bytes.NewBufferString(body))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer func() { _ = resp.Body.Close() }()

	require.Equal(t, http.StatusCreated, resp.StatusCode)
	var img map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&img))
	assert.Equal(t, "abc123.jpg", img["s3_key"])
	assert.Equal(t, float64(0), img["display_order"])
}

func TestAttachImage_SecondImageOrder(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	userID, token := createTestUser(t, db, "img2@example.com", "artist")
	createTestProfile(t, db, userID, "Iris")

	createColH := auth.Middleware(db, testSecret)(artist.CreateCollectionHandler(db))
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/collections",
		bytes.NewBufferString(`{"name":"Seq"}`))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	createColH.ServeHTTP(w, r)
	var col map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&col))
	collectionID := col["id"].(string)

	router := chi.NewRouter()
	router.Use(auth.Middleware(db, testSecret))
	router.Post("/collections/{collectionID}/images", artist.AttachImageHandler(db))
	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)

	for i, key := range []string{"first.jpg", "second.jpg"} {
		body := fmt.Sprintf(`{"s3Key":%q,"cdnUrl":"http://cdn/%s"}`, key, key)
		req, err := http.NewRequestWithContext(t.Context(), http.MethodPost,
			srv.URL+"/collections/"+collectionID+"/images", bytes.NewBufferString(body))
		require.NoError(t, err)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+token)
		resp, err := http.DefaultClient.Do(req)
		require.NoError(t, err)
		var img map[string]any
		require.NoError(t, json.NewDecoder(resp.Body).Decode(&img))
		_ = resp.Body.Close()
		require.Equal(t, http.StatusCreated, resp.StatusCode, "image %d", i)
		assert.Equal(t, float64(i), img["display_order"], "image %d display_order", i)
	}
}

func TestReorderImages_Success(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	userID, token := createTestUser(t, db, "img3@example.com", "artist")
	createTestProfile(t, db, userID, "Jake")

	createColH := auth.Middleware(db, testSecret)(artist.CreateCollectionHandler(db))
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/collections",
		bytes.NewBufferString(`{"name":"Reorder"}`))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	createColH.ServeHTTP(w, r)
	var col map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&col))
	collectionID := col["id"].(string)

	router := chi.NewRouter()
	router.Use(auth.Middleware(db, testSecret))
	router.Post("/collections/{collectionID}/images", artist.AttachImageHandler(db))
	router.Put("/collections/{collectionID}/images/order", artist.ReorderImagesHandler(db))
	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)

	var imageIDs []string
	for _, key := range []string{"a.jpg", "b.jpg"} {
		body := fmt.Sprintf(`{"s3Key":%q,"cdnUrl":"http://cdn/%s"}`, key, key)
		req, err := http.NewRequestWithContext(t.Context(), http.MethodPost,
			srv.URL+"/collections/"+collectionID+"/images", bytes.NewBufferString(body))
		require.NoError(t, err)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+token)
		resp, err := http.DefaultClient.Do(req)
		require.NoError(t, err)
		var img map[string]any
		require.NoError(t, json.NewDecoder(resp.Body).Decode(&img))
		_ = resp.Body.Close()
		imageIDs = append(imageIDs, img["id"].(string))
	}

	reorderBody, err := json.Marshal(map[string]any{"imageIds": []string{imageIDs[1], imageIDs[0]}})
	require.NoError(t, err)
	req, err := http.NewRequestWithContext(t.Context(), http.MethodPut,
		srv.URL+"/collections/"+collectionID+"/images/order", bytes.NewReader(reorderBody))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer func() { _ = resp.Body.Close() }()

	require.Equal(t, http.StatusOK, resp.StatusCode)
	var images []map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&images))
	assert.Equal(t, imageIDs[1], images[0]["id"])
	assert.Equal(t, float64(0), images[0]["display_order"])
	assert.Equal(t, imageIDs[0], images[1]["id"])
	assert.Equal(t, float64(1), images[1]["display_order"])
}

func TestDeleteImage_Success(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	userID, token := createTestUser(t, db, "img4@example.com", "artist")
	createTestProfile(t, db, userID, "Karen")

	createColH := auth.Middleware(db, testSecret)(artist.CreateCollectionHandler(db))
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/collections",
		bytes.NewBufferString(`{"name":"Del"}`))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	createColH.ServeHTTP(w, r)
	var col map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&col))
	collectionID := col["id"].(string)

	router := chi.NewRouter()
	router.Use(auth.Middleware(db, testSecret))
	router.Post("/collections/{collectionID}/images", artist.AttachImageHandler(db))
	router.Delete("/collections/{collectionID}/images/{imageID}", artist.DeleteImageHandler(db))
	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)

	attachReq, err := http.NewRequestWithContext(t.Context(), http.MethodPost,
		srv.URL+"/collections/"+collectionID+"/images",
		bytes.NewBufferString(`{"s3Key":"del.jpg","cdnUrl":"http://cdn/del.jpg"}`))
	require.NoError(t, err)
	attachReq.Header.Set("Content-Type", "application/json")
	attachReq.Header.Set("Authorization", "Bearer "+token)
	attachResp, err := http.DefaultClient.Do(attachReq)
	require.NoError(t, err)
	var img map[string]any
	require.NoError(t, json.NewDecoder(attachResp.Body).Decode(&img))
	_ = attachResp.Body.Close()
	imageID := img["id"].(string)

	delReq, err := http.NewRequestWithContext(t.Context(), http.MethodDelete,
		srv.URL+"/collections/"+collectionID+"/images/"+imageID, nil)
	require.NoError(t, err)
	delReq.Header.Set("Authorization", "Bearer "+token)
	delResp, err := http.DefaultClient.Do(delReq)
	require.NoError(t, err)
	defer func() { _ = delResp.Body.Close() }()

	assert.Equal(t, http.StatusNoContent, delResp.StatusCode)
}
