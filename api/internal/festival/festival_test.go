package festival_test

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

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/festival"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

func TestCreateFestival(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	_, orgToken := createTestUser(t, db, "org@example.com", "organiser")

	r := chi.NewRouter()
	r.Use(auth.Middleware(testSecret))
	r.Post("/festivals", festival.CreateHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "POST", "/festivals",
		`{"name":"Summer Walls","slug":"summer-walls-2027","description":"Annual mural festival","locationLabel":"Bristol","startDate":"2027-06-01","endDate":"2027-06-07"}`,
		orgToken)
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	_ = resp.Body.Close()
}

func TestCreateFestival_RequiresOrganiser(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	_, artistToken := createTestUser(t, db, "artist@example.com", "artist")

	r := chi.NewRouter()
	r.Use(auth.Middleware(testSecret))
	r.Post("/festivals", festival.CreateHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "POST", "/festivals",
		`{"name":"X","slug":"x","description":"","locationLabel":""}`,
		artistToken)
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	_ = resp.Body.Close()
}

func TestGetFestival_PublicDraftReturns404(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	orgID, orgToken := createTestUser(t, db, "org2@example.com", "organiser")
	festID := createTestFestival(t, db, orgID, "draft-fest", "draft")

	r := chi.NewRouter()
	r.Use(auth.Middleware(testSecret))
	r.Get("/festivals/{festivalID}", festival.GetHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	// Public request (no token) - draft → 404
	resp := doRequest(t, srv, "GET", "/festivals/"+festID, "", "")
	require.Equal(t, http.StatusNotFound, resp.StatusCode, "expected 404 for draft festival (public)")
	_ = resp.Body.Close()

	// Organiser request with token - draft → 200
	resp = doRequest(t, srv, "GET", "/festivals/"+festID, "", orgToken)
	require.Equal(t, http.StatusOK, resp.StatusCode, "expected 200 for draft festival (owner)")
	_ = resp.Body.Close()
}

func TestUpdateFestival_OnlyOrganiserCanUpdate(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	orgID, orgToken := createTestUser(t, db, "org3@example.com", "organiser")
	_, otherToken := createTestUser(t, db, "other@example.com", "organiser")
	festID := createTestFestival(t, db, orgID, "my-fest", "draft")

	r := chi.NewRouter()
	r.Use(auth.Middleware(testSecret))
	r.Patch("/festivals/{festivalID}", festival.UpdateHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	// Other organiser → 403
	resp := doRequest(t, srv, "PATCH", "/festivals/"+festID,
		`{"name":"Changed","slug":"changed","description":"","locationLabel":""}`, otherToken)
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	_ = resp.Body.Close()

	// Correct organiser → 200
	resp = doRequest(t, srv, "PATCH", "/festivals/"+festID,
		`{"name":"Updated Name","slug":"my-fest","description":"Updated desc","locationLabel":"Bristol"}`, orgToken)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var respBody map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&respBody))
	_ = resp.Body.Close()
	assert.Equal(t, "Updated Name", respBody["name"])
}

func TestDeleteFestival_SoftDelete(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	orgID, orgToken := createTestUser(t, db, "org4@example.com", "organiser")
	festID := createTestFestival(t, db, orgID, "to-delete", "draft")

	r := chi.NewRouter()
	r.Use(auth.Middleware(testSecret))
	r.Delete("/festivals/{festivalID}", festival.DeleteHandler(db))
	r.Get("/festivals/{festivalID}", festival.GetHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "DELETE", "/festivals/"+festID, "", orgToken)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	_ = resp.Body.Close()

	// Verify gone
	resp = doRequest(t, srv, "GET", "/festivals/"+festID, "", orgToken)
	require.Equal(t, http.StatusNotFound, resp.StatusCode, "expected 404 after delete")
	_ = resp.Body.Close()
}

func TestListFestivals(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	orgID, orgToken := createTestUser(t, db, "org5@example.com", "organiser")
	createTestFestival(t, db, orgID, "fest-a", "draft")
	createTestFestival(t, db, orgID, "fest-b", "draft")

	r := chi.NewRouter()
	r.Use(auth.Middleware(testSecret))
	r.Get("/festivals", festival.ListHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "GET", "/festivals", "", orgToken)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var list []map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&list))
	_ = resp.Body.Close()
	assert.Len(t, list, 2)
}

// doRequest is a helper used across test files in this package.
func doRequest(t *testing.T, srv *httptest.Server, method, path, body, token string) *http.Response {
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
