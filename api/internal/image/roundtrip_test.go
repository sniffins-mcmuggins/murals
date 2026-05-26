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

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	imagehandler "github.com/sniffins-mcmuggins/render/api/internal/image"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

func TestImageUploadRoundTrip(t *testing.T) {
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
		if err != nil {
			t.Fatalf("%s %s: build request: %v", method, path, err)
		}
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
		var m map[string]any
		if err := json.NewDecoder(resp.Body).Decode(&m); err != nil {
			t.Fatalf("decode JSON: %v", err)
		}
		resp.Body.Close()
		return m
	}

	// 1. Sign up
	resp := apiReq("POST", "/auth/signup",
		`{"email":"roundtrip@example.com","password":"hunter2hunter","role":"artist"}`, "")
	if resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("signup: expected 201, got %d: %s", resp.StatusCode, body)
	}
	resp.Body.Close()

	// 2. Log in, extract JWT
	resp = apiReq("POST", "/auth/login",
		`{"email":"roundtrip@example.com","password":"hunter2hunter"}`, "")
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("login: expected 200, got %d: %s", resp.StatusCode, body)
	}
	token := decodeJSON(resp)["token"].(string)

	// 3. Presign
	resp = apiReq("POST", "/images/presign", `{"contentType":"image/png"}`, token)
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("presign: expected 200, got %d: %s", resp.StatusCode, body)
	}
	presignData := decodeJSON(resp)
	uploadURL := presignData["uploadUrl"].(string)
	s3Key := presignData["s3Key"].(string)

	// 4. PUT image bytes directly to MinIO via the presigned URL
	imageBytes := []byte("PNG\x89\x50\x4e\x47 fake-image-content-for-test")
	putReq, err := http.NewRequestWithContext(t.Context(), http.MethodPut, uploadURL,
		bytes.NewReader(imageBytes))
	if err != nil {
		t.Fatalf("build PUT request: %v", err)
	}
	putReq.Header.Set("Content-Type", "image/png")
	putResp, err := http.DefaultClient.Do(putReq)
	if err != nil {
		t.Fatalf("PUT to MinIO: %v", err)
	}
	if putResp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(putResp.Body)
		t.Fatalf("PUT to MinIO: expected 200, got %d: %s", putResp.StatusCode, body)
	}
	putResp.Body.Close()

	// 5. Confirm
	confirmBody := `{"s3Key":"` + s3Key + `","resourceType":"artist_profile","resourceId":"test-id"}`
	resp = apiReq("POST", "/images/confirm", confirmBody, token)
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("confirm: expected 200, got %d: %s", resp.StatusCode, body)
	}
	cdnURL := decodeJSON(resp)["cdnUrl"].(string)
	if !strings.HasSuffix(cdnURL, s3Key) {
		t.Errorf("cdnUrl should end with %s, got %s", s3Key, cdnURL)
	}

	// 6. Fetch via CDN URL, verify bytes match
	getReq, err := http.NewRequestWithContext(t.Context(), http.MethodGet, cdnURL, nil)
	if err != nil {
		t.Fatalf("build GET request: %v", err)
	}
	getResp, err := http.DefaultClient.Do(getReq)
	if err != nil {
		t.Fatalf("GET via CDN URL: %v", err)
	}
	if getResp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(getResp.Body)
		t.Fatalf("GET via CDN URL: expected 200, got %d: %s", getResp.StatusCode, body)
	}
	fetched, _ := io.ReadAll(getResp.Body)
	getResp.Body.Close()
	if !bytes.Equal(fetched, imageBytes) {
		t.Errorf("fetched bytes don't match uploaded bytes\n  got:  %q\n  want: %q", fetched, imageBytes)
	}
}
