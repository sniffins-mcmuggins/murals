package artist_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/sniffins-mcmuggins/render/api/internal/artist"
	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

func TestAttachImage_Success(t *testing.T) {
	db := testutil.NewDB(t)
	userID, token := createTestUser(t, db, "img1@example.com", "artist")
	createTestProfile(t, db, userID, "Hank")

	createColH := auth.Middleware(testSecret)(artist.CreateCollectionHandler(db))
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/collections",
		bytes.NewBufferString(`{"name":"My Work"}`))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	createColH.ServeHTTP(w, r)
	if w.Code != http.StatusCreated {
		t.Fatalf("create collection: %d", w.Code)
	}
	var col map[string]any
	_ = json.NewDecoder(w.Body).Decode(&col)
	collectionID := col["id"].(string)

	router := chi.NewRouter()
	router.Use(auth.Middleware(testSecret))
	router.Post("/collections/{collectionID}/images", artist.AttachImageHandler(db))
	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)

	body := `{"s3Key":"abc123.jpg","cdnUrl":"http://localhost:9000/render-images/abc123.jpg"}`
	req, _ := http.NewRequestWithContext(t.Context(), http.MethodPost,
		srv.URL+"/collections/"+collectionID+"/images", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST image: %v", err)
	}
	defer func() {
		if err := resp.Body.Close(); err != nil {
			t.Errorf("close body: %v", err)
		}
	}()
	if resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("expected 201, got %d: %s", resp.StatusCode, body)
	}
	var img map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&img)
	if img["s3_key"] != "abc123.jpg" {
		t.Errorf("expected s3_key abc123.jpg, got %v", img["s3_key"])
	}
	if img["display_order"].(float64) != 0 {
		t.Errorf("expected display_order 0, got %v", img["display_order"])
	}
}

func TestAttachImage_SecondImageOrder(t *testing.T) {
	db := testutil.NewDB(t)
	userID, token := createTestUser(t, db, "img2@example.com", "artist")
	createTestProfile(t, db, userID, "Iris")

	createColH := auth.Middleware(testSecret)(artist.CreateCollectionHandler(db))
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/collections",
		bytes.NewBufferString(`{"name":"Seq"}`))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	createColH.ServeHTTP(w, r)
	var col map[string]any
	_ = json.NewDecoder(w.Body).Decode(&col)
	collectionID := col["id"].(string)

	router := chi.NewRouter()
	router.Use(auth.Middleware(testSecret))
	router.Post("/collections/{collectionID}/images", artist.AttachImageHandler(db))
	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)

	for i, key := range []string{"first.jpg", "second.jpg"} {
		body := fmt.Sprintf(`{"s3Key":%q,"cdnUrl":"http://cdn/%s"}`, key, key)
		req, _ := http.NewRequestWithContext(t.Context(), http.MethodPost,
			srv.URL+"/collections/"+collectionID+"/images", bytes.NewBufferString(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+token)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("POST image %d: %v", i, err)
		}
		var img map[string]any
		_ = json.NewDecoder(resp.Body).Decode(&img)
		if err := resp.Body.Close(); err != nil {
			t.Errorf("close body: %v", err)
		}
		if resp.StatusCode != http.StatusCreated {
			t.Errorf("image %d: expected 201, got %d", i, resp.StatusCode)
		}
		if int(img["display_order"].(float64)) != i {
			t.Errorf("image %d: expected display_order %d, got %v", i, i, img["display_order"])
		}
	}
}

func TestReorderImages_Success(t *testing.T) {
	db := testutil.NewDB(t)
	userID, token := createTestUser(t, db, "img3@example.com", "artist")
	createTestProfile(t, db, userID, "Jake")

	createColH := auth.Middleware(testSecret)(artist.CreateCollectionHandler(db))
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/collections",
		bytes.NewBufferString(`{"name":"Reorder"}`))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	createColH.ServeHTTP(w, r)
	var col map[string]any
	_ = json.NewDecoder(w.Body).Decode(&col)
	collectionID := col["id"].(string)

	router := chi.NewRouter()
	router.Use(auth.Middleware(testSecret))
	router.Post("/collections/{collectionID}/images", artist.AttachImageHandler(db))
	router.Put("/collections/{collectionID}/images/order", artist.ReorderImagesHandler(db))
	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)

	var imageIDs []string
	for _, key := range []string{"a.jpg", "b.jpg"} {
		body := fmt.Sprintf(`{"s3Key":%q,"cdnUrl":"http://cdn/%s"}`, key, key)
		req, _ := http.NewRequestWithContext(t.Context(), http.MethodPost,
			srv.URL+"/collections/"+collectionID+"/images", bytes.NewBufferString(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+token)
		resp, _ := http.DefaultClient.Do(req)
		var img map[string]any
		_ = json.NewDecoder(resp.Body).Decode(&img)
		if err := resp.Body.Close(); err != nil {
			t.Errorf("close body: %v", err)
		}
		imageIDs = append(imageIDs, img["id"].(string))
	}

	reorderBody, _ := json.Marshal(map[string]any{"imageIds": []string{imageIDs[1], imageIDs[0]}})
	req, _ := http.NewRequestWithContext(t.Context(), http.MethodPut,
		srv.URL+"/collections/"+collectionID+"/images/order", bytes.NewReader(reorderBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("PUT order: %v", err)
	}
	defer func() {
		if err := resp.Body.Close(); err != nil {
			t.Errorf("close body: %v", err)
		}
	}()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("expected 200, got %d: %s", resp.StatusCode, body)
	}
	var images []map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&images)
	if images[0]["id"] != imageIDs[1] {
		t.Errorf("expected %s first after reorder, got %v", imageIDs[1], images[0]["id"])
	}
	if images[0]["display_order"].(float64) != 0 {
		t.Errorf("expected images[0] display_order 0, got %v", images[0]["display_order"])
	}
	if images[1]["id"] != imageIDs[0] {
		t.Errorf("expected %s second after reorder, got %v", imageIDs[0], images[1]["id"])
	}
	if images[1]["display_order"].(float64) != 1 {
		t.Errorf("expected images[1] display_order 1, got %v", images[1]["display_order"])
	}
}

func TestDeleteImage_Success(t *testing.T) {
	db := testutil.NewDB(t)
	userID, token := createTestUser(t, db, "img4@example.com", "artist")
	createTestProfile(t, db, userID, "Karen")

	createColH := auth.Middleware(testSecret)(artist.CreateCollectionHandler(db))
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/collections",
		bytes.NewBufferString(`{"name":"Del"}`))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	createColH.ServeHTTP(w, r)
	var col map[string]any
	_ = json.NewDecoder(w.Body).Decode(&col)
	collectionID := col["id"].(string)

	router := chi.NewRouter()
	router.Use(auth.Middleware(testSecret))
	router.Post("/collections/{collectionID}/images", artist.AttachImageHandler(db))
	router.Delete("/collections/{collectionID}/images/{imageID}", artist.DeleteImageHandler(db))
	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)

	attachReq, _ := http.NewRequestWithContext(t.Context(), http.MethodPost,
		srv.URL+"/collections/"+collectionID+"/images",
		bytes.NewBufferString(`{"s3Key":"del.jpg","cdnUrl":"http://cdn/del.jpg"}`))
	attachReq.Header.Set("Content-Type", "application/json")
	attachReq.Header.Set("Authorization", "Bearer "+token)
	attachResp, _ := http.DefaultClient.Do(attachReq)
	var img map[string]any
	_ = json.NewDecoder(attachResp.Body).Decode(&img)
	if err := attachResp.Body.Close(); err != nil {
		t.Errorf("close attach body: %v", err)
	}
	imageID := img["id"].(string)

	delReq, _ := http.NewRequestWithContext(t.Context(), http.MethodDelete,
		srv.URL+"/collections/"+collectionID+"/images/"+imageID, nil)
	delReq.Header.Set("Authorization", "Bearer "+token)
	delResp, err := http.DefaultClient.Do(delReq)
	if err != nil {
		t.Fatalf("DELETE image: %v", err)
	}
	defer func() {
		if err := delResp.Body.Close(); err != nil {
			t.Errorf("close del body: %v", err)
		}
	}()
	if delResp.StatusCode != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", delResp.StatusCode)
	}
}
