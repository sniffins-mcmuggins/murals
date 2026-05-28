package festival_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
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
