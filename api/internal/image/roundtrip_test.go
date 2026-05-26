package image_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	imagehandler "github.com/sniffins-mcmuggins/render/api/internal/image"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

func TestImageUploadRoundTrip(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	ms := testutil.NewMinIOServer(t)

	// Router mirrors production wiring
	r := chi.NewRouter()
	r.Use(auth.Middleware(testSecret))
	r.Post("/auth/signup", auth.SignupHandler(db))
	r.Post("/auth/login", auth.LoginHandler(db, testSecret))
	r.Post("/images/presign", imagehandler.PresignHandler(ms.Client, ms.Bucket))
	r.Post("/images/confirm", imagehandler.ConfirmHandler(ms.Client, ms.Bucket, ms.CDNBase()))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	apiReq := func(method, path, body, token string) *http.Response {
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
		defer func() { _ = resp.Body.Close() }()
		var m map[string]any
		require.NoError(t, json.NewDecoder(resp.Body).Decode(&m), "decode JSON")
		return m
	}

	// 1. Sign up
	resp := apiReq("POST", "/auth/signup",
		`{"email":"roundtrip@example.com","password":"hunter2hunter","role":"artist"}`, "")
	require.Equal(t, http.StatusCreated, resp.StatusCode, "signup")
	_ = resp.Body.Close()

	// 2. Log in, extract JWT
	resp = apiReq("POST", "/auth/login", //nolint:bodyclose // body closed inside decodeJSON
		`{"email":"roundtrip@example.com","password":"hunter2hunter"}`, "")
	require.Equal(t, http.StatusOK, resp.StatusCode, "login")
	token := decodeJSON(resp)["token"].(string)

	// 3. Presign
	resp = apiReq("POST", "/images/presign", `{"contentType":"image/png"}`, token) //nolint:bodyclose // body closed inside decodeJSON
	require.Equal(t, http.StatusOK, resp.StatusCode, "presign")
	presignData := decodeJSON(resp)
	uploadURL := presignData["uploadUrl"].(string)
	s3Key := presignData["s3Key"].(string)

	// 4. PUT image bytes directly to MinIO via the presigned URL
	imageBytes := []byte("PNG\x89\x50\x4e\x47 fake-image-content-for-test")
	putReq, err := http.NewRequestWithContext(t.Context(), http.MethodPut, uploadURL,
		bytes.NewReader(imageBytes))
	require.NoError(t, err)
	putReq.Header.Set("Content-Type", "image/png")
	putResp, err := http.DefaultClient.Do(putReq)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, putResp.StatusCode, "PUT to MinIO")
	_ = putResp.Body.Close()

	// 5. Confirm
	confirmBody := `{"s3Key":"` + s3Key + `","resourceType":"artist_profile","resourceId":"test-id"}`
	resp = apiReq("POST", "/images/confirm", confirmBody, token) //nolint:bodyclose // body closed inside decodeJSON
	require.Equal(t, http.StatusOK, resp.StatusCode, "confirm")
	cdnURL := decodeJSON(resp)["cdnUrl"].(string)
	assert.True(t, strings.HasSuffix(cdnURL, s3Key), "cdnUrl should end with %s, got %s", s3Key, cdnURL)

	// 6. Fetch via CDN URL, verify bytes match
	getReq, err := http.NewRequestWithContext(t.Context(), http.MethodGet, cdnURL, nil)
	require.NoError(t, err)
	getResp, err := http.DefaultClient.Do(getReq)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, getResp.StatusCode, "GET via CDN URL")
	fetched, err := io.ReadAll(getResp.Body)
	require.NoError(t, err)
	_ = getResp.Body.Close()
	assert.Equal(t, imageBytes, fetched, "fetched bytes should match uploaded bytes")
}
