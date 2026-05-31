package artist_test

import (
	"bytes"
	"image/png"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/sniffins-mcmuggins/render/api/internal/artist"
	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

const testWebBase = "https://render.example"

func TestBuildProfileURL(t *testing.T) {
	t.Parallel()
	got := artist.BuildProfileURL(testWebBase, "abc-123")
	assert.Equal(t, "https://render.example/artists/abc-123", got)
}

func TestBuildProfileURL_TrimsTrailingSlash(t *testing.T) {
	t.Parallel()
	got := artist.BuildProfileURL("https://render.example/", "abc-123")
	assert.Equal(t, "https://render.example/artists/abc-123", got)
}

func TestProfileQR_Unauthenticated(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	// Wrap in auth middleware so a missing token is rejected the same way prod does.
	handler := auth.Middleware(db, testSecret)(artist.ProfileQRHandler(db, testWebBase))

	r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/profiles/me/qr", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	assert.Equal(t, http.StatusUnauthorized, w.Code, w.Body.String())
}

func TestProfileQR_NoProfile(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	_, token := createTestUser(t, db)
	handler := auth.Middleware(db, testSecret)(artist.ProfileQRHandler(db, testWebBase))

	r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/profiles/me/qr", nil)
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	assert.Equal(t, http.StatusNotFound, w.Code, w.Body.String())
}

func TestProfileQR_ReturnsPNG(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	userID, token := createTestUser(t, db)
	createTestProfile(t, db, userID, "QR Artist")
	handler := auth.Middleware(db, testSecret)(artist.ProfileQRHandler(db, testWebBase))

	r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/profiles/me/qr", nil)
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	assert.Equal(t, "image/png", w.Header().Get("Content-Type"))

	// Body must be a decodable PNG of meaningful size.
	img, err := png.Decode(bytes.NewReader(w.Body.Bytes()))
	require.NoError(t, err, "response body is not a valid PNG")
	bounds := img.Bounds()
	assert.GreaterOrEqual(t, bounds.Dx(), 256, "QR should be high-res")
	assert.GreaterOrEqual(t, bounds.Dy(), 256, "QR should be high-res")
}
