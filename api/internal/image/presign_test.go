package image_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	imagehandler "github.com/sniffins-mcmuggins/render/api/internal/image"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

func TestPresignHandler_Success(t *testing.T) {
	ms := testutil.NewMinIOServer(t)
	token := testBearerToken(t)
	handler := auth.Middleware(testSecret)(imagehandler.PresignHandler(ms.Client, ms.Bucket))

	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/images/presign",
		strings.NewReader(`{"contentType":"image/jpeg"}`))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, r)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp map[string]any
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	uploadURL, ok := resp["uploadUrl"].(string)
	if !ok || uploadURL == "" {
		t.Errorf("expected non-empty uploadUrl, got %v", resp["uploadUrl"])
	}
	s3Key, ok := resp["s3Key"].(string)
	if !ok || !strings.HasSuffix(s3Key, ".jpg") {
		t.Errorf("expected s3Key with .jpg suffix, got %v", resp["s3Key"])
	}

	// Verify the presigned URL accepts a real PUT
	putReq, err := http.NewRequestWithContext(t.Context(), http.MethodPut, uploadURL,
		bytes.NewBufferString("fake jpeg bytes"))
	if err != nil {
		t.Fatalf("build PUT request: %v", err)
	}
	putReq.Header.Set("Content-Type", "image/jpeg")
	putResp, err := http.DefaultClient.Do(putReq)
	if err != nil {
		t.Fatalf("PUT to presigned URL: %v", err)
	}
	defer putResp.Body.Close()
	if putResp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(putResp.Body)
		t.Fatalf("PUT to presigned URL: expected 200, got %d: %s", putResp.StatusCode, body)
	}
}

func TestPresignHandler_Unauthenticated(t *testing.T) {
	// MinIO client is never reached — handler returns 401 before calling mc
	handler := imagehandler.PresignHandler(nil, "unused-bucket")

	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/images/presign",
		strings.NewReader(`{"contentType":"image/jpeg"}`))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, r)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", w.Code, w.Body.String())
	}
}

func TestPresignHandler_UnsupportedContentType(t *testing.T) {
	// MinIO client is never reached — handler returns 422 before calling mc
	token := testBearerToken(t)
	handler := auth.Middleware(testSecret)(imagehandler.PresignHandler(nil, "unused-bucket"))

	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/images/presign",
		strings.NewReader(`{"contentType":"text/plain"}`))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, r)

	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422, got %d: %s", w.Code, w.Body.String())
	}
}
