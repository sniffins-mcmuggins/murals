package image_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	imagehandler "github.com/sniffins-mcmuggins/render/api/internal/image"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

func TestConfirmHandler_Success(t *testing.T) {
	ms := testutil.NewMinIOServer(t)
	testutil.MinIOPutObject(t, ms, "test-object.jpg", []byte("fake image bytes"), "image/jpeg")
	token := testBearerToken(t)
	handler := auth.Middleware(testSecret)(imagehandler.ConfirmHandler(ms.Client, ms.Bucket, ms.CDNBase()))

	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/images/confirm",
		strings.NewReader(`{"s3Key":"test-object.jpg","resourceType":"artist_profile","resourceId":"some-uuid"}`))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, r)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp map[string]any
	_ = json.NewDecoder(w.Body).Decode(&resp)
	cdnURL, ok := resp["cdnUrl"].(string)
	if !ok || !strings.HasSuffix(cdnURL, "test-object.jpg") {
		t.Errorf("expected cdnUrl ending in test-object.jpg, got %v", resp["cdnUrl"])
	}
}

func TestConfirmHandler_ObjectNotFound(t *testing.T) {
	ms := testutil.NewMinIOServer(t)
	token := testBearerToken(t)
	handler := auth.Middleware(testSecret)(imagehandler.ConfirmHandler(ms.Client, ms.Bucket, ms.CDNBase()))

	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/images/confirm",
		strings.NewReader(`{"s3Key":"nonexistent.jpg"}`))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, r)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

func TestConfirmHandler_MissingS3Key(t *testing.T) {
	// MinIO client is never reached — handler returns 422 before calling mc
	token := testBearerToken(t)
	handler := auth.Middleware(testSecret)(imagehandler.ConfirmHandler(nil, "unused-bucket", "http://unused"))

	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/images/confirm",
		strings.NewReader(`{"resourceType":"artist_profile"}`))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, r)

	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422, got %d: %s", w.Code, w.Body.String())
	}
}

func TestConfirmHandler_Unauthenticated(t *testing.T) {
	// MinIO client is never reached — handler returns 401 before calling mc
	handler := imagehandler.ConfirmHandler(nil, "unused-bucket", "http://unused")

	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/images/confirm",
		strings.NewReader(`{"s3Key":"some-key.jpg"}`))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, r)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", w.Code, w.Body.String())
	}
}
