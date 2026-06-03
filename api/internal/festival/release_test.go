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

func TestReleaseDecisions_BulkUpdatesStatusAndPreventsRerelease(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupReviewScenario(t, db)

	srv := buildReleaseTestServer(t, db)

	// Stage the application as accept via PATCH
	patchBody := `{"shortlisted":false,"review_flag":false,"staged_decision":"accept"}`
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

	// Second release attempt → 409
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

	// Do NOT stage the application — attempt release immediately
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

// Releasing an "accept" staged decision must turn the applicant into an accepted
// festival_artist — the same side effect AcceptApplicationHandler provides. Without
// it, artists accepted via the staged-decision flow never appear on the map editor's
// "unassigned accepted artists" picker (regression fixed in release.go).
func TestReleaseDecisions_AcceptedAppBecomesFestivalArtist(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupReviewScenario(t, db)
	srv := buildReleaseTestServer(t, db)

	q := sqlcdb.New(db)
	festUUID := pgUUID(t, sc.festID)

	// Precondition: the artist is only an applicant — no accepted festival_artists row.
	before, err := q.GetUnassignedAcceptedArtists(context.Background(), festUUID)
	require.NoError(t, err)
	require.Empty(t, before, "no festival_artists should exist before release")

	// Stage as accept, then release.
	patchResp := doRequest(t, srv, "PATCH",
		"/festivals/"+sc.festID+"/applications/"+sc.applicationID,
		`{"shortlisted":false,"review_flag":false,"staged_decision":"accept"}`, sc.orgToken)
	require.Equal(t, http.StatusOK, patchResp.StatusCode)
	_ = patchResp.Body.Close()

	resp := doRequest(t, srv, "POST",
		"/festivals/"+sc.festID+"/applications/release-decisions", "", sc.orgToken)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	_ = resp.Body.Close()

	// The accepted artist is now an assignable festival_artist (status=accepted).
	after, err := q.GetUnassignedAcceptedArtists(context.Background(), festUUID)
	require.NoError(t, err)
	require.Len(t, after, 1, "released accept must create an accepted festival_artists row")
	assert.Equal(t, "Review Artist", after[0].Name)
}

// Releasing a "decline" (or waitlist) decision must NOT create a festival_artists
// row — only accepts do, matching the direct decline/waitlist handlers.
func TestReleaseDecisions_DeclinedAppDoesNotBecomeFestivalArtist(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupReviewScenario(t, db)
	srv := buildReleaseTestServer(t, db)

	q := sqlcdb.New(db)
	festUUID := pgUUID(t, sc.festID)

	// Stage as decline, then release.
	patchResp := doRequest(t, srv, "PATCH",
		"/festivals/"+sc.festID+"/applications/"+sc.applicationID,
		`{"shortlisted":false,"review_flag":false,"staged_decision":"decline"}`, sc.orgToken)
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
