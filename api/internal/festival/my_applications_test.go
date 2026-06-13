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
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
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
	assert.Nil(t, apps[0]["decision"]) // decision is nil until released
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

func TestMyApplications_HidesReviewSignals(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)

	orgID, _, _ := testutil.CreateUser(t, db)
	artistUserID, artistToken, _ := testutil.CreateUser(t, db)

	festID, _ := createTestFestival(t, db, orgID, "open")
	createTestApplicationForm(t, db, festID)
	createTestArtistProfile(t, db, artistUserID, "Privacy Artist")
	appID := createTestApplicationInFestival(t, db, festID, artistUserID)

	// Organiser sets decision 'accept' and shortlists — internal review signals.
	_, err := sqlcdb.New(db).UpdateApplicationFlags(t.Context(), sqlcdb.UpdateApplicationFlagsParams{
		ID: pgUUID(t, appID), Shortlisted: true, ReviewFlag: true, Decision: sqlcdb.ApplicationDecisionAccept,
	})
	require.NoError(t, err)

	handler := auth.Middleware(db, testSecret)(festival.GetMyApplicationsHandler(db))
	r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/me/applications", nil)
	r.Header.Set("Authorization", "Bearer "+artistToken)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	body := w.Body.String()
	// Artist must not see the decision until it's released (released_at is nil).
	require.Contains(t, body, `"decision":null`)
	require.NotContains(t, body, "shortlisted")
	require.NotContains(t, body, "review_flag")
	require.NotContains(t, body, `"rank"`)
}
