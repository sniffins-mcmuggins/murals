package festival_test

import (
	"encoding/json"
	"io"
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

func TestSubmitApplication_Success(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	orgID, _, _ := createTestUser(t, db)
	festID, _ := createTestFestival(t, db, orgID, "open")
	createTestApplicationFormWithFields(t, db, festID,
		`[{"id":"q1","label":"Why?","type":"long_text","required":true}]`)

	artistID, artistToken, _ := createTestUser(t, db)
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
	orgID, _, _ := createTestUser(t, db)
	festID, _ := createTestFestival(t, db, orgID, "open")
	createTestApplicationFormWithFields(t, db, festID,
		`[{"id":"q1","label":"Why?","type":"long_text","required":true}]`)

	artistID, artistToken, _ := createTestUser(t, db)
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
	orgID, _, _ := createTestUser(t, db)
	festID, _ := createTestFestival(t, db, orgID, "open")
	createTestApplicationFormWithFields(t, db, festID, `[]`)

	artistID, artistToken, _ := createTestUser(t, db)
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

// A user without an artist profile attempting to apply gets 409 profile_required.
// Previously this would have been gated on the user's role; now it's profile-gated.
func TestSubmitApplication_NoArtistProfile_Returns409(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	orgID, _, _ := createTestUser(t, db)
	festID, _ := createTestFestival(t, db, orgID, "open")
	createTestApplicationFormWithFields(t, db, festID, `[]`)

	// User created, but NO artist profile.
	_, userToken, _ := createTestUser(t, db)

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Post("/festivals/{festivalID}/apply", festival.SubmitApplicationHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "POST", "/festivals/"+festID+"/apply",
		`{"answers":{}}`, userToken)
	require.Equal(t, http.StatusConflict, resp.StatusCode)

	body, err := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	require.NoError(t, err)

	var payload map[string]string
	require.NoError(t, json.Unmarshal(body, &payload))
	assert.Equal(t, "profile_required", payload["error"])
	assert.Equal(t, "create an artist profile to apply", payload["message"])
}
