package festival_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

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
	orgID, orgToken := createTestUser(t, db, "revorg@example.com", "organiser")
	festID := createTestFestival(t, db, orgID, "review-fest", "open")
	createTestApplicationFormWithFields(t, db, festID, `[]`)

	artistID, _ := createTestUser(t, db, "revartist@example.com", "artist")
	createTestArtistProfile(t, db, artistID, "Review Artist")

	// Insert application directly via sqlc
	q := sqlcdb.New(db)
	form, err := q.GetApplicationFormByFestivalID(context.Background(), pgUUID(t, festID))
	if err != nil {
		t.Fatalf("get form: %v", err)
	}
	artistProfile, err := q.GetArtistProfileByUserID(context.Background(), pgUUID(t, artistID))
	if err != nil {
		t.Fatalf("get profile: %v", err)
	}
	app, err := q.CreateApplication(context.Background(), sqlcdb.CreateApplicationParams{
		FormID:   form.ID,
		ArtistID: artistProfile.ID,
		Answers:  []byte(`{}`),
	})
	if err != nil {
		t.Fatalf("create application: %v", err)
	}

	return reviewScenario{
		orgToken:      orgToken,
		festID:        festID,
		applicationID: app.ID.String(),
	}
}

func TestListApplications(t *testing.T) {
	db := testutil.NewDB(t)
	sc := setupReviewScenario(t, db)

	r := chi.NewRouter()
	r.Use(auth.Middleware(testSecret))
	r.Get("/festivals/{festivalID}/applications", festival.ListApplicationsHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "GET", "/festivals/"+sc.festID+"/applications", "", sc.orgToken)
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("expected 200, got %d: %s", resp.StatusCode, b)
	}
	var list []map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&list)
	_ = resp.Body.Close()
	if len(list) != 1 {
		t.Errorf("expected 1 application, got %d", len(list))
	}
}

func TestAcceptApplication(t *testing.T) {
	db := testutil.NewDB(t)
	sc := setupReviewScenario(t, db)

	r := chi.NewRouter()
	r.Use(auth.Middleware(testSecret))
	r.Post("/festivals/{festivalID}/applications/{applicationID}/accept", festival.AcceptApplicationHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "POST", "/festivals/"+sc.festID+"/applications/"+sc.applicationID+"/accept", "", sc.orgToken)
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("expected 200, got %d: %s", resp.StatusCode, b)
	}
	var app map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&app)
	_ = resp.Body.Close()
	if app["status"] != "accepted" {
		t.Errorf("expected status accepted, got %v", app["status"])
	}
}

func TestDeclineApplication(t *testing.T) {
	db := testutil.NewDB(t)
	sc := setupReviewScenario(t, db)

	r := chi.NewRouter()
	r.Use(auth.Middleware(testSecret))
	r.Post("/festivals/{festivalID}/applications/{applicationID}/decline", festival.DeclineApplicationHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "POST", "/festivals/"+sc.festID+"/applications/"+sc.applicationID+"/decline", "", sc.orgToken)
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("expected 200, got %d: %s", resp.StatusCode, b)
	}
	var app map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&app)
	_ = resp.Body.Close()
	if app["status"] != "declined" {
		t.Errorf("expected status declined, got %v", app["status"])
	}
}

func TestReview_ForbiddenForNonOwner(t *testing.T) {
	db := testutil.NewDB(t)
	sc := setupReviewScenario(t, db)
	_, otherToken := createTestUser(t, db, "revother@example.com", "organiser")

	r := chi.NewRouter()
	r.Use(auth.Middleware(testSecret))
	r.Get("/festivals/{festivalID}/applications", festival.ListApplicationsHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "GET", "/festivals/"+sc.festID+"/applications", "", otherToken)
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", resp.StatusCode)
	}
	_ = resp.Body.Close()
}
