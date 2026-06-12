package festival_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/festival"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

func TestReleaseDecisions_BulkReleasesAndPreventsRerelease(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupReviewScenario(t, db)

	srv := buildReleaseTestServer(t, db)

	// Set the application's decision to 'accept' via PATCH
	patchBody := `{"shortlisted":false,"review_flag":false,"decision":"accept"}`
	patchResp := doRequest(t, srv, "PATCH",
		"/festivals/"+sc.festID+"/applications/"+sc.applicationID,
		patchBody, sc.orgToken)
	require.Equal(t, http.StatusOK, patchResp.StatusCode)
	_ = patchResp.Body.Close()

	// Release decisions
	resp := doRequest(t, srv, "POST",
		"/festivals/"+sc.festID+"/applications/release-decisions",
		"", sc.orgToken)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var result map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&result))
	_ = resp.Body.Close()
	assert.Equal(t, float64(1), result["released"])

	// Second release attempt → 409 (nothing new to release)
	resp2 := doRequest(t, srv, "POST",
		"/festivals/"+sc.festID+"/applications/release-decisions",
		"", sc.orgToken)
	require.Equal(t, http.StatusConflict, resp2.StatusCode)
	_ = resp2.Body.Close()
}

func TestReleaseDecisions_RejectsWhenUndecidedAppsExist(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupReviewScenario(t, db)

	srv := buildReleaseTestServer(t, db)

	// Do NOT set a decision — attempt release immediately
	resp := doRequest(t, srv, "POST",
		"/festivals/"+sc.festID+"/applications/release-decisions",
		"", sc.orgToken)
	require.Equal(t, http.StatusUnprocessableEntity, resp.StatusCode)
	_ = resp.Body.Close()
}

func TestReleaseDecisions_ForbiddenForNonOwner(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupReviewScenario(t, db)
	_, otherToken, _ := createTestUser(t, db)

	srv := buildReleaseTestServer(t, db)

	resp := doRequest(t, srv, "POST",
		"/festivals/"+sc.festID+"/applications/release-decisions",
		"", otherToken)
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	_ = resp.Body.Close()
}

// Releasing an 'accept' decision must turn the applicant into an accepted
// festival_artist — so they're assignable on the map and visible on the public roster.
func TestReleaseDecisions_AcceptedAppBecomesFestivalArtist(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupReviewScenario(t, db)
	srv := buildReleaseTestServer(t, db)

	q := sqlcdb.New(db)
	festUUID := pgUUID(t, sc.festID)

	// Precondition: the artist is only an applicant — no festival_artists row.
	before, err := q.GetUnassignedAcceptedArtists(context.Background(), festUUID)
	require.NoError(t, err)
	require.Empty(t, before, "no festival_artists should exist before release")

	// Set decision to accept, then release.
	patchResp := doRequest(t, srv, "PATCH",
		"/festivals/"+sc.festID+"/applications/"+sc.applicationID,
		`{"shortlisted":false,"review_flag":false,"decision":"accept"}`, sc.orgToken)
	require.Equal(t, http.StatusOK, patchResp.StatusCode)
	_ = patchResp.Body.Close()

	resp := doRequest(t, srv, "POST",
		"/festivals/"+sc.festID+"/applications/release-decisions", "", sc.orgToken)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	_ = resp.Body.Close()

	// The accepted artist is now an assignable festival_artist.
	after, err := q.GetUnassignedAcceptedArtists(context.Background(), festUUID)
	require.NoError(t, err)
	require.Len(t, after, 1, "released accept must create a festival_artists row")
	assert.Equal(t, "Review Artist", after[0].Name)
}

// Releasing a 'decline' (or waitlist) decision must NOT create a festival_artists row.
func TestReleaseDecisions_DeclinedAppDoesNotBecomeFestivalArtist(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupReviewScenario(t, db)
	srv := buildReleaseTestServer(t, db)

	q := sqlcdb.New(db)
	festUUID := pgUUID(t, sc.festID)

	// Set decision to decline, then release.
	patchResp := doRequest(t, srv, "PATCH",
		"/festivals/"+sc.festID+"/applications/"+sc.applicationID,
		`{"shortlisted":false,"review_flag":false,"decision":"decline"}`, sc.orgToken)
	require.Equal(t, http.StatusOK, patchResp.StatusCode)
	_ = patchResp.Body.Close()

	resp := doRequest(t, srv, "POST",
		"/festivals/"+sc.festID+"/applications/release-decisions", "", sc.orgToken)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	_ = resp.Body.Close()

	after, err := q.GetUnassignedAcceptedArtists(context.Background(), festUUID)
	require.NoError(t, err)
	assert.Empty(t, after, "released decline must not create a festival_artists row")
}

func TestReleaseDecisions_PostReleaseInvariantHolds(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupReviewScenario(t, db)
	srv := buildReleaseTestServer(t, db)
	q := sqlcdb.New(db)
	festUUID := pgUUID(t, sc.festID)

	patch := doRequest(t, srv, "PATCH",
		"/festivals/"+sc.festID+"/applications/"+sc.applicationID,
		`{"shortlisted":false,"review_flag":false,"decision":"accept"}`, sc.orgToken)
	require.Equal(t, http.StatusOK, patch.StatusCode)
	_ = patch.Body.Close()

	resp := doRequest(t, srv, "POST",
		"/festivals/"+sc.festID+"/applications/release-decisions", "", sc.orgToken)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	_ = resp.Body.Close()

	app, err := q.GetApplicationByID(context.Background(), pgUUID(t, sc.applicationID))
	require.NoError(t, err)
	assert.Equal(t, sqlcdb.ApplicationDecisionAccept, app.Decision)
	assert.True(t, app.ReleasedAt.Valid, "released_at must be set")

	lineup, err := q.GetUnassignedAcceptedArtists(context.Background(), festUUID)
	require.NoError(t, err)
	require.Len(t, lineup, 1, "released accept becomes a lineup member")
}

func TestReleaseDecisions_NothingToRelease_409(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupReviewScenario(t, db)
	srv := buildReleaseTestServer(t, db)
	_ = doRequest(t, srv, "PATCH", "/festivals/"+sc.festID+"/applications/"+sc.applicationID,
		`{"shortlisted":false,"review_flag":false,"decision":"decline"}`, sc.orgToken).Body.Close()
	first := doRequest(t, srv, "POST", "/festivals/"+sc.festID+"/applications/release-decisions", "", sc.orgToken)
	require.Equal(t, http.StatusOK, first.StatusCode)
	_ = first.Body.Close()
	second := doRequest(t, srv, "POST", "/festivals/"+sc.festID+"/applications/release-decisions", "", sc.orgToken)
	require.Equal(t, http.StatusConflict, second.StatusCode)
	_ = second.Body.Close()
}

func buildReleaseTestServer(t *testing.T, db *pgxpool.Pool) *httptest.Server {
	t.Helper()
	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	// literal route BEFORE parameterised — chi matches top-to-bottom
	r.Post("/festivals/{festivalID}/applications/release-decisions",
		festival.ReleaseDecisionsHandler(db, auth.NoopMailer{}))
	r.Patch("/festivals/{festivalID}/applications/{applicationID}",
		festival.PatchApplicationHandler(db))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return srv
}
