package festival_test

import (
	"context"
	"encoding/json"
	"fmt"
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

type reviewScenario struct {
	orgToken      string
	festID        string
	applicationID string
}

func setupReviewScenario(t *testing.T, db *pgxpool.Pool) reviewScenario {
	t.Helper()
	orgID, orgToken, _ := createTestUser(t, db)
	festID, _ := createTestFestival(t, db, orgID, "open")
	createTestApplicationFormWithFields(t, db, festID, `[]`)

	artistID, _, _ := createTestUser(t, db)
	createTestArtistProfile(t, db, artistID, "Review Artist")

	// Insert application directly via sqlc
	q := sqlcdb.New(db)
	form, err := q.GetApplicationFormByFestivalID(context.Background(), pgUUID(t, festID))
	require.NoError(t, err, "get form")
	artistProfile, err := q.GetArtistProfileByUserID(context.Background(), pgUUID(t, artistID))
	require.NoError(t, err, "get profile")
	app, err := q.CreateApplication(context.Background(), sqlcdb.CreateApplicationParams{
		FormID:   form.ID,
		ArtistID: artistProfile.ID,
		Answers:  []byte(`{}`),
	})
	require.NoError(t, err, "create application")

	return reviewScenario{
		orgToken:      orgToken,
		festID:        festID,
		applicationID: app.ID.String(),
	}
}

func TestListApplications(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupReviewScenario(t, db)

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Get("/festivals/{festivalID}/applications", festival.ListApplicationsHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "GET", "/festivals/"+sc.festID+"/applications", "", sc.orgToken)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var list []map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&list))
	_ = resp.Body.Close()
	require.Len(t, list, 1)

	app := list[0]
	assert.Equal(t, sc.applicationID, app["id"])
	// Artist summary is present
	artist, ok := app["artist"].(map[string]any)
	require.True(t, ok, "artist field missing or wrong type")
	assert.Equal(t, "Review Artist", artist["display_name"])
	// Notes array is present and empty initially
	notes, ok := app["notes"].([]any)
	require.True(t, ok, "notes field missing or wrong type")
	assert.Empty(t, notes)
	// New fields present
	assert.Equal(t, false, app["shortlisted"])
	assert.Equal(t, false, app["review_flag"])
}

func TestAcceptApplication(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupReviewScenario(t, db)

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Post("/festivals/{festivalID}/applications/{applicationID}/accept", festival.AcceptApplicationHandler(db, auth.NoopMailer{}))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "POST", "/festivals/"+sc.festID+"/applications/"+sc.applicationID+"/accept", "", sc.orgToken)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var app map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&app))
	_ = resp.Body.Close()
	assert.Equal(t, "accepted", app["status"])
}

func TestDeclineApplication(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupReviewScenario(t, db)

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Post("/festivals/{festivalID}/applications/{applicationID}/decline", festival.DeclineApplicationHandler(db, auth.NoopMailer{}))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "POST", "/festivals/"+sc.festID+"/applications/"+sc.applicationID+"/decline", "", sc.orgToken)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var app map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&app))
	_ = resp.Body.Close()
	assert.Equal(t, "declined", app["status"])
}

func TestReview_ForbiddenForNonOwner(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupReviewScenario(t, db)
	_, otherToken, _ := createTestUser(t, db)

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Get("/festivals/{festivalID}/applications", festival.ListApplicationsHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "GET", "/festivals/"+sc.festID+"/applications", "", otherToken)
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	_ = resp.Body.Close()
}

func newReviewListServer(db *pgxpool.Pool) *httptest.Server {
	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Get("/festivals/{festivalID}/applications", festival.ListApplicationsHandler(db))
	r.Put("/festivals/{festivalID}/applications/{applicationID}/score", festival.ScoreApplicationHandler(db))
	return httptest.NewServer(r)
}

func TestListApplications_AnonymousReview_StripsIdentityForUnscored(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)

	ownerID, _, _ := createTestUser(t, db)
	revID, revTok, _ := createTestUser(t, db)
	artistID, _, _ := createTestUser(t, db)
	createTestArtistProfile(t, db, artistID, "Real Name")

	festID, _ := createTestFestival(t, db, ownerID, "open")
	createTestApplicationFormWithFields(t, db, festID, `[]`)
	setFormAnonymousReview(t, db, festID, true)
	createTestApplicationInFestival(t, db, festID, artistID)
	addReviewer(t, db, festID, revID)

	srv := newReviewListServer(db)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "GET", "/festivals/"+festID+"/applications", "", revTok)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var list []map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&list))
	_ = resp.Body.Close()
	require.Len(t, list, 1)

	app := list[0]
	assert.Equal(t, true, app["identity_hidden"], "identity_hidden must be true before scoring")
	artist := app["artist"].(map[string]any)
	assert.Equal(t, "", artist["display_name"], "display_name must be empty string")
	assert.Nil(t, artist["avatar_s3_key"], "avatar_s3_key must be nil")
	assert.Nil(t, artist["location_label"], "location_label must be nil")
}

func TestListApplications_AnonymousReview_RevealsAfterScore(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)

	ownerID, _, _ := createTestUser(t, db)
	revID, revTok, _ := createTestUser(t, db)
	artistID, _, _ := createTestUser(t, db)
	createTestArtistProfile(t, db, artistID, "Real Name 2")

	festID, _ := createTestFestival(t, db, ownerID, "open")
	createTestApplicationFormWithFields(t, db, festID, `[]`)
	setFormAnonymousReview(t, db, festID, true)
	appID := createTestApplicationInFestival(t, db, festID, artistID)
	addReviewer(t, db, festID, revID)

	srv := newReviewListServer(db)
	t.Cleanup(srv.Close)

	// Score the application
	scoreResp := doRequest(t, srv, "PUT", "/festivals/"+festID+"/applications/"+appID+"/score", `{"score":3}`, revTok)
	require.Equal(t, http.StatusOK, scoreResp.StatusCode)
	_ = scoreResp.Body.Close()

	// Now list — identity must be revealed
	resp := doRequest(t, srv, "GET", "/festivals/"+festID+"/applications", "", revTok)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var list []map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&list))
	_ = resp.Body.Close()
	require.Len(t, list, 1)

	app := list[0]
	assert.Equal(t, false, app["identity_hidden"], "identity_hidden must be false after scoring")
	artist := app["artist"].(map[string]any)
	assert.Equal(t, "Real Name 2", artist["display_name"], "real name must be visible after scoring")
}

func TestListApplications_AnonymousReview_OwnerAlwaysSeesFull(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)

	ownerID, ownerTok, _ := createTestUser(t, db)
	artistID, _, _ := createTestUser(t, db)
	createTestArtistProfile(t, db, artistID, "Real Name 3")

	festID, _ := createTestFestival(t, db, ownerID, "open")
	createTestApplicationFormWithFields(t, db, festID, `[]`)
	setFormAnonymousReview(t, db, festID, true)
	createTestApplicationInFestival(t, db, festID, artistID)

	srv := newReviewListServer(db)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "GET", "/festivals/"+festID+"/applications", "", ownerTok)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var list []map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&list))
	_ = resp.Body.Close()
	require.Len(t, list, 1)

	app := list[0]
	assert.Equal(t, false, app["identity_hidden"], "owner must never see identity_hidden=true")
	artist := app["artist"].(map[string]any)
	assert.Equal(t, "Real Name 3", artist["display_name"], "owner always sees real name")
}

func TestListApplications_AnonymousReview_OffShowsFullIdentity(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)

	ownerID, _, _ := createTestUser(t, db)
	revID, revTok, _ := createTestUser(t, db)
	artistID, _, _ := createTestUser(t, db)
	createTestArtistProfile(t, db, artistID, "Real Name 4")

	festID, _ := createTestFestival(t, db, ownerID, "open")
	createTestApplicationFormWithFields(t, db, festID, `[]`)
	// anonymous_review is false by default — do NOT call setFormAnonymousReview
	createTestApplicationInFestival(t, db, festID, artistID)
	addReviewer(t, db, festID, revID)

	srv := newReviewListServer(db)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "GET", "/festivals/"+festID+"/applications", "", revTok)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var list []map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&list))
	_ = resp.Body.Close()
	require.Len(t, list, 1)

	app := list[0]
	assert.Equal(t, false, app["identity_hidden"], "identity_hidden must be false when anonymous_review is off")
	artist := app["artist"].(map[string]any)
	assert.Equal(t, "Real Name 4", artist["display_name"], "full name visible when anonymous_review is off")
}

// setCriteria patches review_criteria directly via DB (sqlc), bypassing the HTTP handler.
func setCriteria(t *testing.T, pool *pgxpool.Pool, festivalID string, criteriaJSON string) {
	t.Helper()
	_, err := sqlcdb.New(pool).PatchFormCriteria(context.Background(), sqlcdb.PatchFormCriteriaParams{
		FestivalID:     pgUUID(t, festivalID),
		ReviewCriteria: []byte(criteriaJSON),
	})
	require.NoError(t, err)
}

// scoreWithCriterion submits a score for a named criterion via the HTTP server.
func scoreWithCriterion(t *testing.T, srv *httptest.Server, festID, appID, criterionID string, score int, token string) {
	t.Helper()
	body := fmt.Sprintf(`{"score":%d,"criterion_id":%q}`, score, criterionID)
	resp := doRequest(t, srv, "PUT", "/festivals/"+festID+"/applications/"+appID+"/score", body, token)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	_ = resp.Body.Close()
}

func TestListApplications_CriterionScores_PopulatedAfterScoring(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)

	ownerID, ownerTok, _ := createTestUser(t, db)
	revID, revTok, _ := createTestUser(t, db)
	artistID, _, _ := createTestUser(t, db)
	createTestArtistProfile(t, db, artistID, "CS Artist 1")

	festID, _ := createTestFestival(t, db, ownerID, "open")
	createTestApplicationFormWithFields(t, db, festID, `[]`)
	setCriteria(t, db, festID, `[{"id":"art","label":"Artistic Quality","min":1,"max":5},{"id":"feas","label":"Feasibility","min":1,"max":5}]`)
	appID := createTestApplicationInFestival(t, db, festID, artistID)
	addReviewer(t, db, festID, revID)

	srv := newReviewListServer(db)
	t.Cleanup(srv.Close)

	scoreWithCriterion(t, srv, festID, appID, "art", 4, revTok)
	scoreWithCriterion(t, srv, festID, appID, "feas", 2, revTok)

	// Owner view: sees criterion_scores with avg_score populated.
	ownerResp := doRequest(t, srv, "GET", "/festivals/"+festID+"/applications", "", ownerTok)
	require.Equal(t, http.StatusOK, ownerResp.StatusCode)
	var ownerList []map[string]any
	require.NoError(t, json.NewDecoder(ownerResp.Body).Decode(&ownerList))
	_ = ownerResp.Body.Close()
	require.Len(t, ownerList, 1)

	app := ownerList[0]
	csRaw, ok := app["criterion_scores"].([]any)
	require.True(t, ok, "criterion_scores must be an array")
	require.Len(t, csRaw, 2)

	csMap := map[string]map[string]any{}
	for _, raw := range csRaw {
		cs := raw.(map[string]any)
		csMap[cs["criterion_id"].(string)] = cs
	}
	assert.InDelta(t, 4.0, csMap["art"]["avg_score"], 0.001, "art avg must be non-zero (sqlc canary)")
	assert.InDelta(t, 2.0, csMap["feas"]["avg_score"], 0.001, "feas avg must be non-zero (sqlc canary)")
	assert.Equal(t, "Artistic Quality", csMap["art"]["label"])

	// Reviewer view: my_score at top level = mean of criteria scores = (4+2)/2 = 3, rounded.
	revResp := doRequest(t, srv, "GET", "/festivals/"+festID+"/applications", "", revTok)
	require.Equal(t, http.StatusOK, revResp.StatusCode)
	var revList []map[string]any
	require.NoError(t, json.NewDecoder(revResp.Body).Decode(&revList))
	_ = revResp.Body.Close()
	require.Len(t, revList, 1)
	assert.Equal(t, float64(3), revList[0]["my_score"], "my_score must be mean of criteria scores")
}

func TestListApplications_CriterionScores_EmptyWhenNoCriteria(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)

	ownerID, ownerTok, _ := createTestUser(t, db)
	artistID, _, _ := createTestUser(t, db)
	createTestArtistProfile(t, db, artistID, "CS Artist 2")

	festID, _ := createTestFestival(t, db, ownerID, "open")
	createTestApplicationFormWithFields(t, db, festID, `[]`)
	createTestApplicationInFestival(t, db, festID, artistID)

	srv := newReviewListServer(db)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "GET", "/festivals/"+festID+"/applications", "", ownerTok)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var list []map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&list))
	_ = resp.Body.Close()
	require.Len(t, list, 1)

	csRaw := list[0]["criterion_scores"].([]any)
	assert.Empty(t, csRaw, "criterion_scores must be empty when no criteria configured")
}

func TestListApplications_TopLevelAvg_IsMeanOfCriterionAverages(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)

	ownerID, ownerTok, _ := createTestUser(t, db)
	rev1ID, rev1Tok, _ := createTestUser(t, db)
	rev2ID, rev2Tok, _ := createTestUser(t, db)
	artistID, _, _ := createTestUser(t, db)
	createTestArtistProfile(t, db, artistID, "CS Artist Avg")

	festID, _ := createTestFestival(t, db, ownerID, "open")
	createTestApplicationFormWithFields(t, db, festID, `[]`)
	setCriteria(t, db, festID, `[{"id":"art","label":"Artistic","min":1,"max":5},{"id":"feas","label":"Feasibility","min":1,"max":5}]`)
	appID := createTestApplicationInFestival(t, db, festID, artistID)
	addReviewer(t, db, festID, rev1ID)
	addReviewer(t, db, festID, rev2ID)

	srv := newReviewListServer(db)
	t.Cleanup(srv.Close)

	// rev1 scores art=4 and feas=4. rev2 scores art=2 only.
	// Per-criterion avgs: art=(4+2)/2=3.0, feas=4.0. Mean of criterion avgs = (3.0+4.0)/2 = 3.5.
	// A raw AVG over all 3 rows would be (4+4+2)/3 = 3.33 — so the assertion distinguishes the two.
	scoreWithCriterion(t, srv, festID, appID, "art", 4, rev1Tok)
	scoreWithCriterion(t, srv, festID, appID, "feas", 4, rev1Tok)
	scoreWithCriterion(t, srv, festID, appID, "art", 2, rev2Tok)

	resp := doRequest(t, srv, "GET", "/festivals/"+festID+"/applications", "", ownerTok)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var list []map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&list))
	_ = resp.Body.Close()
	require.Len(t, list, 1)

	assert.InDelta(t, 3.5, list[0]["avg_score"], 0.001, "top-level avg must be mean of per-criterion averages, not raw row average")
}

func TestListApplications_OrphanedCriterionScores_Omitted(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)

	ownerID, ownerTok, _ := createTestUser(t, db)
	revID, revTok, _ := createTestUser(t, db)
	artistID, _, _ := createTestUser(t, db)
	createTestArtistProfile(t, db, artistID, "CS Artist 3")

	festID, _ := createTestFestival(t, db, ownerID, "open")
	createTestApplicationFormWithFields(t, db, festID, `[]`)
	setCriteria(t, db, festID, `[{"id":"temp","label":"Temp","min":1,"max":5}]`)
	appID := createTestApplicationInFestival(t, db, festID, artistID)
	addReviewer(t, db, festID, revID)

	srv := newReviewListServer(db)
	t.Cleanup(srv.Close)

	scoreWithCriterion(t, srv, festID, appID, "temp", 3, revTok)
	setCriteria(t, db, festID, `[]`)

	resp := doRequest(t, srv, "GET", "/festivals/"+festID+"/applications", "", ownerTok)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var list []map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&list))
	_ = resp.Body.Close()
	assert.Empty(t, list[0]["criterion_scores"].([]any))
}
