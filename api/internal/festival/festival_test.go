package festival_test

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/festival"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

func TestCreateFestival(t *testing.T) {
	db := testutil.NewDB(t)
	_, orgToken := createTestUser(t, db, "org@example.com", "organiser")

	r := chi.NewRouter()
	r.Use(auth.Middleware(testSecret))
	r.Post("/festivals", festival.CreateHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "POST", "/festivals",
		`{"name":"Summer Walls","slug":"summer-walls-2027","description":"Annual mural festival","locationLabel":"Bristol","startDate":"2027-06-01","endDate":"2027-06-07"}`,
		orgToken)
	if resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("expected 201, got %d: %s", resp.StatusCode, body)
	}
	resp.Body.Close()
}

func TestCreateFestival_RequiresOrganiser(t *testing.T) {
	db := testutil.NewDB(t)
	_, artistToken := createTestUser(t, db, "artist@example.com", "artist")

	r := chi.NewRouter()
	r.Use(auth.Middleware(testSecret))
	r.Post("/festivals", festival.CreateHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "POST", "/festivals",
		`{"name":"X","slug":"x","description":"","locationLabel":""}`,
		artistToken)
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", resp.StatusCode)
	}
	resp.Body.Close()
}

func TestGetFestival_PublicDraftReturns404(t *testing.T) {
	db := testutil.NewDB(t)
	orgID, orgToken := createTestUser(t, db, "org2@example.com", "organiser")
	festID := createTestFestival(t, db, orgID, "draft-fest", "draft")

	r := chi.NewRouter()
	r.Use(auth.Middleware(testSecret))
	r.Get("/festivals/{festivalID}", festival.GetHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	// Public request (no token) - draft → 404
	resp := doRequest(t, srv, "GET", "/festivals/"+festID, "", "")
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404 for draft festival (public), got %d", resp.StatusCode)
	}
	resp.Body.Close()

	// Organiser request with token - draft → 200
	resp = doRequest(t, srv, "GET", "/festivals/"+festID, "", orgToken)
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("expected 200 for draft festival (owner), got %d: %s", resp.StatusCode, body)
	}
	resp.Body.Close()
}

func TestUpdateFestival_OnlyOrganiserCanUpdate(t *testing.T) {
	db := testutil.NewDB(t)
	orgID, orgToken := createTestUser(t, db, "org3@example.com", "organiser")
	_, otherToken := createTestUser(t, db, "other@example.com", "organiser")
	festID := createTestFestival(t, db, orgID, "my-fest", "draft")

	r := chi.NewRouter()
	r.Use(auth.Middleware(testSecret))
	r.Patch("/festivals/{festivalID}", festival.UpdateHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	// Other organiser → 403
	resp := doRequest(t, srv, "PATCH", "/festivals/"+festID,
		`{"name":"Changed","slug":"changed","description":"","locationLabel":""}`, otherToken)
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", resp.StatusCode)
	}
	resp.Body.Close()

	// Correct organiser → 200
	resp = doRequest(t, srv, "PATCH", "/festivals/"+festID,
		`{"name":"Updated Name","slug":"my-fest","description":"Updated desc","locationLabel":"Bristol"}`, orgToken)
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("expected 200, got %d: %s", resp.StatusCode, body)
	}
	var body map[string]any
	json.NewDecoder(resp.Body).Decode(&body)
	resp.Body.Close()
	if body["name"] != "Updated Name" {
		t.Errorf("expected updated name, got %v", body["name"])
	}
}

func TestDeleteFestival_SoftDelete(t *testing.T) {
	db := testutil.NewDB(t)
	orgID, orgToken := createTestUser(t, db, "org4@example.com", "organiser")
	festID := createTestFestival(t, db, orgID, "to-delete", "draft")

	r := chi.NewRouter()
	r.Use(auth.Middleware(testSecret))
	r.Delete("/festivals/{festivalID}", festival.DeleteHandler(db))
	r.Get("/festivals/{festivalID}", festival.GetHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "DELETE", "/festivals/"+festID, "", orgToken)
	if resp.StatusCode != http.StatusNoContent {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("expected 204, got %d: %s", resp.StatusCode, body)
	}
	resp.Body.Close()

	// Verify gone
	resp = doRequest(t, srv, "GET", "/festivals/"+festID, "", orgToken)
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404 after delete, got %d", resp.StatusCode)
	}
	resp.Body.Close()
}

func TestListFestivals(t *testing.T) {
	db := testutil.NewDB(t)
	orgID, orgToken := createTestUser(t, db, "org5@example.com", "organiser")
	createTestFestival(t, db, orgID, "fest-a", "draft")
	createTestFestival(t, db, orgID, "fest-b", "draft")

	r := chi.NewRouter()
	r.Use(auth.Middleware(testSecret))
	r.Get("/festivals", festival.ListHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "GET", "/festivals", "", orgToken)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	var list []map[string]any
	json.NewDecoder(resp.Body).Decode(&list)
	resp.Body.Close()
	if len(list) != 2 {
		t.Errorf("expected 2 festivals, got %d", len(list))
	}
}

// doRequest is a helper used across test files in this package.
func doRequest(t *testing.T, srv *httptest.Server, method, path, body, token string) *http.Response {
	t.Helper()
	var reqBody io.Reader
	if body != "" {
		reqBody = strings.NewReader(body)
	}
	req, _ := http.NewRequestWithContext(t.Context(), method, srv.URL+path, reqBody)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	return resp
}
