package festival_test

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/festival"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

func TestUpsertForm_CreatesAndUpdates(t *testing.T) {
	db := testutil.NewDB(t)
	orgID, orgToken := createTestUser(t, db, "formorg@example.com", "organiser")
	festID := createTestFestival(t, db, orgID, "form-test-fest", "draft")

	r := chi.NewRouter()
	r.Use(auth.Middleware(testSecret))
	r.Put("/festivals/{festivalID}/form", festival.UpsertFormHandler(db))
	r.Get("/festivals/{festivalID}/form", festival.GetFormHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	// Create
	body := `{"fields":[{"id":"q1","label":"Why do you want to paint?","type":"long_text","required":true}]}`
	resp := doRequest(t, srv, "PUT", "/festivals/"+festID+"/form", body, orgToken)
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("expected 200, got %d: %s", resp.StatusCode, b)
	}
	var form map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&form)
	_ = resp.Body.Close()
	fields := form["fields"].([]any)
	if len(fields) != 1 {
		t.Errorf("expected 1 field, got %d", len(fields))
	}

	// Update — replace fields wholesale
	body2 := `{"fields":[{"id":"q1","label":"Why?","type":"long_text","required":true},{"id":"q2","label":"Portfolio URL","type":"url","required":false}]}`
	resp2 := doRequest(t, srv, "PUT", "/festivals/"+festID+"/form", body2, orgToken)
	if resp2.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp2.Body)
		t.Fatalf("expected 200 on update, got %d: %s", resp2.StatusCode, b)
	}
	var form2 map[string]any
	_ = json.NewDecoder(resp2.Body).Decode(&form2)
	_ = resp2.Body.Close()
	if len(form2["fields"].([]any)) != 2 {
		t.Errorf("expected 2 fields after update, got %d", len(form2["fields"].([]any)))
	}
}

func TestUpsertForm_OnlyOrganiserOwnerCanUpsert(t *testing.T) {
	db := testutil.NewDB(t)
	orgID, _ := createTestUser(t, db, "formorg2@example.com", "organiser")
	_, otherToken := createTestUser(t, db, "formorg3@example.com", "organiser")
	festID := createTestFestival(t, db, orgID, "form-test-fest2", "draft")

	r := chi.NewRouter()
	r.Use(auth.Middleware(testSecret))
	r.Put("/festivals/{festivalID}/form", festival.UpsertFormHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "PUT", "/festivals/"+festID+"/form", `{"fields":[]}`, otherToken)
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", resp.StatusCode)
	}
	_ = resp.Body.Close()
}

func TestGetForm_Public(t *testing.T) {
	db := testutil.NewDB(t)
	orgID, _ := createTestUser(t, db, "formorg4@example.com", "organiser")
	festID := createTestFestival(t, db, orgID, "form-test-fest3", "draft")
	createTestApplicationForm(t, db, festID)

	r := chi.NewRouter()
	r.Use(auth.Middleware(testSecret))
	r.Get("/festivals/{festivalID}/form", festival.GetFormHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "GET", "/festivals/"+festID+"/form", "", "")
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("expected 200, got %d: %s", resp.StatusCode, b)
	}
	_ = resp.Body.Close()
}

func TestGetForm_NotFound(t *testing.T) {
	db := testutil.NewDB(t)
	orgID, _ := createTestUser(t, db, "formorg5@example.com", "organiser")
	festID := createTestFestival(t, db, orgID, "form-no-form", "draft")

	r := chi.NewRouter()
	r.Use(auth.Middleware(testSecret))
	r.Get("/festivals/{festivalID}/form", festival.GetFormHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "GET", "/festivals/"+festID+"/form", "", "")
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", resp.StatusCode)
	}
	_ = resp.Body.Close()
}
