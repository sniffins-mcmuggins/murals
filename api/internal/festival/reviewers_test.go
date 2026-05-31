package festival_test

import (
	"fmt"
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
	ownerID, ownerTok, _ := createTestUser(t, db)
	_, _, existingEmail := createTestUser(t, db)
	festID, _ := createTestFestival(t, db, ownerID, "open")
	srv := newReviewerServer(db)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "POST", "/festivals/"+festID+"/reviewers",
		fmt.Sprintf(`{"email":%q}`, existingEmail), ownerTok)
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	_ = resp.Body.Close()
}

func TestInviteReviewer_NonOwnerForbidden(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	ownerID, _, _ := createTestUser(t, db)
	_, strangerTok, _ := createTestUser(t, db)
	festID, _ := createTestFestival(t, db, ownerID, "open")
	srv := newReviewerServer(db)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "POST", "/festivals/"+festID+"/reviewers", `{"email":"x@test"}`, strangerTok)
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	_ = resp.Body.Close()
}

func TestInviteReviewer_RequiresAuth(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	ownerID, _, _ := createTestUser(t, db)
	festID, _ := createTestFestival(t, db, ownerID, "open")
	srv := newReviewerServer(db)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "POST", "/festivals/"+festID+"/reviewers", `{"email":"x@test"}`, "")
	require.Equal(t, http.StatusUnauthorized, resp.StatusCode)
	_ = resp.Body.Close()
}

func TestInviteReviewer_OwnerAddsNewEmail(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	ownerID, ownerTok, _ := createTestUser(t, db)
	festID, _ := createTestFestival(t, db, ownerID, "open")
	srv := newReviewerServer(db)
	t.Cleanup(srv.Close)

	// brand-new email — no pre-existing user row
	resp := doRequest(t, srv, "POST", "/festivals/"+festID+"/reviewers", `{"email":"brand-new-4@test"}`, ownerTok)
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	_ = resp.Body.Close()
}
