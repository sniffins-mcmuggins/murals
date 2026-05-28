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
	_, otherToken := createTestUser(t, db, "patchother@example.com")

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
