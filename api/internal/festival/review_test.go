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

type reviewScenario struct {
	orgToken      string
	festID        string
	applicationID string
}

func setupReviewScenario(t *testing.T, db *pgxpool.Pool) reviewScenario {
	t.Helper()
	orgID, orgToken := createTestUser(t, db, "revorg@example.com")
	festID := createTestFestival(t, db, orgID, "review-fest", "open")
	createTestApplicationFormWithFields(t, db, festID, `[]`)

	artistID, _ := createTestUser(t, db, "revartist@example.com")
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
	_, otherToken := createTestUser(t, db, "revother@example.com")

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

	ownerID, _ := createTestUser(t, db, "anon-owner-1@test")
	revID, revTok := createTestUser(t, db, "anon-rev-1@test")
	artistID, _ := createTestUser(t, db, "anon-art-1@test")
	createTestArtistProfile(t, db, artistID, "Real Name")

	festID := createTestFestival(t, db, ownerID, "anon-fest-1", "open")
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

	ownerID, _ := createTestUser(t, db, "anon-owner-2@test")
	revID, revTok := createTestUser(t, db, "anon-rev-2@test")
	artistID, _ := createTestUser(t, db, "anon-art-2@test")
	createTestArtistProfile(t, db, artistID, "Real Name 2")

	festID := createTestFestival(t, db, ownerID, "anon-fest-2", "open")
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

	ownerID, ownerTok := createTestUser(t, db, "anon-owner-3@test")
	artistID, _ := createTestUser(t, db, "anon-art-3@test")
	createTestArtistProfile(t, db, artistID, "Real Name 3")

	festID := createTestFestival(t, db, ownerID, "anon-fest-3", "open")
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
