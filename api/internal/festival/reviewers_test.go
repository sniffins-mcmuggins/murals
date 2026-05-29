package festival_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/festival"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

func newReviewerServer(db *pgxpool.Pool) *httptest.Server {
	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Post("/festivals/{festivalID}/reviewers", festival.InviteReviewerHandler(db, auth.NoopMailer{}, "http://web"))
	r.Get("/festivals/{festivalID}/reviewers", festival.ListReviewersHandler(db))
	r.Delete("/festivals/{festivalID}/reviewers/{userID}", festival.RemoveReviewerHandler(db))
	return httptest.NewServer(r)
}

func TestInviteReviewer_OwnerAddsExistingUser(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	ownerID, ownerTok := createTestUser(t, db, "rev-owner-1@test")
	_, _ = createTestUser(t, db, "rev-existing-1@test")
	festID := createTestFestival(t, db, ownerID, "rev-fest-1", "open")
	srv := newReviewerServer(db)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "POST", "/festivals/"+festID+"/reviewers", `{"email":"rev-existing-1@test"}`, ownerTok)
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	_ = resp.Body.Close()
}

func TestInviteReviewer_NonOwnerForbidden(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	ownerID, _ := createTestUser(t, db, "rev-owner-2@test")
	_, strangerTok := createTestUser(t, db, "rev-stranger-2@test")
	festID := createTestFestival(t, db, ownerID, "rev-fest-2", "open")
	srv := newReviewerServer(db)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "POST", "/festivals/"+festID+"/reviewers", `{"email":"x@test"}`, strangerTok)
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	_ = resp.Body.Close()
}

func TestInviteReviewer_RequiresAuth(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	ownerID, _ := createTestUser(t, db, "rev-owner-3@test")
	festID := createTestFestival(t, db, ownerID, "rev-fest-3", "open")
	srv := newReviewerServer(db)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "POST", "/festivals/"+festID+"/reviewers", `{"email":"x@test"}`, "")
	require.Equal(t, http.StatusUnauthorized, resp.StatusCode)
	_ = resp.Body.Close()
}

func TestInviteReviewer_OwnerAddsNewEmail(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	ownerID, ownerTok := createTestUser(t, db, "rev-owner-4@test")
	festID := createTestFestival(t, db, ownerID, "rev-fest-4", "open")
	srv := newReviewerServer(db)
	t.Cleanup(srv.Close)

	// brand-new email — no pre-existing user row
	resp := doRequest(t, srv, "POST", "/festivals/"+festID+"/reviewers", `{"email":"brand-new-4@test"}`, ownerTok)
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	_ = resp.Body.Close()
}
