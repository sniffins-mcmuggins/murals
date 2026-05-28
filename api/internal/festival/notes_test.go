package festival_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/festival"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

func TestAddApplicationNote(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupReviewScenario(t, db)

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Post("/festivals/{festivalID}/applications/{applicationID}/notes",
		festival.AddApplicationNoteHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	body := `{"content":"Strong portfolio, worth a call."}`
	resp := doRequest(t, srv, "POST",
		"/festivals/"+sc.festID+"/applications/"+sc.applicationID+"/notes",
		body, sc.orgToken)
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	var note map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&note))
	_ = resp.Body.Close()
	assert.Equal(t, "Strong portfolio, worth a call.", note["content"])
	assert.NotEmpty(t, note["id"])
}

func TestAddApplicationNote_EmptyContentRejected(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupReviewScenario(t, db)

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Post("/festivals/{festivalID}/applications/{applicationID}/notes",
		festival.AddApplicationNoteHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "POST",
		"/festivals/"+sc.festID+"/applications/"+sc.applicationID+"/notes",
		`{"content":""}`, sc.orgToken)
	require.Equal(t, http.StatusUnprocessableEntity, resp.StatusCode)
	_ = resp.Body.Close()
}

func TestAddApplicationNote_ForbiddenForNonOwner(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupReviewScenario(t, db)
	_, otherToken := createTestUser(t, db, "notesother@example.com")

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Post("/festivals/{festivalID}/applications/{applicationID}/notes",
		festival.AddApplicationNoteHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "POST",
		"/festivals/"+sc.festID+"/applications/"+sc.applicationID+"/notes",
		`{"content":"sneaky"}`, otherToken)
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	_ = resp.Body.Close()
}

func TestAddApplicationNote_CrossFestivalRejected(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)

	// sc holds a festival owned by sc.orgToken, with one application.
	sc := setupReviewScenario(t, db)

	// Create a second festival (with its own form) owned by a different organiser.
	orgID, orgToken := createTestUser(t, db, "notescrossorg@example.com")
	otherFestID := createTestFestival(t, db, orgID, "notes-other-fest", "open")
	// Give the second festival its own form so the mismatch check is exercised.
	createTestApplicationForm(t, db, otherFestID)

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Post("/festivals/{festivalID}/applications/{applicationID}/notes",
		festival.AddApplicationNoteHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	// Organiser of otherFest tries to post a note on sc's application via their own
	// festival URL — the application belongs to a different festival, so expect 404.
	resp := doRequest(t, srv, "POST",
		"/festivals/"+otherFestID+"/applications/"+sc.applicationID+"/notes",
		`{"content":"cross-festival sneaky note"}`, orgToken)
	require.Equal(t, http.StatusNotFound, resp.StatusCode)
	_ = resp.Body.Close()
}

func TestAddApplicationNote_ContentTooLong(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupReviewScenario(t, db)

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Post("/festivals/{festivalID}/applications/{applicationID}/notes",
		festival.AddApplicationNoteHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	longContent := strings.Repeat("a", 5001)
	resp := doRequest(t, srv, "POST",
		"/festivals/"+sc.festID+"/applications/"+sc.applicationID+"/notes",
		`{"content":"`+longContent+`"}`, sc.orgToken)
	require.Equal(t, http.StatusUnprocessableEntity, resp.StatusCode)
	_ = resp.Body.Close()
}
