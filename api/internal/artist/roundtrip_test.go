package artist_test

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/sniffins-mcmuggins/render/api/internal/artist"
	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

func TestArtistDomainRoundTrip(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
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
		req, err := http.NewRequestWithContext(t.Context(), method, srv.URL+path, reqBody)
		require.NoError(t, err)
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		resp, err := http.DefaultClient.Do(req)
		require.NoError(t, err)
		return resp
	}

	decodeJSON := func(resp *http.Response) map[string]any {
		t.Helper()
		body, err := io.ReadAll(resp.Body)
		require.NoError(t, resp.Body.Close())
		require.NoError(t, err, "read body")
		var m map[string]any
		require.NoError(t, json.Unmarshal(body, &m), "decode JSON")
		return m
	}

	decodeJSONArray := func(resp *http.Response) []map[string]any {
		t.Helper()
		body, err := io.ReadAll(resp.Body)
		require.NoError(t, resp.Body.Close())
		require.NoError(t, err, "read body")
		var arr []map[string]any
		require.NoError(t, json.Unmarshal(body, &arr), "decode JSON array")
		return arr
	}

	assertStatus := func(resp *http.Response, want int) {
		t.Helper()
		if resp.StatusCode != want {
			body, _ := io.ReadAll(resp.Body)
			_ = resp.Body.Close()
			t.Fatalf("expected %d, got %d: %s", want, resp.StatusCode, body)
		}
	}

	// 1. Sign up as artist
	resp := do("POST", "/auth/signup",
		`{"email":"roundtrip@example.com","password":"hunter2hunter","role":"artist"}`, "")
	assertStatus(resp, http.StatusCreated)
	_ = resp.Body.Close()

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
	assert.Equal(t, "Round Trip Artist", profile["display_name"])

	// 4. Update profile
	updateProfResp := do("PATCH", "/profiles/me", //nolint:bodyclose // body closed inside decodeJSON
		`{"bio":"I paint big things","mediumTags":["mural"],"socialLinks":{"instagram":"https://insta"}}`,
		token)
	assertStatus(updateProfResp, http.StatusOK)
	updated := decodeJSON(updateProfResp)
	assert.Equal(t, "I paint big things", updated["bio"])

	// 5. Publish the profile so anonymous viewers can see it
	resp = do("PATCH", "/profiles/me", `{"visibility":"public"}`, token)
	assertStatus(resp, http.StatusOK)
	_ = resp.Body.Close()

	// 6. Fetch own profile via /profiles/me
	resp = do("GET", "/profiles/me", "", token)
	assertStatus(resp, http.StatusOK)
	_ = resp.Body.Close()

	// 7. Fetch public profile — no token
	resp = do("GET", "/profiles/"+profileID, "", "") //nolint:bodyclose // body closed inside decodeJSON
	assertStatus(resp, http.StatusOK)
	public := decodeJSON(resp)
	assert.Equal(t, "Round Trip Artist", public["display_name"])

	// 8. Create two collections
	resp = do("POST", "/collections", `{"name":"Alpha","description":"First"}`, token) //nolint:bodyclose // body closed inside decodeJSON
	assertStatus(resp, http.StatusCreated)
	colAlpha := decodeJSON(resp)
	colAlphaID := colAlpha["id"].(string)

	resp = do("POST", "/collections", `{"name":"Beta"}`, token) //nolint:bodyclose // body closed inside decodeJSON
	assertStatus(resp, http.StatusCreated)
	colBeta := decodeJSON(resp)
	colBetaID := colBeta["id"].(string)
	_ = colBetaID

	// 9. List collections for profile
	resp = do("GET", "/profiles/"+profileID+"/collections", "", "") //nolint:bodyclose // body closed inside decodeJSONArray
	assertStatus(resp, http.StatusOK)
	collections := decodeJSONArray(resp)
	assert.Len(t, collections, 2)

	// 10. Update collection
	resp = do("PATCH", "/collections/"+colAlphaID, //nolint:bodyclose // body closed inside decodeJSON
		`{"name":"Alpha Renamed","status":"ongoing"}`, token)
	assertStatus(resp, http.StatusOK)
	col := decodeJSON(resp)
	assert.Equal(t, "ongoing", col["status"])

	// 11. Attach two images
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

	// 12. Reorder: put img2 before img1
	reorderBody, err := json.Marshal(map[string]any{"imageIds": []string{img2ID, img1ID}})
	require.NoError(t, err)
	resp = do("PUT", "/collections/"+colAlphaID+"/images/order", string(reorderBody), token) //nolint:bodyclose // body closed inside decodeJSONArray
	assertStatus(resp, http.StatusOK)
	images := decodeJSONArray(resp)
	assert.Equal(t, img2ID, images[0]["id"])

	// 13. Delete one image
	resp = do("DELETE", "/collections/"+colAlphaID+"/images/"+img1ID, "", token)
	assertStatus(resp, http.StatusNoContent)
	_ = resp.Body.Close()

	// 14. Delete collection
	resp = do("DELETE", "/collections/"+colAlphaID, "", token)
	assertStatus(resp, http.StatusNoContent)
	_ = resp.Body.Close()

	// 15. Verify collection is gone
	resp = do("GET", "/collections/"+colAlphaID, "", "")
	assertStatus(resp, http.StatusNotFound)
	_ = resp.Body.Close()
}
