package artist_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/sniffins-mcmuggins/render/api/internal/artist"
	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

func TestCreateCollection_Success(t *testing.T) {
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

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var resp map[string]any
	_ = json.NewDecoder(w.Body).Decode(&resp)
	if resp["name"] != "Bristol 2024" {
		t.Errorf("expected Bristol 2024, got %v", resp["name"])
	}
}

func TestCreateCollection_NoProfile(t *testing.T) {
	db := testutil.NewDB(t)
	_, token := createTestUser(t, db, "col2@example.com", "artist")
	handler := auth.Middleware(testSecret)(artist.CreateCollectionHandler(db))

	body := `{"name":"My Work"}`
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/collections", bytes.NewBufferString(body))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

func TestListCollections_Public(t *testing.T) {
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
		if w.Code != http.StatusCreated {
			t.Fatalf("create collection %s: expected 201, got %d", name, w.Code)
		}
	}

	router := chi.NewRouter()
	router.Get("/profiles/{profileID}/collections", artist.ListCollectionsHandler(db))
	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)

	resp, err := http.Get(srv.URL + "/profiles/" + profileID + "/collections")
	if err != nil {
		t.Fatalf("GET collections: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	var list []map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&list)
	if len(list) != 2 {
		t.Errorf("expected 2 collections, got %d", len(list))
	}
}

func TestUpdateCollection_Success(t *testing.T) {
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
	if w.Code != http.StatusCreated {
		t.Fatalf("create: got %d", w.Code)
	}
	var created map[string]any
	_ = json.NewDecoder(w.Body).Decode(&created)
	collectionID := created["id"].(string)

	router := chi.NewRouter()
	router.Use(auth.Middleware(testSecret))
	router.Patch("/collections/{collectionID}", artist.UpdateCollectionHandler(db))
	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)

	req, _ := http.NewRequestWithContext(t.Context(), http.MethodPatch,
		srv.URL+"/collections/"+collectionID,
		bytes.NewBufferString(`{"name":"Renamed","status":"archived"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("PATCH: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	var updated map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&updated)
	if updated["name"] != "Renamed" {
		t.Errorf("expected Renamed, got %v", updated["name"])
	}
	if updated["status"] != "archived" {
		t.Errorf("expected archived, got %v", updated["status"])
	}
}

func TestDeleteCollection_Success(t *testing.T) {
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
	_ = json.NewDecoder(w.Body).Decode(&created)
	collectionID := created["id"].(string)

	router := chi.NewRouter()
	router.Use(auth.Middleware(testSecret))
	router.Delete("/collections/{collectionID}", artist.DeleteCollectionHandler(db))
	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)

	req, _ := http.NewRequestWithContext(t.Context(), http.MethodDelete,
		srv.URL+"/collections/"+collectionID, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("DELETE: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", resp.StatusCode)
	}
}

func TestUpdateCollection_WrongOwner(t *testing.T) {
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
	_ = json.NewDecoder(w.Body).Decode(&created)
	collectionID := created["id"].(string)

	otherID, otherToken := createTestUser(t, db, "col6other@example.com", "artist")
	createTestProfile(t, db, otherID, "Other")

	router := chi.NewRouter()
	router.Use(auth.Middleware(testSecret))
	router.Patch("/collections/{collectionID}", artist.UpdateCollectionHandler(db))
	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)

	req, _ := http.NewRequestWithContext(t.Context(), http.MethodPatch,
		srv.URL+"/collections/"+collectionID,
		bytes.NewBufferString(`{"name":"Stolen"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+otherToken)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("PATCH: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", resp.StatusCode)
	}
}
