package festival_test

import (
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
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

func newScoreServer(db *pgxpool.Pool) *httptest.Server {
	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Put("/festivals/{festivalID}/applications/{applicationID}/score", festival.ScoreApplicationHandler(db))
	return httptest.NewServer(r)
}

func TestScore_ReviewerScoresApplication(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	ownerID, _, _ := createTestUser(t, db)
	revID, revTok, _ := createTestUser(t, db)
	artistID, _, _ := createTestUser(t, db)
	createTestArtistProfile(t, db, artistID, "Score Artist 1")
	festID, _ := createTestFestival(t, db, ownerID, "open")
	createTestApplicationForm(t, db, festID)
	appID := createTestApplicationInFestival(t, db, festID, artistID)
	addReviewer(t, db, festID, revID)
	srv := newScoreServer(db)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "PUT", "/festivals/"+festID+"/applications/"+appID+"/score", `{"score":4}`, revTok)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	_ = resp.Body.Close()
}

func TestScore_RejectsOutOfRange(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	ownerID, ownerTok, _ := createTestUser(t, db)
	artistID, _, _ := createTestUser(t, db)
	createTestArtistProfile(t, db, artistID, "Score Artist 2")
	festID, _ := createTestFestival(t, db, ownerID, "open")
	createTestApplicationForm(t, db, festID)
	appID := createTestApplicationInFestival(t, db, festID, artistID)
	srv := newScoreServer(db)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "PUT", "/festivals/"+festID+"/applications/"+appID+"/score", `{"score":9}`, ownerTok)
	require.Equal(t, http.StatusUnprocessableEntity, resp.StatusCode)
	_ = resp.Body.Close()
}

func TestScore_ReviewerCannotScoreOwnApplication(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	ownerID, _, _ := createTestUser(t, db)
	revID, revTok, _ := createTestUser(t, db)
	createTestArtistProfile(t, db, revID, "Reviewer Who Applied")
	festID, _ := createTestFestival(t, db, ownerID, "open")
	createTestApplicationForm(t, db, festID)
	ownAppID := createTestApplicationInFestival(t, db, festID, revID)
	addReviewer(t, db, festID, revID)
	srv := newScoreServer(db)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "PUT", "/festivals/"+festID+"/applications/"+ownAppID+"/score", `{"score":5}`, revTok)
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	_ = resp.Body.Close()
}

func TestScore_ReviewerCanScoreDifferentApplication(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	ownerID, _, _ := createTestUser(t, db)
	revID, revTok, _ := createTestUser(t, db)
	createTestArtistProfile(t, db, revID, "Reviewer With Profile")
	artistID, _, _ := createTestUser(t, db)
	createTestArtistProfile(t, db, artistID, "Other Artist")
	festID, _ := createTestFestival(t, db, ownerID, "open")
	createTestApplicationForm(t, db, festID)
	// reviewer also has an application (their own)
	createTestApplicationInFestival(t, db, festID, revID)
	// but we're scoring the OTHER artist's application
	otherAppID := createTestApplicationInFestival(t, db, festID, artistID)
	addReviewer(t, db, festID, revID)
	srv := newScoreServer(db)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "PUT", "/festivals/"+festID+"/applications/"+otherAppID+"/score", `{"score":3}`, revTok)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	_ = resp.Body.Close()
}

func TestScore_WithCriterionID_StoresNamedCriterion(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	ownerID, ownerTok, _ := createTestUser(t, db)
	artistID, _, _ := createTestUser(t, db)
	createTestArtistProfile(t, db, artistID, "Rub Artist 1")
	festID, _ := createTestFestival(t, db, ownerID, "open")
	createTestApplicationForm(t, db, festID)
	appID := createTestApplicationInFestival(t, db, festID, artistID)
	// Configure a criterion so the named score validates.
	setCriteriaViaPatch(t, db, festID, ownerTok, `[{"label":"Artistic Quality","min":1,"max":5}]`)
	srv := newScoreServer(db)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "PUT", "/festivals/"+festID+"/applications/"+appID+"/score",
		`{"score":3,"criterion_id":"artistic-quality"}`, ownerTok)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var body map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	_ = resp.Body.Close()
	assert.Equal(t, "artistic-quality", body["criterion_id"])
	assert.Equal(t, float64(3), body["score"])
}

func TestScore_NoCriterionDefaultsToOverall(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	ownerID, ownerTok, _ := createTestUser(t, db)
	artistID, _, _ := createTestUser(t, db)
	createTestArtistProfile(t, db, artistID, "Rub Artist 2")
	festID, _ := createTestFestival(t, db, ownerID, "open")
	createTestApplicationForm(t, db, festID)
	appID := createTestApplicationInFestival(t, db, festID, artistID)
	srv := newScoreServer(db)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "PUT", "/festivals/"+festID+"/applications/"+appID+"/score",
		`{"score":4}`, ownerTok)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var body map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	_ = resp.Body.Close()
	assert.Equal(t, "overall", body["criterion_id"])
}

func TestScore_UnknownCriterion_Rejected(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	ownerID, ownerTok, _ := createTestUser(t, db)
	artistID, _, _ := createTestUser(t, db)
	createTestArtistProfile(t, db, artistID, "Rub Artist 3")
	festID, _ := createTestFestival(t, db, ownerID, "open")
	createTestApplicationForm(t, db, festID)
	appID := createTestApplicationInFestival(t, db, festID, artistID)
	srv := newScoreServer(db)
	t.Cleanup(srv.Close)

	// criterion_id that is not 'overall' and not in the (empty) form criteria → 422
	resp := doRequest(t, srv, "PUT", "/festivals/"+festID+"/applications/"+appID+"/score",
		`{"score":3,"criterion_id":"does-not-exist"}`, ownerTok)
	require.Equal(t, http.StatusUnprocessableEntity, resp.StatusCode)
	_ = resp.Body.Close()
}

func TestScore_NamedCriterion_NoForm_Returns422(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	ownerID, ownerTok, _ := createTestUser(t, db)
	artistID, _, _ := createTestUser(t, db)
	createTestArtistProfile(t, db, artistID, "Rub Artist NoForm")
	festID, _ := createTestFestival(t, db, ownerID, "open")
	createTestApplicationForm(t, db, festID)
	appID := createTestApplicationInFestival(t, db, festID, artistID)
	srv := newScoreServer(db)
	t.Cleanup(srv.Close)

	// Named criterion when form doesn't exist → 422, not 500
	resp := doRequest(t, srv, "PUT", "/festivals/"+festID+"/applications/"+appID+"/score",
		`{"score":3,"criterion_id":"some-criterion"}`, ownerTok)
	require.Equal(t, http.StatusUnprocessableEntity, resp.StatusCode)
	_ = resp.Body.Close()
}

func setCriteriaViaPatch(t *testing.T, db *pgxpool.Pool, festID, ownerTok, criteriaJSON string) {
	t.Helper()
	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Patch("/festivals/{festivalID}/form", festival.PatchFormHandler(db))
	srv := httptest.NewServer(r)
	defer srv.Close()
	body := `{"review_criteria":` + criteriaJSON + `}`
	resp := doRequest(t, srv, "PATCH", "/festivals/"+festID+"/form", body, ownerTok)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	_ = resp.Body.Close()
}
