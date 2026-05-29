package festival_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/festival"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

func newScoreServer(db *pgxpool.Pool) *httptest.Server {
	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Put("/festivals/{festivalID}/applications/{applicationID}/score", festival.ScoreApplicationHandler(db))
	return httptest.NewServer(r)
}

func addReviewer(t *testing.T, db *pgxpool.Pool, festID, userID string) {
	t.Helper()
	_, err := sqlcdb.New(db).AddFestivalReviewer(context.Background(), sqlcdb.AddFestivalReviewerParams{
		FestivalID: pgUUID(t, festID), UserID: pgUUID(t, userID),
	})
	require.NoError(t, err)
}

func TestScore_ReviewerScoresApplication(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	ownerID, _ := createTestUser(t, db, "score-owner-1@test")
	revID, revTok := createTestUser(t, db, "score-rev-1@test")
	artistID, _ := createTestUser(t, db, "score-art-1@test")
	createTestArtistProfile(t, db, artistID, "Score Artist 1")
	festID := createTestFestival(t, db, ownerID, "score-fest-1", "open")
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
	ownerID, ownerTok := createTestUser(t, db, "score-owner-2@test")
	artistID, _ := createTestUser(t, db, "score-art-2@test")
	createTestArtistProfile(t, db, artistID, "Score Artist 2")
	festID := createTestFestival(t, db, ownerID, "score-fest-2", "open")
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
	ownerID, _ := createTestUser(t, db, "score-owner-3@test")
	revID, revTok := createTestUser(t, db, "score-rev-3@test")
	createTestArtistProfile(t, db, revID, "Reviewer Who Applied")
	festID := createTestFestival(t, db, ownerID, "score-fest-3", "open")
	createTestApplicationForm(t, db, festID)
	ownAppID := createTestApplicationInFestival(t, db, festID, revID)
	addReviewer(t, db, festID, revID)
	srv := newScoreServer(db)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "PUT", "/festivals/"+festID+"/applications/"+ownAppID+"/score", `{"score":5}`, revTok)
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	_ = resp.Body.Close()
}
