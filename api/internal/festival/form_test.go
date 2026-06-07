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
	orgID, orgToken, _ := createTestUser(t, db)
	festID, _ := createTestFestival(t, db, orgID, "draft")

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

func TestUpsertForm_RejectsMalformedFields(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	orgID, orgToken, _ := createTestUser(t, db)
	festID, _ := createTestFestival(t, db, orgID, "draft")

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Put("/festivals/{festivalID}/form", festival.UpsertFormHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	upsertFormRaw := func(fieldsJSON string) int {
		body := `{"fields":` + fieldsJSON + `}`
		resp := doRequest(t, srv, "PUT", "/festivals/"+festID+"/form", body, orgToken)
		_ = resp.Body.Close()
		return resp.StatusCode
	}

	// missing label
	if code := upsertFormRaw(`[{"id":"a","type":"text"}]`); code != http.StatusUnprocessableEntity {
		t.Errorf("missing label: got %d want 422", code)
	}
	// unknown type
	if code := upsertFormRaw(`[{"id":"a","type":"slider","label":"x"}]`); code != http.StatusUnprocessableEntity {
		t.Errorf("unknown type: got %d want 422", code)
	}
	// select with no options
	if code := upsertFormRaw(`[{"id":"a","type":"select","label":"x"}]`); code != http.StatusUnprocessableEntity {
		t.Errorf("select no options: got %d want 422", code)
	}
	// valid embed field
	if code := upsertFormRaw(`[{"id":"a","type":"embed","label":"Video"}]`); code != http.StatusOK {
		t.Errorf("valid embed: got %d want 200", code)
	}
	// missing id is backfilled (not rejected) — keeps older callers/seed data working
	if code := upsertFormRaw(`[{"type":"text","label":"Artist statement","required":true}]`); code != http.StatusOK {
		t.Errorf("missing id (backfilled): got %d want 200", code)
	}
}

// TestUpsertForm_ValidatesPrefill covers the E28 M2 profile-binding allowlist:
// a known prefill key is accepted, an unknown one is rejected with 422, and an
// empty/absent prefill is treated as "no binding".
func TestUpsertForm_ValidatesPrefill(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	orgID, orgToken, _ := createTestUser(t, db)
	festID, _ := createTestFestival(t, db, orgID, "draft")

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Put("/festivals/{festivalID}/form", festival.UpsertFormHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	put := func(fieldsJSON string) int {
		resp := doRequest(t, srv, "PUT", "/festivals/"+festID+"/form", `{"fields":`+fieldsJSON+`}`, orgToken)
		_ = resp.Body.Close()
		return resp.StatusCode
	}

	assert.Equal(t, http.StatusOK, put(`[{"id":"a","type":"text","label":"Instagram","prefill":"social.instagram"}]`), "valid social prefill")
	assert.Equal(t, http.StatusOK, put(`[{"id":"a","type":"text","label":"Portfolio","prefill":"portfolio_collection"}]`), "valid portfolio_collection prefill")
	assert.Equal(t, http.StatusUnprocessableEntity, put(`[{"id":"a","type":"text","label":"x","prefill":"social.myspace"}]`), "unknown prefill key rejected")
	assert.Equal(t, http.StatusOK, put(`[{"id":"a","type":"text","label":"x","prefill":""}]`), "empty prefill = no binding")
}

func TestUpsertForm_OnlyOrganiserOwnerCanUpsert(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	orgID, _, _ := createTestUser(t, db)
	_, otherToken, _ := createTestUser(t, db)
	festID, _ := createTestFestival(t, db, orgID, "draft")

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
	orgID, _, _ := createTestUser(t, db)
	festID, _ := createTestFestival(t, db, orgID, "draft")
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
	assert.False(t, hasAnon, "anonymous_review field has been removed; must not appear in the public form response")
}

func TestGetForm_NotFound(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	orgID, _, _ := createTestUser(t, db)
	festID, _ := createTestFestival(t, db, orgID, "draft")

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Get("/festivals/{festivalID}/form", festival.GetFormHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "GET", "/festivals/"+festID+"/form", "", "")
	require.Equal(t, http.StatusNotFound, resp.StatusCode)
	_ = resp.Body.Close()
}

func TestPatchForm_RequiresOwner(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	orgID, _, _ := createTestUser(t, db)
	_, otherTok, _ := createTestUser(t, db)
	festID, _ := createTestFestival(t, db, orgID, "draft")
	createTestApplicationForm(t, db, festID)

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Patch("/festivals/{festivalID}/form", festival.PatchFormHandler(db))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "PATCH", "/festivals/"+festID+"/form", `{"review_criteria":[]}`, otherTok)
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	_ = resp.Body.Close()
}

func TestPatchForm_AnonymousReview_FieldIgnored(t *testing.T) {
	t.Parallel()
	// anonymous_review has been removed from the schema. Sending it must not
	// cause an error — the field is silently ignored and the response must
	// not contain it.
	db := testutil.NewDB(t)
	orgID, orgTok, _ := createTestUser(t, db)
	festID, _ := createTestFestival(t, db, orgID, "draft")
	createTestApplicationForm(t, db, festID)

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Patch("/festivals/{festivalID}/form", festival.PatchFormHandler(db))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "PATCH", "/festivals/"+festID+"/form", `{"anonymous_review":true}`, orgTok)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var form map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&form))
	_ = resp.Body.Close()
	_, hasAnon := form["anonymous_review"]
	assert.False(t, hasAnon, "anonymous_review must not appear in form response")
}

func TestPatchForm_NoForm_Returns404(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	orgID, orgTok, _ := createTestUser(t, db)
	festID, _ := createTestFestival(t, db, orgID, "draft")
	// No form created

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Patch("/festivals/{festivalID}/form", festival.PatchFormHandler(db))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "PATCH", "/festivals/"+festID+"/form", `{"review_criteria":[]}`, orgTok)
	require.Equal(t, http.StatusNotFound, resp.StatusCode)
	_ = resp.Body.Close()
}

func TestPatchForm_Criteria_AddAndList(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	orgID, orgTok, _ := createTestUser(t, db)
	festID, _ := createTestFestival(t, db, orgID, "draft")
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
	orgID, orgTok, _ := createTestUser(t, db)
	festID, _ := createTestFestival(t, db, orgID, "draft")
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
	orgID, orgTok, _ := createTestUser(t, db)
	festID, _ := createTestFestival(t, db, orgID, "draft")
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
	orgID, orgTok, _ := createTestUser(t, db)
	revID, revTok, _ := createTestUser(t, db)
	festID, _ := createTestFestival(t, db, orgID, "open")
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
	orgID, orgTok, _ := createTestUser(t, db)
	festID, _ := createTestFestival(t, db, orgID, "draft")
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
