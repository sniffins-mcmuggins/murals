package festival_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/festival"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

type mapEditorScenario struct {
	orgToken        string
	orgID           string
	festID          string
	artistProfileID string
}

func setupMapEditorScenario(t *testing.T, db *pgxpool.Pool) mapEditorScenario {
	t.Helper()
	orgID, orgToken := createTestUser(t, db, "medorg@example.com")
	festID := createTestFestival(t, db, orgID, "med-festival", "open")

	artistUserID, _ := createTestUser(t, db, "medartist@example.com")
	artistProfileID := createTestArtistProfile(t, db, artistUserID, "Map Editor Artist")

	// Accept the artist into the festival
	q := sqlcdb.New(db)
	_, err := q.AddFestivalArtist(context.Background(), sqlcdb.AddFestivalArtistParams{
		FestivalID: pgUUID(t, festID),
		ArtistID:   pgUUID(t, artistProfileID),
		Status:     sqlcdb.FestivalArtistStatusAccepted,
	})
	require.NoError(t, err, "add festival artist")

	return mapEditorScenario{
		orgToken:        orgToken,
		orgID:           orgID,
		festID:          festID,
		artistProfileID: artistProfileID,
	}
}

func newMapEditorServer(db *pgxpool.Pool) *httptest.Server {
	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Get("/festivals/{festivalID}/artists/accepted", festival.GetAcceptedArtistsHandler(db))
	r.Patch("/festivals/{festivalID}/artists/{artistID}/pin", festival.SetArtistPinHandler(db))
	return httptest.NewServer(r)
}

// ---- GetAcceptedArtists tests ----

func TestGetAcceptedArtists_ReturnsAcceptedArtists(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupMapEditorScenario(t, db)
	srv := newMapEditorServer(db)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "GET", "/festivals/"+sc.festID+"/artists/accepted", "", sc.orgToken)
	require.Equal(t, http.StatusOK, resp.StatusCode)

	var list []map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&list))
	_ = resp.Body.Close()

	require.Len(t, list, 1)
	assert.Equal(t, sc.artistProfileID, list[0]["artist_id"])
	assert.Equal(t, "Map Editor Artist", list[0]["name"])
	assert.Nil(t, list[0]["pin_lat"], "pin_lat should be null for unpinned artist")
	assert.Nil(t, list[0]["pin_lng"], "pin_lng should be null for unpinned artist")
}

func TestGetAcceptedArtists_ExcludesNonAccepted(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupMapEditorScenario(t, db)

	// Add a second artist with submitted (not accepted) status
	artist2UserID, _ := createTestUser(t, db, "medartist2@example.com")
	artist2ProfileID := createTestArtistProfile(t, db, artist2UserID, "Submitted Artist")
	q := sqlcdb.New(db)
	_, err := q.AddFestivalArtist(context.Background(), sqlcdb.AddFestivalArtistParams{
		FestivalID: pgUUID(t, sc.festID),
		ArtistID:   pgUUID(t, artist2ProfileID),
		Status:     sqlcdb.FestivalArtistStatusDeclined,
	})
	require.NoError(t, err)

	srv := newMapEditorServer(db)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "GET", "/festivals/"+sc.festID+"/artists/accepted", "", sc.orgToken)
	require.Equal(t, http.StatusOK, resp.StatusCode)

	var list []map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&list))
	_ = resp.Body.Close()

	require.Len(t, list, 1, "only accepted artists should be returned")
	assert.Equal(t, sc.artistProfileID, list[0]["artist_id"])
}

func TestGetAcceptedArtists_RequiresAuth(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupMapEditorScenario(t, db)
	srv := newMapEditorServer(db)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "GET", "/festivals/"+sc.festID+"/artists/accepted", "", "")
	require.Equal(t, http.StatusUnauthorized, resp.StatusCode)
	_ = resp.Body.Close()
}

func TestGetAcceptedArtists_ForbiddenForNonOwner(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupMapEditorScenario(t, db)
	_, otherToken := createTestUser(t, db, "medother@example.com")

	srv := newMapEditorServer(db)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "GET", "/festivals/"+sc.festID+"/artists/accepted", "", otherToken)
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	_ = resp.Body.Close()
}

// ---- SetArtistPin tests ----

func TestSetArtistPin_SetsPinLatLng(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupMapEditorScenario(t, db)
	srv := newMapEditorServer(db)
	t.Cleanup(srv.Close)

	body := `{"lat":51.900740,"lng":-2.074060,"w3w":"filled.count.soap"}`
	resp := doRequest(t, srv, "PATCH",
		"/festivals/"+sc.festID+"/artists/"+sc.artistProfileID+"/pin",
		body, sc.orgToken)
	require.Equal(t, http.StatusOK, resp.StatusCode)

	var result map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&result))
	_ = resp.Body.Close()

	assert.Equal(t, sc.artistProfileID, result["artist_id"])
	assert.Equal(t, "Map Editor Artist", result["name"])
	assert.NotNil(t, result["pin_lat"])
	assert.NotNil(t, result["pin_lng"])
	assert.Equal(t, "filled.count.soap", result["w3w"])
}

func TestSetArtistPin_RequiresAuth(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupMapEditorScenario(t, db)
	srv := newMapEditorServer(db)
	t.Cleanup(srv.Close)

	body := `{"lat":51.9,"lng":-2.07}`
	resp := doRequest(t, srv, "PATCH",
		"/festivals/"+sc.festID+"/artists/"+sc.artistProfileID+"/pin",
		body, "")
	require.Equal(t, http.StatusUnauthorized, resp.StatusCode)
	_ = resp.Body.Close()
}

func TestSetArtistPin_ForbiddenForNonOwner(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupMapEditorScenario(t, db)
	_, otherToken := createTestUser(t, db, "medpinother@example.com")

	srv := newMapEditorServer(db)
	t.Cleanup(srv.Close)

	body := `{"lat":51.9,"lng":-2.07}`
	resp := doRequest(t, srv, "PATCH",
		"/festivals/"+sc.festID+"/artists/"+sc.artistProfileID+"/pin",
		body, otherToken)
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	_ = resp.Body.Close()
}

func TestSetArtistPin_NotFoundForNonExistentArtist(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupMapEditorScenario(t, db)
	srv := newMapEditorServer(db)
	t.Cleanup(srv.Close)

	nonExistentArtistID := "00000000-0000-0000-0000-000000000099"
	body := `{"lat":51.9,"lng":-2.07}`
	resp := doRequest(t, srv, "PATCH",
		"/festivals/"+sc.festID+"/artists/"+nonExistentArtistID+"/pin",
		body, sc.orgToken)
	require.Equal(t, http.StatusNotFound, resp.StatusCode)
	_ = resp.Body.Close()
}

func TestSetArtistPin_NotFoundForDeclinedArtist(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupMapEditorScenario(t, db)

	// Add a declined artist to the festival
	declinedUserID, _ := createTestUser(t, db, "meddeclined@example.com")
	declinedProfileID := createTestArtistProfile(t, db, declinedUserID, "Declined Artist")
	q := sqlcdb.New(db)
	_, err := q.AddFestivalArtist(context.Background(), sqlcdb.AddFestivalArtistParams{
		FestivalID: pgUUID(t, sc.festID),
		ArtistID:   pgUUID(t, declinedProfileID),
		Status:     sqlcdb.FestivalArtistStatusDeclined,
	})
	require.NoError(t, err)

	srv := newMapEditorServer(db)
	t.Cleanup(srv.Close)

	// Attempting to set a pin for a declined artist should return 404 without writing to DB
	body := `{"lat":51.9,"lng":-2.07}`
	resp := doRequest(t, srv, "PATCH",
		"/festivals/"+sc.festID+"/artists/"+declinedProfileID+"/pin",
		body, sc.orgToken)
	require.Equal(t, http.StatusNotFound, resp.StatusCode)
	_ = resp.Body.Close()
}

func TestSetArtistPin_RejectsOutOfRangeCoordinates(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupMapEditorScenario(t, db)
	srv := newMapEditorServer(db)
	t.Cleanup(srv.Close)

	cases := []struct {
		body string
		name string
	}{
		{`{"lat":91,"lng":0}`, "lat > 90"},
		{`{"lat":-91,"lng":0}`, "lat < -90"},
		{`{"lat":0,"lng":181}`, "lng > 180"},
		{`{"lat":0,"lng":-181}`, "lng < -180"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			resp := doRequest(t, srv, "PATCH",
				"/festivals/"+sc.festID+"/artists/"+sc.artistProfileID+"/pin",
				tc.body, sc.orgToken)
			require.Equal(t, http.StatusBadRequest, resp.StatusCode)
			_ = resp.Body.Close()
		})
	}
}
