package festival_test

import (
	"encoding/json"
	"io"
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

func TestGetMyApplications_ReturnsOwnApplications(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)

	// Set up organiser + festival + form
	orgID, _, _ := createTestUser(t, db)
	festID, _ := createTestFestival(t, db, orgID, "open")
	createTestApplicationForm(t, db, festID)

	// Set up artist + profile
	artistUserID, artistToken, _ := createTestUser(t, db)
	createTestArtistProfile(t, db, artistUserID, "My Apps Artist")

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Post("/festivals/{festivalID}/apply", festival.SubmitApplicationHandler(db))
	r.Get("/me/applications", festival.GetMyApplicationsHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	// Submit an application
	resp := doRequest(t, srv, "POST", "/festivals/"+festID+"/apply", `{"answers":{}}`, artistToken)
	require.Equal(t, http.StatusCreated, resp.StatusCode, "submit application")
	_ = resp.Body.Close()

	// Fetch own applications
	resp = doRequest(t, srv, "GET", "/me/applications", "", artistToken)
	require.Equal(t, http.StatusOK, resp.StatusCode)

	body, err := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	require.NoError(t, err)

	var apps []map[string]any
	require.NoError(t, json.Unmarshal(body, &apps))
	require.Len(t, apps, 1)
	assert.Equal(t, "submitted", apps[0]["status"])
}

func TestGetMyApplications_RequiresAuth(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Get("/me/applications", festival.GetMyApplicationsHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "GET", "/me/applications", "", "")
	require.Equal(t, http.StatusUnauthorized, resp.StatusCode)
	_ = resp.Body.Close()
}

func TestGetMyApplications_NoProfileReturnsEmptyArray(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)

	// Artist with no profile
	_, artistToken, _ := createTestUser(t, db)

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Get("/me/applications", festival.GetMyApplicationsHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "GET", "/me/applications", "", artistToken)
	require.Equal(t, http.StatusOK, resp.StatusCode)

	body, err := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	require.NoError(t, err)

	var apps []map[string]any
	require.NoError(t, json.Unmarshal(body, &apps))
	assert.Empty(t, apps)
}

func TestGetMyApplications_DoesNotReturnOtherArtistsApplications(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)

	orgID, _, _ := createTestUser(t, db)
	festID, _ := createTestFestival(t, db, orgID, "open")
	createTestApplicationForm(t, db, festID)

	// Artist A submits
	artistAID, artistAToken, _ := createTestUser(t, db)
	createTestArtistProfile(t, db, artistAID, "Artist A")

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Post("/festivals/{festivalID}/apply", festival.SubmitApplicationHandler(db))
	r.Get("/me/applications", festival.GetMyApplicationsHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "POST", "/festivals/"+festID+"/apply", `{"answers":{}}`, artistAToken)
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	_ = resp.Body.Close()

	// Artist B (no applications) queries /me/applications
	artistBID, artistBToken, _ := createTestUser(t, db)
	createTestArtistProfile(t, db, artistBID, "Artist B")

	resp = doRequest(t, srv, "GET", "/me/applications", "", artistBToken)
	require.Equal(t, http.StatusOK, resp.StatusCode)

	body, err := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	require.NoError(t, err)

	var apps []map[string]any
	require.NoError(t, json.Unmarshal(body, &apps))
	assert.Empty(t, apps, "artist B should see zero applications")
}
