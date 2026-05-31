package festival_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/sniffins-mcmuggins/render/api/internal/festival"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

func TestListPublicFestivals(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	orgID, _, _ := createTestUser(t, db)

	// Create one live and one draft festival
	_, liveSlug := createTestFestival(t, db, orgID, "live")
	createTestFestival(t, db, orgID, "draft")

	r := chi.NewRouter()
	r.Get("/public/festivals", festival.ListPublicHandler(db))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "GET", "/public/festivals", "", "")
	require.Equal(t, http.StatusOK, resp.StatusCode)

	var body []map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	_ = resp.Body.Close()

	assert.Len(t, body, 1)
	assert.Equal(t, liveSlug, body[0]["slug"])
}

func TestListPublicFestivals_StatusFilter(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	orgID, _, _ := createTestUser(t, db)

	_, openSlug := createTestFestival(t, db, orgID, "open")
	createTestFestival(t, db, orgID, "live")

	r := chi.NewRouter()
	r.Get("/public/festivals", festival.ListPublicHandler(db))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "GET", "/public/festivals?status=open", "", "")
	require.Equal(t, http.StatusOK, resp.StatusCode)

	var body []map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	_ = resp.Body.Close()

	assert.Len(t, body, 1)
	assert.Equal(t, openSlug, body[0]["slug"])
}

func TestListPublicFestivals_InvalidStatus(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)

	r := chi.NewRouter()
	r.Get("/public/festivals", festival.ListPublicHandler(db))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "GET", "/public/festivals?status=invalid", "", "")
	assert.Equal(t, http.StatusBadRequest, resp.StatusCode)
	_ = resp.Body.Close()
}
