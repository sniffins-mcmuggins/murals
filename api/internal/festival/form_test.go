package festival_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/festival"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

func TestUpsertForm_CreatesAndUpdates(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	orgID, orgToken := createTestUser(t, db, "formorg@example.com")
	festID := createTestFestival(t, db, orgID, "form-test-fest", "draft")

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Put("/festivals/{festivalID}/form", festival.UpsertFormHandler(db))
	r.Get("/festivals/{festivalID}/form", festival.GetFormHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	// Create
	body := `{"fields":[{"id":"q1","label":"Why do you want to paint?","type":"long_text","required":true}]}`
	resp := doRequest(t, srv, "PUT", "/festivals/"+festID+"/form", body, orgToken)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var form map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&form))
	_ = resp.Body.Close()
	assert.Len(t, form["fields"].([]any), 1)

	// Update — replace fields wholesale
	body2 := `{"fields":[{"id":"q1","label":"Why?","type":"long_text","required":true},{"id":"q2","label":"Portfolio URL","type":"url","required":false}]}`
	resp2 := doRequest(t, srv, "PUT", "/festivals/"+festID+"/form", body2, orgToken)
	require.Equal(t, http.StatusOK, resp2.StatusCode)
	var form2 map[string]any
	require.NoError(t, json.NewDecoder(resp2.Body).Decode(&form2))
	_ = resp2.Body.Close()
	assert.Len(t, form2["fields"].([]any), 2)
}

func TestUpsertForm_OnlyOrganiserOwnerCanUpsert(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	orgID, _ := createTestUser(t, db, "formorg2@example.com")
	_, otherToken := createTestUser(t, db, "formorg3@example.com")
	festID := createTestFestival(t, db, orgID, "form-test-fest2", "draft")

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Put("/festivals/{festivalID}/form", festival.UpsertFormHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "PUT", "/festivals/"+festID+"/form", `{"fields":[]}`, otherToken)
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	_ = resp.Body.Close()
}

func TestGetForm_Public(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	orgID, _ := createTestUser(t, db, "formorg4@example.com")
	festID := createTestFestival(t, db, orgID, "form-test-fest3", "draft")
	createTestApplicationForm(t, db, festID)

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Get("/festivals/{festivalID}/form", festival.GetFormHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "GET", "/festivals/"+festID+"/form", "", "")
	require.Equal(t, http.StatusOK, resp.StatusCode)
	_ = resp.Body.Close()
}

func TestGetForm_NotFound(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	orgID, _ := createTestUser(t, db, "formorg5@example.com")
	festID := createTestFestival(t, db, orgID, "form-no-form", "draft")

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Get("/festivals/{festivalID}/form", festival.GetFormHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "GET", "/festivals/"+festID+"/form", "", "")
	require.Equal(t, http.StatusNotFound, resp.StatusCode)
	_ = resp.Body.Close()
}

func TestPatchForm_AnonymousReview_RequiresOwner(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	orgID, _ := createTestUser(t, db, "patchform-org1@test")
	_, otherTok := createTestUser(t, db, "patchform-other1@test")
	festID := createTestFestival(t, db, orgID, "patchform-fest1", "draft")
	createTestApplicationForm(t, db, festID)

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Patch("/festivals/{festivalID}/form", festival.PatchFormHandler(db))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "PATCH", "/festivals/"+festID+"/form", `{"anonymous_review":true}`, otherTok)
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	_ = resp.Body.Close()
}

func TestPatchForm_AnonymousReview_TogglesOn(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	orgID, orgTok := createTestUser(t, db, "patchform-org2@test")
	festID := createTestFestival(t, db, orgID, "patchform-fest2", "draft")
	createTestApplicationForm(t, db, festID)

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Patch("/festivals/{festivalID}/form", festival.PatchFormHandler(db))
	r.Get("/festivals/{festivalID}/form", festival.GetFormHandler(db))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	// Enable anonymous review
	resp := doRequest(t, srv, "PATCH", "/festivals/"+festID+"/form", `{"anonymous_review":true}`, orgTok)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var form map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&form))
	_ = resp.Body.Close()
	assert.Equal(t, true, form["anonymous_review"])

	// GET reflects the persisted value
	get := doRequest(t, srv, "GET", "/festivals/"+festID+"/form", "", "")
	require.Equal(t, http.StatusOK, get.StatusCode)
	var form2 map[string]any
	require.NoError(t, json.NewDecoder(get.Body).Decode(&form2))
	_ = get.Body.Close()
	assert.Equal(t, true, form2["anonymous_review"])
}

func TestPatchForm_AnonymousReview_404_NoForm(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	orgID, orgTok := createTestUser(t, db, "patchform-org3@test")
	festID := createTestFestival(t, db, orgID, "patchform-fest3", "draft")
	// No form created

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Patch("/festivals/{festivalID}/form", festival.PatchFormHandler(db))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "PATCH", "/festivals/"+festID+"/form", `{"anonymous_review":true}`, orgTok)
	require.Equal(t, http.StatusNotFound, resp.StatusCode)
	_ = resp.Body.Close()
}
