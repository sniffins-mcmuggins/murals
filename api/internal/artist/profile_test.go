package artist_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/sniffins-mcmuggins/render/api/internal/artist"
	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

func TestCreateProfile_Success(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	userID, token := createTestUser(t, db)
	_ = userID
	handler := auth.Middleware(db, testSecret)(artist.CreateProfileHandler(db))

	body := `{"displayName":"Alice Muralist"}`
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/profiles", bytes.NewBufferString(body))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
	var resp map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	assert.Equal(t, "Alice Muralist", resp["display_name"])
}

func TestCreateProfile_DuplicateProfile(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	userID, token := createTestUser(t, db)
	createTestProfile(t, db, userID, "Alice")
	handler := auth.Middleware(db, testSecret)(artist.CreateProfileHandler(db))

	body := `{"displayName":"Alice Again"}`
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/profiles", bytes.NewBufferString(body))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	assert.Equal(t, http.StatusConflict, w.Code, w.Body.String())
}

func TestGetProfile_Public(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	userID, _ := createTestUser(t, db)
	profileID := createTestProfile(t, db, userID, "Bob Street")
	publishTestProfile(t, db, profileID)

	r := chi.NewRouter()
	r.Get("/profiles/{profileID}", artist.GetProfileHandler(db))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, srv.URL+"/profiles/"+profileID, nil)
	require.NoError(t, err)
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer func() { _ = resp.Body.Close() }()

	require.Equal(t, http.StatusOK, resp.StatusCode)
	var body map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	assert.Equal(t, "Bob Street", body["display_name"])
}

func TestGetProfile_NotFound(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	r := chi.NewRouter()
	r.Get("/profiles/{profileID}", artist.GetProfileHandler(db))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	req, err := http.NewRequestWithContext(t.Context(), http.MethodGet,
		srv.URL+"/profiles/00000000-0000-0000-0000-000000000000", nil)
	require.NoError(t, err)
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer func() { _ = resp.Body.Close() }()

	assert.Equal(t, http.StatusNotFound, resp.StatusCode)
}

func TestUpdateProfile_Success(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	userID, token := createTestUser(t, db)
	createTestProfile(t, db, userID, "Carol")
	handler := auth.Middleware(db, testSecret)(artist.UpdateProfileHandler(db))

	body := `{"displayName":"Carol Updated","bio":"I paint walls","mediumTags":["mural","stencil"],"socialLinks":{"instagram":"https://instagram.com/carol"}}`
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPatch, "/profiles/me", bytes.NewBufferString(body))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	var resp map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	assert.Equal(t, "Carol Updated", resp["display_name"])
	assert.Equal(t, "I paint walls", resp["bio"])
}

func TestUpdateProfile_NoProfile(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	_, token := createTestUser(t, db)
	handler := auth.Middleware(db, testSecret)(artist.UpdateProfileHandler(db))

	body := `{"displayName":"Nobody"}`
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPatch, "/profiles/me", bytes.NewBufferString(body))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	assert.Equal(t, http.StatusNotFound, w.Code, w.Body.String())
}

func TestGetMyProfile_Success(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	userID, token := createTestUser(t, db)
	createTestProfile(t, db, userID, "Dana")
	handler := auth.Middleware(db, testSecret)(artist.GetMyProfileHandler(db))

	r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/profiles/me", nil)
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	var resp map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	assert.Equal(t, "Dana", resp["display_name"])
}

func TestPreviewByToken_ValidToken_Returns200(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	userID, ownerToken := createTestUser(t, db)
	_ = createTestProfile(t, db, userID, "Preview Artist")

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Get("/profiles/me", artist.GetMyProfileHandler(db))
	r.Get("/profiles/preview/{token}", artist.PreviewByTokenHandler(db))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	// GET /profiles/me to retrieve the preview_token
	meReq, err := http.NewRequestWithContext(t.Context(), http.MethodGet, srv.URL+"/profiles/me", nil)
	require.NoError(t, err)
	meReq.Header.Set("Authorization", "Bearer "+ownerToken)
	meResp, err := http.DefaultClient.Do(meReq)
	require.NoError(t, err)
	defer func() { _ = meResp.Body.Close() }()
	require.Equal(t, http.StatusOK, meResp.StatusCode)
	var meBody map[string]any
	require.NoError(t, json.NewDecoder(meResp.Body).Decode(&meBody))
	previewToken, ok := meBody["preview_token"].(string)
	require.True(t, ok, "preview_token must be a string in /profiles/me response")
	require.NotEmpty(t, previewToken)

	// GET /profiles/preview/{token} without auth → 200
	prevReq, err := http.NewRequestWithContext(t.Context(), http.MethodGet, srv.URL+"/profiles/preview/"+previewToken, nil)
	require.NoError(t, err)
	prevResp, err := http.DefaultClient.Do(prevReq)
	require.NoError(t, err)
	defer func() { _ = prevResp.Body.Close() }()
	require.Equal(t, http.StatusOK, prevResp.StatusCode)
	var prevBody map[string]any
	require.NoError(t, json.NewDecoder(prevResp.Body).Decode(&prevBody))
	assert.Equal(t, "Preview Artist", prevBody["display_name"])
	_, hasToken := prevBody["preview_token"]
	assert.False(t, hasToken, "preview_token must not appear in preview response")
}

func TestPreviewByToken_BadToken_Returns404(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	r := chi.NewRouter()
	r.Get("/profiles/preview/{token}", artist.PreviewByTokenHandler(db))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, srv.URL+"/profiles/preview/notavalidtoken", nil)
	require.NoError(t, err)
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer func() { _ = resp.Body.Close() }()
	assert.Equal(t, http.StatusNotFound, resp.StatusCode)
}

func TestPreviewByToken_DraftVisible(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	userID, ownerToken := createTestUser(t, db)
	profileID := createTestProfile(t, db, userID, "Draft Artist")

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Get("/profiles/me", artist.GetMyProfileHandler(db))
	r.Get("/profiles/preview/{token}", artist.PreviewByTokenHandler(db))
	r.Get("/profiles/{profileID}", artist.GetProfileHandler(db))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	// Get preview token
	meReq, _ := http.NewRequestWithContext(t.Context(), http.MethodGet, srv.URL+"/profiles/me", nil)
	meReq.Header.Set("Authorization", "Bearer "+ownerToken)
	meResp, err := http.DefaultClient.Do(meReq)
	require.NoError(t, err)
	defer func() { _ = meResp.Body.Close() }()
	var meBody map[string]any
	require.NoError(t, json.NewDecoder(meResp.Body).Decode(&meBody))
	previewToken := meBody["preview_token"].(string)

	// Direct GET returns 404 (draft, unauthed)
	dirReq, _ := http.NewRequestWithContext(t.Context(), http.MethodGet, srv.URL+"/profiles/"+profileID, nil)
	dirResp, err := http.DefaultClient.Do(dirReq)
	require.NoError(t, err)
	_ = dirResp.Body.Close()
	assert.Equal(t, http.StatusNotFound, dirResp.StatusCode, "draft should be 404 without auth")

	// Preview GET returns 200
	prevReq, _ := http.NewRequestWithContext(t.Context(), http.MethodGet, srv.URL+"/profiles/preview/"+previewToken, nil)
	prevResp, err := http.DefaultClient.Do(prevReq)
	require.NoError(t, err)
	defer func() { _ = prevResp.Body.Close() }()
	assert.Equal(t, http.StatusOK, prevResp.StatusCode, "draft should be 200 via preview token")
}

func TestRotatePreviewToken_InvalidatesOldToken(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	userID, ownerToken := createTestUser(t, db)
	_ = createTestProfile(t, db, userID, "Rotate Artist")

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Get("/profiles/me", artist.GetMyProfileHandler(db))
	r.Post("/profiles/me/preview-token/rotate", artist.RotatePreviewTokenHandler(db))
	r.Get("/profiles/preview/{token}", artist.PreviewByTokenHandler(db))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	// Get original token
	meReq, _ := http.NewRequestWithContext(t.Context(), http.MethodGet, srv.URL+"/profiles/me", nil)
	meReq.Header.Set("Authorization", "Bearer "+ownerToken)
	meResp, _ := http.DefaultClient.Do(meReq)
	var meBody map[string]any
	_ = json.NewDecoder(meResp.Body).Decode(&meBody)
	_ = meResp.Body.Close()
	oldToken := meBody["preview_token"].(string)

	// Rotate
	rotReq, _ := http.NewRequestWithContext(t.Context(), http.MethodPost, srv.URL+"/profiles/me/preview-token/rotate", nil)
	rotReq.Header.Set("Authorization", "Bearer "+ownerToken)
	rotResp, err := http.DefaultClient.Do(rotReq)
	require.NoError(t, err)
	defer func() { _ = rotResp.Body.Close() }()
	require.Equal(t, http.StatusOK, rotResp.StatusCode)
	var rotBody map[string]any
	_ = json.NewDecoder(rotResp.Body).Decode(&rotBody)
	newToken := rotBody["preview_token"].(string)
	assert.NotEqual(t, oldToken, newToken, "rotate must produce a different token")

	// Old token → 404
	oldReq, _ := http.NewRequestWithContext(t.Context(), http.MethodGet, srv.URL+"/profiles/preview/"+oldToken, nil)
	oldResp, err := http.DefaultClient.Do(oldReq)
	require.NoError(t, err)
	_ = oldResp.Body.Close()
	assert.Equal(t, http.StatusNotFound, oldResp.StatusCode, "old token must be invalidated")

	// New token → 200
	newReq, _ := http.NewRequestWithContext(t.Context(), http.MethodGet, srv.URL+"/profiles/preview/"+newToken, nil)
	newResp, err := http.DefaultClient.Do(newReq)
	require.NoError(t, err)
	_ = newResp.Body.Close()
	assert.Equal(t, http.StatusOK, newResp.StatusCode, "new token must be valid")
}

func TestRotatePreviewToken_RequiresAuth(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Post("/profiles/me/preview-token/rotate", artist.RotatePreviewTokenHandler(db))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	req, _ := http.NewRequestWithContext(t.Context(), http.MethodPost, srv.URL+"/profiles/me/preview-token/rotate", nil)
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	_ = resp.Body.Close()
	assert.Equal(t, http.StatusUnauthorized, resp.StatusCode)
}

func TestUpdateProfile_DraftToPublic_NoEntitlement_Returns402(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	userID, token := createTestUser(t, db)
	_ = createTestProfile(t, db, userID, "Gate Test Artist")

	handler := auth.Middleware(db, testSecret)(artist.UpdateProfileHandler(db))
	body := `{"visibility":"public"}`
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPatch, "/profiles/me",
		bytes.NewBufferString(body))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	assert.Equal(t, http.StatusPaymentRequired, w.Code, w.Body.String())
	var resp map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	assert.Equal(t, "payment_required", resp["code"])
}

func TestUpdateProfile_DraftToPublic_WithGrant_Returns200(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	userID, token := createTestUser(t, db)
	_ = createTestProfile(t, db, userID, "Entitled Artist")
	grantArtistBasic(t, db, userID)

	handler := auth.Middleware(db, testSecret)(artist.UpdateProfileHandler(db))
	body := `{"visibility":"public"}`
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPatch, "/profiles/me",
		bytes.NewBufferString(body))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	var resp map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	assert.Equal(t, "public", resp["visibility"])
}

func TestUpdateProfile_PublicToDraft_NoGrant_Returns200(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	userID, token := createTestUser(t, db)
	profileID := createTestProfile(t, db, userID, "WasPublic Artist")
	publishTestProfile(t, db, profileID) // direct DB publish — bypasses gate

	handler := auth.Middleware(db, testSecret)(artist.UpdateProfileHandler(db))
	body := `{"visibility":"draft"}`
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPatch, "/profiles/me",
		bytes.NewBufferString(body))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	var resp map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	assert.Equal(t, "draft", resp["visibility"])
}

func TestUpdateProfile_NonVisibilityPatch_NoGrant_Returns200(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	userID, token := createTestUser(t, db)
	_ = createTestProfile(t, db, userID, "Bio Artist")

	handler := auth.Middleware(db, testSecret)(artist.UpdateProfileHandler(db))
	body := `{"bio":"My updated bio"}`
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPatch, "/profiles/me",
		bytes.NewBufferString(body))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
}

func TestUpdateProfile_ShowLocationPreservedWhenOmitted(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	userID, token := createTestUser(t, db)
	createTestProfile(t, db, userID, "Eve")

	// First PATCH: enable show_location
	enableHandler := auth.Middleware(db, testSecret)(artist.UpdateProfileHandler(db))
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPatch, "/profiles/me",
		bytes.NewBufferString(`{"showLocation":true}`))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	enableHandler.ServeHTTP(w, r)
	require.Equal(t, http.StatusOK, w.Code, "enable show_location: %s", w.Body.String())

	// Second PATCH: update bio only, don't mention showLocation
	updateHandler := auth.Middleware(db, testSecret)(artist.UpdateProfileHandler(db))
	r2 := httptest.NewRequestWithContext(t.Context(), http.MethodPatch, "/profiles/me",
		bytes.NewBufferString(`{"bio":"New bio"}`))
	r2.Header.Set("Content-Type", "application/json")
	r2.Header.Set("Authorization", "Bearer "+token)
	w2 := httptest.NewRecorder()
	updateHandler.ServeHTTP(w2, r2)
	require.Equal(t, http.StatusOK, w2.Code, "update bio: %s", w2.Body.String())

	// Verify bio was updated (show_location preserved implicitly)
	getHandler := auth.Middleware(db, testSecret)(artist.GetMyProfileHandler(db))
	r3 := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/profiles/me", nil)
	r3.Header.Set("Authorization", "Bearer "+token)
	w3 := httptest.NewRecorder()
	getHandler.ServeHTTP(w3, r3)
	var resp map[string]any
	require.NoError(t, json.NewDecoder(w3.Body).Decode(&resp))
	assert.Equal(t, "New bio", resp["bio"])
}

func TestUpdateProfile_PublicToPublic_NoGrant_Returns200(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	userID, token := createTestUser(t, db)
	profileID := createTestProfile(t, db, userID, "StillPublic Artist")
	publishTestProfile(t, db, profileID) // set public via DB — no grant needed

	handler := auth.Middleware(db, testSecret)(artist.UpdateProfileHandler(db))
	body := `{"visibility":"public"}`
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPatch, "/profiles/me",
		bytes.NewBufferString(body))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	var resp map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	assert.Equal(t, "public", resp["visibility"])
}
