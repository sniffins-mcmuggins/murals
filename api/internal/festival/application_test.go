package festival_test

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/festival"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

func TestSubmitApplication_Success(t *testing.T) {
	db := testutil.NewDB(t)
	orgID, _ := createTestUser(t, db, "applyorg@example.com", "organiser")
	festID := createTestFestival(t, db, orgID, "apply-fest", "open")
	createTestApplicationFormWithFields(t, db, festID,
		`[{"id":"q1","label":"Why?","type":"long_text","required":true}]`)

	artistID, artistToken := createTestUser(t, db, "applyartist@example.com", "artist")
	createTestArtistProfile(t, db, artistID, "Apply Artist")

	r := chi.NewRouter()
	r.Use(auth.Middleware(testSecret))
	r.Post("/festivals/{festivalID}/apply", festival.SubmitApplicationHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "POST", "/festivals/"+festID+"/apply",
		`{"answers":{"q1":"I love murals"}}`, artistToken)
	if resp.StatusCode != http.StatusCreated {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("expected 201, got %d: %s", resp.StatusCode, b)
	}
	resp.Body.Close()
}

func TestSubmitApplication_MissingRequiredField(t *testing.T) {
	db := testutil.NewDB(t)
	orgID, _ := createTestUser(t, db, "applyorg2@example.com", "organiser")
	festID := createTestFestival(t, db, orgID, "apply-fest2", "open")
	createTestApplicationFormWithFields(t, db, festID,
		`[{"id":"q1","label":"Why?","type":"long_text","required":true}]`)

	artistID, artistToken := createTestUser(t, db, "applyartist2@example.com", "artist")
	createTestArtistProfile(t, db, artistID, "Apply Artist 2")

	r := chi.NewRouter()
	r.Use(auth.Middleware(testSecret))
	r.Post("/festivals/{festivalID}/apply", festival.SubmitApplicationHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	// Empty answers — required field q1 missing
	resp := doRequest(t, srv, "POST", "/festivals/"+festID+"/apply",
		`{"answers":{}}`, artistToken)
	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422, got %d", resp.StatusCode)
	}
	resp.Body.Close()
}

func TestSubmitApplication_DuplicateReturns409(t *testing.T) {
	db := testutil.NewDB(t)
	orgID, _ := createTestUser(t, db, "applyorg3@example.com", "organiser")
	festID := createTestFestival(t, db, orgID, "apply-fest3", "open")
	createTestApplicationFormWithFields(t, db, festID, `[]`)

	artistID, artistToken := createTestUser(t, db, "applyartist3@example.com", "artist")
	createTestArtistProfile(t, db, artistID, "Apply Artist 3")

	r := chi.NewRouter()
	r.Use(auth.Middleware(testSecret))
	r.Post("/festivals/{festivalID}/apply", festival.SubmitApplicationHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "POST", "/festivals/"+festID+"/apply", `{"answers":{}}`, artistToken)
	if resp.StatusCode != http.StatusCreated {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("first apply: expected 201, got %d: %s", resp.StatusCode, b)
	}
	resp.Body.Close()

	resp2 := doRequest(t, srv, "POST", "/festivals/"+festID+"/apply", `{"answers":{}}`, artistToken)
	if resp2.StatusCode != http.StatusConflict {
		t.Fatalf("second apply: expected 409, got %d", resp2.StatusCode)
	}
	resp2.Body.Close()
}

func TestSubmitApplication_RequiresArtistRole(t *testing.T) {
	db := testutil.NewDB(t)
	orgID, orgToken := createTestUser(t, db, "applyorg4@example.com", "organiser")
	festID := createTestFestival(t, db, orgID, "apply-fest4", "open")
	createTestApplicationFormWithFields(t, db, festID, `[]`)

	r := chi.NewRouter()
	r.Use(auth.Middleware(testSecret))
	r.Post("/festivals/{festivalID}/apply", festival.SubmitApplicationHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "POST", "/festivals/"+festID+"/apply", `{"answers":{}}`, orgToken)
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 for organiser, got %d", resp.StatusCode)
	}
	resp.Body.Close()
}
