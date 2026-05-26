package artist_test

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/sniffins-mcmuggins/render/api/internal/artist"
	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

func TestArtistDomainRoundTrip(t *testing.T) {
	db := testutil.NewDB(t)

	r := chi.NewRouter()
	r.Use(auth.Middleware(testSecret))
	r.Post("/auth/signup", auth.SignupHandler(db))
	r.Post("/auth/login", auth.LoginHandler(db, testSecret))
	r.Post("/profiles", artist.CreateProfileHandler(db))
	r.Get("/profiles/me", artist.GetMyProfileHandler(db))
	r.Patch("/profiles/me", artist.UpdateProfileHandler(db))
	r.Get("/profiles/{profileID}", artist.GetProfileHandler(db))
	r.Get("/profiles/{profileID}/collections", artist.ListCollectionsHandler(db))
	r.Post("/collections", artist.CreateCollectionHandler(db))
	r.Get("/collections/{collectionID}", artist.GetCollectionHandler(db))
	r.Patch("/collections/{collectionID}", artist.UpdateCollectionHandler(db))
	r.Delete("/collections/{collectionID}", artist.DeleteCollectionHandler(db))
	r.Post("/collections/{collectionID}/images", artist.AttachImageHandler(db))
	r.Put("/collections/{collectionID}/images/order", artist.ReorderImagesHandler(db))
	r.Delete("/collections/{collectionID}/images/{imageID}", artist.DeleteImageHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	do := func(method, path, body, token string) *http.Response {
		t.Helper()
		var reqBody io.Reader
		if body != "" {
			reqBody = strings.NewReader(body)
		}
		req, _ := http.NewRequestWithContext(t.Context(), method, srv.URL+path, reqBody)
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("%s %s: %v", method, path, err)
		}
		return resp
	}

	decodeJSON := func(resp *http.Response) map[string]any {
		t.Helper()
		body, err := io.ReadAll(resp.Body)
		if closeErr := resp.Body.Close(); closeErr != nil {
			t.Errorf("close body: %v", closeErr)
		}
		if err != nil {
			t.Fatalf("read body: %v", err)
		}
		var m map[string]any
		if err := json.Unmarshal(body, &m); err != nil {
			t.Fatalf("decode JSON: %v", err)
		}
		return m
	}

	decodeJSONArray := func(resp *http.Response) []map[string]any {
		t.Helper()
		body, err := io.ReadAll(resp.Body)
		if closeErr := resp.Body.Close(); closeErr != nil {
			t.Errorf("close body: %v", closeErr)
		}
		if err != nil {
			t.Fatalf("read body: %v", err)
		}
		var arr []map[string]any
		if err := json.Unmarshal(body, &arr); err != nil {
			t.Fatalf("decode JSON array: %v", err)
		}
		return arr
	}

	assertStatus := func(resp *http.Response, want int) {
		t.Helper()
		if resp.StatusCode != want {
			body, _ := io.ReadAll(resp.Body)
			if err := resp.Body.Close(); err != nil {
				t.Errorf("close body: %v", err)
			}
			t.Fatalf("expected %d, got %d: %s", want, resp.StatusCode, body)
		}
	}

	// 1. Sign up as artist
	resp := do("POST", "/auth/signup",
		`{"email":"roundtrip@example.com","password":"hunter2hunter","role":"artist"}`, "")
	assertStatus(resp, http.StatusCreated)
	if err := resp.Body.Close(); err != nil {
		t.Errorf("close body: %v", err)
	}

	// 2. Log in
	loginResp := do("POST", "/auth/login", //nolint:bodyclose // body closed inside decodeJSON
		`{"email":"roundtrip@example.com","password":"hunter2hunter"}`, "")
	assertStatus(loginResp, http.StatusOK)
	token := decodeJSON(loginResp)["token"].(string)

	// 3. Create profile
	createProfResp := do("POST", "/profiles", `{"displayName":"Round Trip Artist"}`, token) //nolint:bodyclose // body closed inside decodeJSON
	assertStatus(createProfResp, http.StatusCreated)
	profile := decodeJSON(createProfResp)
	profileID := profile["id"].(string)
	if profile["display_name"] != "Round Trip Artist" {
		t.Errorf("unexpected display_name: %v", profile["display_name"])
	}

	// 4. Update profile
	updateProfResp := do("PATCH", "/profiles/me", //nolint:bodyclose // body closed inside decodeJSON
		`{"bio":"I paint big things","mediumTags":["mural"],"socialLinks":{"instagram":"https://insta"}}`,
		token)
	assertStatus(updateProfResp, http.StatusOK)
	updated := decodeJSON(updateProfResp)
	if updated["bio"] != "I paint big things" {
		t.Errorf("bio not updated: %v", updated["bio"])
	}

	// 5. Fetch own profile via /profiles/me
	resp = do("GET", "/profiles/me", "", token)
	assertStatus(resp, http.StatusOK)
	if err := resp.Body.Close(); err != nil {
		t.Errorf("close body: %v", err)
	}

	// 6. Fetch public profile — no token
	resp = do("GET", "/profiles/"+profileID, "", "") //nolint:bodyclose // body closed inside decodeJSON
	assertStatus(resp, http.StatusOK)
	public := decodeJSON(resp)
	if public["display_name"] != "Round Trip Artist" {
		t.Errorf("public profile display_name: %v", public["display_name"])
	}

	// 7. Create two collections
	resp = do("POST", "/collections", `{"name":"Alpha","description":"First"}`, token) //nolint:bodyclose // body closed inside decodeJSON
	assertStatus(resp, http.StatusCreated)
	colAlpha := decodeJSON(resp)
	colAlphaID := colAlpha["id"].(string)

	resp = do("POST", "/collections", `{"name":"Beta"}`, token) //nolint:bodyclose // body closed inside decodeJSON
	assertStatus(resp, http.StatusCreated)
	colBeta := decodeJSON(resp)
	colBetaID := colBeta["id"].(string)
	_ = colBetaID

	// 8. List collections for profile
	resp = do("GET", "/profiles/"+profileID+"/collections", "", "") //nolint:bodyclose // body closed inside decodeJSONArray
	assertStatus(resp, http.StatusOK)
	collections := decodeJSONArray(resp)
	if len(collections) != 2 {
		t.Errorf("expected 2 collections, got %d", len(collections))
	}

	// 9. Update collection
	resp = do("PATCH", "/collections/"+colAlphaID, //nolint:bodyclose // body closed inside decodeJSON
		`{"name":"Alpha Renamed","status":"ongoing"}`, token)
	assertStatus(resp, http.StatusOK)
	col := decodeJSON(resp)
	if col["status"] != "ongoing" {
		t.Errorf("expected ongoing, got %v", col["status"])
	}

	// 10. Attach two images
	resp = do("POST", "/collections/"+colAlphaID+"/images", //nolint:bodyclose // body closed inside decodeJSON
		`{"s3Key":"img1.jpg","cdnUrl":"http://cdn/img1.jpg"}`, token)
	assertStatus(resp, http.StatusCreated)
	img1 := decodeJSON(resp)
	img1ID := img1["id"].(string)

	resp = do("POST", "/collections/"+colAlphaID+"/images", //nolint:bodyclose // body closed inside decodeJSON
		`{"s3Key":"img2.jpg","cdnUrl":"http://cdn/img2.jpg"}`, token)
	assertStatus(resp, http.StatusCreated)
	img2 := decodeJSON(resp)
	img2ID := img2["id"].(string)

	// 11. Reorder: put img2 before img1
	reorderBody, _ := json.Marshal(map[string]any{"imageIds": []string{img2ID, img1ID}})
	resp = do("PUT", "/collections/"+colAlphaID+"/images/order", string(reorderBody), token) //nolint:bodyclose // body closed inside decodeJSONArray
	assertStatus(resp, http.StatusOK)
	images := decodeJSONArray(resp)
	if images[0]["id"] != img2ID {
		t.Errorf("expected img2 first after reorder, got %v", images[0]["id"])
	}

	// 12. Delete one image
	resp = do("DELETE", "/collections/"+colAlphaID+"/images/"+img1ID, "", token)
	assertStatus(resp, http.StatusNoContent)
	if err := resp.Body.Close(); err != nil {
		t.Errorf("close body: %v", err)
	}

	// 13. Delete collection
	resp = do("DELETE", "/collections/"+colAlphaID, "", token)
	assertStatus(resp, http.StatusNoContent)
	if err := resp.Body.Close(); err != nil {
		t.Errorf("close body: %v", err)
	}

	// 14. Verify collection is gone
	resp = do("GET", "/collections/"+colAlphaID, "", "")
	assertStatus(resp, http.StatusNotFound)
	if err := resp.Body.Close(); err != nil {
		t.Errorf("close body: %v", err)
	}
}
