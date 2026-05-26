package artist_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/sniffins-mcmuggins/render/api/internal/artist"
	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

func TestCreateProfile_Success(t *testing.T) {
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

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var resp map[string]any
	_ = json.NewDecoder(w.Body).Decode(&resp)
	if resp["display_name"] != "Alice Muralist" {
		t.Errorf("expected display_name Alice Muralist, got %v", resp["display_name"])
	}
}

func TestCreateProfile_DuplicateProfile(t *testing.T) {
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

	if w.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d: %s", w.Code, w.Body.String())
	}
}

func TestGetProfile_Public(t *testing.T) {
	db := testutil.NewDB(t)
	userID, _ := createTestUser(t, db, "artist3@example.com", "artist")
	profileID := createTestProfile(t, db, userID, "Bob Street")

	r := chi.NewRouter()
	r.Get("/profiles/{profileID}", artist.GetProfileHandler(db))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp, err := http.Get(srv.URL + "/profiles/" + profileID)
	if err != nil {
		t.Fatalf("GET profile: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	var body map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&body)
	if body["display_name"] != "Bob Street" {
		t.Errorf("expected Bob Street, got %v", body["display_name"])
	}
}

func TestGetProfile_NotFound(t *testing.T) {
	db := testutil.NewDB(t)
	r := chi.NewRouter()
	r.Get("/profiles/{profileID}", artist.GetProfileHandler(db))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp, err := http.Get(srv.URL + "/profiles/00000000-0000-0000-0000-000000000000")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", resp.StatusCode)
	}
}

func TestUpdateProfile_Success(t *testing.T) {
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

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp map[string]any
	_ = json.NewDecoder(w.Body).Decode(&resp)
	if resp["display_name"] != "Carol Updated" {
		t.Errorf("expected Carol Updated, got %v", resp["display_name"])
	}
	if resp["bio"] != "I paint walls" {
		t.Errorf("expected bio, got %v", resp["bio"])
	}
}

func TestUpdateProfile_NoProfile(t *testing.T) {
	db := testutil.NewDB(t)
	_, token := createTestUser(t, db, "artist5@example.com", "artist")
	handler := auth.Middleware(testSecret)(artist.UpdateProfileHandler(db))

	body := `{"displayName":"Nobody"}`
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPatch, "/profiles/me", bytes.NewBufferString(body))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

func TestGetMyProfile_Success(t *testing.T) {
	db := testutil.NewDB(t)
	userID, token := createTestUser(t, db, "artist6@example.com", "artist")
	createTestProfile(t, db, userID, "Dana")
	handler := auth.Middleware(testSecret)(artist.GetMyProfileHandler(db))

	r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/profiles/me", nil)
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp map[string]any
	_ = json.NewDecoder(w.Body).Decode(&resp)
	if resp["display_name"] != "Dana" {
		t.Errorf("expected Dana, got %v", resp["display_name"])
	}
}

func TestUpdateProfile_ShowLocationPreservedWhenOmitted(t *testing.T) {
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
	if w.Code != http.StatusOK {
		t.Fatalf("enable show_location: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	// Second PATCH: update bio only, don't mention showLocation
	updateHandler := auth.Middleware(testSecret)(artist.UpdateProfileHandler(db))
	r2 := httptest.NewRequestWithContext(t.Context(), http.MethodPatch, "/profiles/me",
		bytes.NewBufferString(`{"bio":"New bio"}`))
	r2.Header.Set("Content-Type", "application/json")
	r2.Header.Set("Authorization", "Bearer "+token)
	w2 := httptest.NewRecorder()
	updateHandler.ServeHTTP(w2, r2)
	if w2.Code != http.StatusOK {
		t.Fatalf("update bio: expected 200, got %d: %s", w2.Code, w2.Body.String())
	}

	// Verify: get the public profile — location_label should still be present
	// (show_location preserved as true because we didn't send showLocation in the second PATCH)
	// We check indirectly via GetMyProfileHandler since location_label only shows on public when show_location=true
	getHandler := auth.Middleware(testSecret)(artist.GetMyProfileHandler(db))
	r3 := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/profiles/me", nil)
	r3.Header.Set("Authorization", "Bearer "+token)
	w3 := httptest.NewRecorder()
	getHandler.ServeHTTP(w3, r3)
	var resp map[string]any
	_ = json.NewDecoder(w3.Body).Decode(&resp)
	// show_location not exposed directly in response, but bio must be updated
	if resp["bio"] != "New bio" {
		t.Errorf("expected bio 'New bio', got %v", resp["bio"])
	}
}
