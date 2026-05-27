package image_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	imagehandler "github.com/sniffins-mcmuggins/render/api/internal/image"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

func TestConfirmHandler_Success(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	ms := testutil.NewMinIOServer(t)
	testutil.MinIOPutObject(t, ms, "test-object.jpg", []byte("fake image bytes"), "image/jpeg")
	token := testBearerToken(t, db)
	handler := auth.Middleware(db, testSecret)(imagehandler.ConfirmHandler(ms.Client, ms.Bucket, ms.CDNBase()))

	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/images/confirm",
		strings.NewReader(`{"s3Key":"test-object.jpg","resourceType":"artist_profile","resourceId":"some-uuid"}`))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, r)

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	var resp map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	cdnURL, _ := resp["cdnUrl"].(string)
	assert.True(t, strings.HasSuffix(cdnURL, "test-object.jpg"), "expected cdnUrl ending in test-object.jpg, got %v", cdnURL)
}

func TestConfirmHandler_ObjectNotFound(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	ms := testutil.NewMinIOServer(t)
	token := testBearerToken(t, db)
	handler := auth.Middleware(db, testSecret)(imagehandler.ConfirmHandler(ms.Client, ms.Bucket, ms.CDNBase()))

	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/images/confirm",
		strings.NewReader(`{"s3Key":"nonexistent.jpg"}`))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, r)

	assert.Equal(t, http.StatusNotFound, w.Code, w.Body.String())
}

func TestConfirmHandler_MissingS3Key(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	// MinIO client is never reached — handler returns 422 before calling mc
	token := testBearerToken(t, db)
	handler := auth.Middleware(db, testSecret)(imagehandler.ConfirmHandler(nil, "unused-bucket", "http://unused"))

	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/images/confirm",
		strings.NewReader(`{"resourceType":"artist_profile"}`))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, r)

	assert.Equal(t, http.StatusUnprocessableEntity, w.Code, w.Body.String())
}

func TestConfirmHandler_Unauthenticated(t *testing.T) {
	t.Parallel()
	// MinIO client is never reached — handler returns 401 before calling mc
	handler := imagehandler.ConfirmHandler(nil, "unused-bucket", "http://unused")

	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/images/confirm",
		strings.NewReader(`{"s3Key":"some-key.jpg"}`))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, r)

	assert.Equal(t, http.StatusUnauthorized, w.Code, w.Body.String())
}
