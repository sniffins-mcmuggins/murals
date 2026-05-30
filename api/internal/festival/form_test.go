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
	var formData map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&formData))
	_ = resp.Body.Close()
	_, hasAnon := formData["anonymous_review"]
	assert.False(t, hasAnon, "public GET /form must not expose anonymous_review")
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

	// GET does not expose anonymous_review to public
	get := doRequest(t, srv, "GET", "/festivals/"+festID+"/form", "", "")
	require.Equal(t, http.StatusOK, get.StatusCode)
	var form2 map[string]any
	require.NoError(t, json.NewDecoder(get.Body).Decode(&form2))
	_ = get.Body.Close()
	_, hasAnon := form2["anonymous_review"]
	assert.False(t, hasAnon, "public GET must not expose anonymous_review")
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

func TestPatchForm_Criteria_AddAndList(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	orgID, orgTok := createTestUser(t, db, "crit-org-1@test")
	festID := createTestFestival(t, db, orgID, "crit-fest-1", "draft")
	createTestApplicationForm(t, db, festID)

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Patch("/festivals/{festivalID}/form", festival.PatchFormHandler(db))
	r.Get("/festivals/{festivalID}/form", festival.GetFormHandler(db))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	body := `{"review_criteria":[{"label":"Artistic Quality","min":1,"max":5},{"label":"Feasibility","min":1,"max":5}]}`
	resp := doRequest(t, srv, "PATCH", "/festivals/"+festID+"/form", body, orgTok)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var form map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&form))
	_ = resp.Body.Close()

	criteria, ok := form["review_criteria"].([]any)
	require.True(t, ok)
	require.Len(t, criteria, 2)
	c0 := criteria[0].(map[string]any)
	assert.Equal(t, "Artistic Quality", c0["label"])
	assert.NotEmpty(t, c0["id"], "API must assign an id")
	assert.Equal(t, float64(5), c0["max"])
}

func TestPatchForm_Criteria_LabelCollisionGetsUniqueID(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	orgID, orgTok := createTestUser(t, db, "crit-org-2@test")
	festID := createTestFestival(t, db, orgID, "crit-fest-2", "draft")
	createTestApplicationForm(t, db, festID)

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Patch("/festivals/{festivalID}/form", festival.PatchFormHandler(db))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	body := `{"review_criteria":[{"label":"Quality","min":1,"max":5},{"label":"Quality","min":1,"max":7}]}`
	resp := doRequest(t, srv, "PATCH", "/festivals/"+festID+"/form", body, orgTok)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var form map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&form))
	_ = resp.Body.Close()

	criteria := form["review_criteria"].([]any)
	id0 := criteria[0].(map[string]any)["id"].(string)
	id1 := criteria[1].(map[string]any)["id"].(string)
	assert.NotEqual(t, id0, id1, "duplicate labels must produce distinct IDs")
}

func TestPatchForm_Criteria_ThreeDuplicateLabels_SequentialIDs(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	orgID, orgTok := createTestUser(t, db, "crit-org-4@test")
	festID := createTestFestival(t, db, orgID, "crit-fest-4", "draft")
	createTestApplicationForm(t, db, festID)

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Patch("/festivals/{festivalID}/form", festival.PatchFormHandler(db))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	body := `{"review_criteria":[{"label":"Quality","min":1,"max":5},{"label":"Quality","min":1,"max":5},{"label":"Quality","min":1,"max":5}]}`
	resp := doRequest(t, srv, "PATCH", "/festivals/"+festID+"/form", body, orgTok)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var form map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&form))
	_ = resp.Body.Close()

	criteria := form["review_criteria"].([]any)
	ids := []string{
		criteria[0].(map[string]any)["id"].(string),
		criteria[1].(map[string]any)["id"].(string),
		criteria[2].(map[string]any)["id"].(string),
	}
	assert.Equal(t, []string{"quality", "quality-2", "quality-3"}, ids)
}

func TestGetForm_ReviewerSeesReviewCriteria(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	orgID, orgTok := createTestUser(t, db, "gf-rc-org@test")
	revID, revTok := createTestUser(t, db, "gf-rc-rev@test")
	festID := createTestFestival(t, db, orgID, "gf-rc-fest", "open")
	createTestApplicationForm(t, db, festID)
	addReviewer(t, db, festID, revID)

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Patch("/festivals/{festivalID}/form", festival.PatchFormHandler(db))
	r.Get("/festivals/{festivalID}/form", festival.GetFormHandler(db))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	// Owner configures criteria.
	patch := doRequest(t, srv, "PATCH", "/festivals/"+festID+"/form",
		`{"review_criteria":[{"label":"Artistic Quality","min":1,"max":5}]}`, orgTok)
	require.Equal(t, http.StatusOK, patch.StatusCode)
	_ = patch.Body.Close()

	// Reviewer GET sees review_criteria.
	revResp := doRequest(t, srv, "GET", "/festivals/"+festID+"/form", "", revTok)
	require.Equal(t, http.StatusOK, revResp.StatusCode)
	var revForm map[string]any
	require.NoError(t, json.NewDecoder(revResp.Body).Decode(&revForm))
	_ = revResp.Body.Close()
	rc, ok := revForm["review_criteria"].([]any)
	require.True(t, ok, "reviewer must receive review_criteria")
	require.Len(t, rc, 1)

	// Anonymous GET does NOT include review_criteria.
	anonResp := doRequest(t, srv, "GET", "/festivals/"+festID+"/form", "", "")
	require.Equal(t, http.StatusOK, anonResp.StatusCode)
	var anonForm map[string]any
	require.NoError(t, json.NewDecoder(anonResp.Body).Decode(&anonForm))
	_ = anonResp.Body.Close()
	_, hasRC := anonForm["review_criteria"]
	require.False(t, hasRC, "anonymous caller must NOT see review_criteria")
}

func TestPatchForm_Criteria_Validation_MaxTooLarge(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	orgID, orgTok := createTestUser(t, db, "crit-org-3@test")
	festID := createTestFestival(t, db, orgID, "crit-fest-3", "draft")
	createTestApplicationForm(t, db, festID)

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Patch("/festivals/{festivalID}/form", festival.PatchFormHandler(db))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	body := `{"review_criteria":[{"label":"Quality","min":1,"max":99}]}`
	resp := doRequest(t, srv, "PATCH", "/festivals/"+festID+"/form", body, orgTok)
	require.Equal(t, http.StatusUnprocessableEntity, resp.StatusCode)
	_ = resp.Body.Close()
}
