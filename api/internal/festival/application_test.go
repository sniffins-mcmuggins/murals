package festival_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/require"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/festival"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

func TestSubmitApplication_Success(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	orgID, _ := createTestUser(t, db, "applyorg@example.com", "organiser")
	festID := createTestFestival(t, db, orgID, "apply-fest", "open")
	createTestApplicationFormWithFields(t, db, festID,
		`[{"id":"q1","label":"Why?","type":"long_text","required":true}]`)

	artistID, artistToken := createTestUser(t, db, "applyartist@example.com", "artist")
	createTestArtistProfile(t, db, artistID, "Apply Artist")

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Post("/festivals/{festivalID}/apply", festival.SubmitApplicationHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "POST", "/festivals/"+festID+"/apply",
		`{"answers":{"q1":"I love murals"}}`, artistToken)
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	_ = resp.Body.Close()
}

func TestSubmitApplication_MissingRequiredField(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	orgID, _ := createTestUser(t, db, "applyorg2@example.com", "organiser")
	festID := createTestFestival(t, db, orgID, "apply-fest2", "open")
	createTestApplicationFormWithFields(t, db, festID,
		`[{"id":"q1","label":"Why?","type":"long_text","required":true}]`)

	artistID, artistToken := createTestUser(t, db, "applyartist2@example.com", "artist")
	createTestArtistProfile(t, db, artistID, "Apply Artist 2")

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Post("/festivals/{festivalID}/apply", festival.SubmitApplicationHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	// Empty answers — required field q1 missing
	resp := doRequest(t, srv, "POST", "/festivals/"+festID+"/apply",
		`{"answers":{}}`, artistToken)
	require.Equal(t, http.StatusUnprocessableEntity, resp.StatusCode)
	_ = resp.Body.Close()
}

func TestSubmitApplication_DuplicateReturns409(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	orgID, _ := createTestUser(t, db, "applyorg3@example.com", "organiser")
	festID := createTestFestival(t, db, orgID, "apply-fest3", "open")
	createTestApplicationFormWithFields(t, db, festID, `[]`)

	artistID, artistToken := createTestUser(t, db, "applyartist3@example.com", "artist")
	createTestArtistProfile(t, db, artistID, "Apply Artist 3")

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Post("/festivals/{festivalID}/apply", festival.SubmitApplicationHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "POST", "/festivals/"+festID+"/apply", `{"answers":{}}`, artistToken)
	require.Equal(t, http.StatusCreated, resp.StatusCode, "first apply")
	_ = resp.Body.Close()

	resp2 := doRequest(t, srv, "POST", "/festivals/"+festID+"/apply", `{"answers":{}}`, artistToken)
	require.Equal(t, http.StatusConflict, resp2.StatusCode, "second apply")
	_ = resp2.Body.Close()
}

func TestSubmitApplication_RequiresArtistRole(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	orgID, orgToken := createTestUser(t, db, "applyorg4@example.com", "organiser")
	festID := createTestFestival(t, db, orgID, "apply-fest4", "open")
	createTestApplicationFormWithFields(t, db, festID, `[]`)

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Post("/festivals/{festivalID}/apply", festival.SubmitApplicationHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "POST", "/festivals/"+festID+"/apply", `{"answers":{}}`, orgToken)
	require.Equal(t, http.StatusForbidden, resp.StatusCode, "expected 403 for organiser")
	_ = resp.Body.Close()
}
