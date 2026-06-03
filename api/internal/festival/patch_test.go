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

func TestPatchApplicationFlags(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupReviewScenario(t, db)

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Patch("/festivals/{festivalID}/applications/{applicationID}",
		festival.PatchApplicationHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	body := `{"shortlisted":true,"review_flag":false}`
	resp := doRequest(t, srv, "PATCH",
		"/festivals/"+sc.festID+"/applications/"+sc.applicationID,
		body, sc.orgToken)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var app map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&app))
	_ = resp.Body.Close()
	assert.Equal(t, true, app["shortlisted"])
	assert.Equal(t, false, app["review_flag"])
}

func TestPatchApplicationFlags_ForbiddenForNonOwner(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupReviewScenario(t, db)
	_, otherToken, _ := createTestUser(t, db)

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Patch("/festivals/{festivalID}/applications/{applicationID}",
		festival.PatchApplicationHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "PATCH",
		"/festivals/"+sc.festID+"/applications/"+sc.applicationID,
		`{"shortlisted":true,"review_flag":false}`, otherToken)
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	_ = resp.Body.Close()
}

func TestPatchApplicationStagedDecision(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupReviewScenario(t, db)

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Patch("/festivals/{festivalID}/applications/{applicationID}",
		festival.PatchApplicationHandler(db))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	// Stage as accept
	body := `{"shortlisted":false,"review_flag":false,"staged_decision":"accept"}`
	resp := doRequest(t, srv, "PATCH",
		"/festivals/"+sc.festID+"/applications/"+sc.applicationID,
		body, sc.orgToken)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var app map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&app))
	_ = resp.Body.Close()
	assert.Equal(t, "accept", app["staged_decision"])

	// Clear staged decision
	body = `{"shortlisted":false,"review_flag":false,"staged_decision":null}`
	resp = doRequest(t, srv, "PATCH",
		"/festivals/"+sc.festID+"/applications/"+sc.applicationID,
		body, sc.orgToken)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var app2 map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&app2))
	_ = resp.Body.Close()
	assert.Nil(t, app2["staged_decision"])

	// Invalid staged_decision value should reject
	body = `{"shortlisted":false,"review_flag":false,"staged_decision":"invalid"}`
	resp = doRequest(t, srv, "PATCH",
		"/festivals/"+sc.festID+"/applications/"+sc.applicationID,
		body, sc.orgToken)
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)
	_ = resp.Body.Close()

	// Omitting staged_decision should preserve prior value
	body = `{"shortlisted":true,"review_flag":false}`
	resp = doRequest(t, srv, "PATCH",
		"/festivals/"+sc.festID+"/applications/"+sc.applicationID,
		body, sc.orgToken)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var app3 map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&app3))
	_ = resp.Body.Close()
	assert.Nil(t, app3["staged_decision"]) // should still be null from the previous request
}

func TestReorderApplications(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupReviewScenario(t, db)

	// Create second artist + application in same festival
	artistID2, _, _ := createTestUser(t, db)
	createTestArtistProfile(t, db, artistID2, "Reorder Artist 2")
	appID2 := createTestApplicationInFestival(t, db, sc.festID, artistID2)

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Post("/festivals/{festivalID}/applications/reorder",
		festival.ReorderApplicationsHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	body := `{"status":"submitted","ids":["` + appID2 + `","` + sc.applicationID + `"]}`
	resp := doRequest(t, srv, "POST",
		"/festivals/"+sc.festID+"/applications/reorder",
		body, sc.orgToken)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	_ = resp.Body.Close()
}
