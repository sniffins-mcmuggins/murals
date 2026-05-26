package image_test

import (
	"bytes"
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

func TestPresignHandler_Success(t *testing.T) {
	t.Parallel()
	ms := testutil.NewMinIOServer(t)
	token := testBearerToken(t)
	handler := auth.Middleware(testSecret)(imagehandler.PresignHandler(ms.Client, ms.Bucket))

	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/images/presign",
		strings.NewReader(`{"contentType":"image/jpeg"}`))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, r)

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	var resp map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	uploadURL, _ := resp["uploadUrl"].(string)
	assert.NotEmpty(t, uploadURL, "expected non-empty uploadUrl")
	s3Key, _ := resp["s3Key"].(string)
	assert.True(t, strings.HasSuffix(s3Key, ".jpg"), "expected s3Key with .jpg suffix, got %v", s3Key)

	// Verify the presigned URL accepts a real PUT
	putReq, err := http.NewRequestWithContext(t.Context(), http.MethodPut, uploadURL,
		bytes.NewBufferString("fake jpeg bytes"))
	require.NoError(t, err)
	putReq.Header.Set("Content-Type", "image/jpeg")
	putResp, err := http.DefaultClient.Do(putReq)
	require.NoError(t, err)
	defer func() { _ = putResp.Body.Close() }()
	assert.Equal(t, http.StatusOK, putResp.StatusCode)
}

func TestPresignHandler_Unauthenticated(t *testing.T) {
	t.Parallel()
	// MinIO client is never reached — handler returns 401 before calling mc
	handler := imagehandler.PresignHandler(nil, "unused-bucket")

	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/images/presign",
		strings.NewReader(`{"contentType":"image/jpeg"}`))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, r)

	assert.Equal(t, http.StatusUnauthorized, w.Code, w.Body.String())
}

func TestPresignHandler_UnsupportedContentType(t *testing.T) {
	t.Parallel()
	// MinIO client is never reached — handler returns 422 before calling mc
	token := testBearerToken(t)
	handler := auth.Middleware(testSecret)(imagehandler.PresignHandler(nil, "unused-bucket"))

	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/images/presign",
		strings.NewReader(`{"contentType":"text/plain"}`))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, r)

	assert.Equal(t, http.StatusUnprocessableEntity, w.Code, w.Body.String())
}
