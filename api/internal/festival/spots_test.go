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

type spotsScenario struct {
	orgToken        string
	orgID           string
	festID          string
	artistProfileID string
}

func setupSpotsScenario(t *testing.T, db *pgxpool.Pool) spotsScenario {
	t.Helper()
	orgID, orgToken := createTestUser(t, db, "spotorg@example.com")
	festID := createTestFestival(t, db, orgID, "spot-festival", "open")
	artistUserID, _ := createTestUser(t, db, "spotartist@example.com")
	artistProfileID := createTestArtistProfile(t, db, artistUserID, "Spot Artist")
	q := sqlcdb.New(db)
	_, err := q.AddFestivalArtist(context.Background(), sqlcdb.AddFestivalArtistParams{
		FestivalID: pgUUID(t, festID),
		ArtistID:   pgUUID(t, artistProfileID),
		Status:     sqlcdb.FestivalArtistStatusAccepted,
	})
	require.NoError(t, err)
	return spotsScenario{orgToken: orgToken, orgID: orgID, festID: festID, artistProfileID: artistProfileID}
}

func newSpotsServer(db *pgxpool.Pool) *httptest.Server {
	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Get("/festivals/{festivalID}/spots", festival.GetSpotsHandler(db))
	r.Post("/festivals/{festivalID}/spots", festival.CreateSpotHandler(db))
	r.Patch("/festivals/{festivalID}/spots/{spotID}", festival.UpdateSpotHandler(db))
	r.Delete("/festivals/{festivalID}/spots/{spotID}", festival.DeleteSpotHandler(db))
	r.Put("/festivals/{festivalID}/spots/{spotID}/artist", festival.SetSpotArtistHandler(db))
	r.Delete("/festivals/{festivalID}/spots/{spotID}/artist", festival.ClearSpotArtistHandler(db))
	return httptest.NewServer(r)
}

// ─── GetSpots ────────────────────────────────────────────────────────────────

func TestGetSpots_EmptyInitially(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupSpotsScenario(t, db)
	srv := newSpotsServer(db)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "GET", "/festivals/"+sc.festID+"/spots", "", sc.orgToken)
	require.Equal(t, http.StatusOK, resp.StatusCode)

	var body map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	_ = resp.Body.Close()

	assert.Empty(t, body["spots"])
	unassigned := body["unassigned_artists"].([]any)
	assert.Len(t, unassigned, 1, "accepted artist should appear as unassigned")
}

func TestGetSpots_RequiresAuth(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupSpotsScenario(t, db)
	srv := newSpotsServer(db)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "GET", "/festivals/"+sc.festID+"/spots", "", "")
	require.Equal(t, http.StatusUnauthorized, resp.StatusCode)
	_ = resp.Body.Close()
}

func TestGetSpots_ForbiddenForNonOwner(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupSpotsScenario(t, db)
	_, other := createTestUser(t, db, "spotsother@example.com")
	srv := newSpotsServer(db)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "GET", "/festivals/"+sc.festID+"/spots", "", other)
	require.Equal(t, http.StatusForbidden, resp.StatusCode)
	_ = resp.Body.Close()
}

// ─── CreateSpot ──────────────────────────────────────────────────────────────

func TestCreateSpot_CreatesNumberedSpot(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupSpotsScenario(t, db)
	srv := newSpotsServer(db)
	t.Cleanup(srv.Close)

	body := `{"lat":51.9007,"lng":-2.0783,"w3w":"filled.count.soap"}`
	resp := doRequest(t, srv, "POST", "/festivals/"+sc.festID+"/spots", body, sc.orgToken)
	require.Equal(t, http.StatusCreated, resp.StatusCode)

	var result map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&result))
	_ = resp.Body.Close()

	assert.Equal(t, float64(1), result["number"])
	assert.NotNil(t, result["id"])
	assert.InDelta(t, 51.9007, result["lat"], 0.0001)
	assert.Nil(t, result["artist_id"])
}

func TestCreateSpot_AutoIncrementsNumber(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupSpotsScenario(t, db)
	srv := newSpotsServer(db)
	t.Cleanup(srv.Close)

	r1 := doRequest(t, srv, "POST", "/festivals/"+sc.festID+"/spots",
		`{"lat":51.9,"lng":-2.07}`, sc.orgToken)
	_ = r1.Body.Close()
	resp2 := doRequest(t, srv, "POST", "/festivals/"+sc.festID+"/spots",
		`{"lat":51.91,"lng":-2.08}`, sc.orgToken)
	require.Equal(t, http.StatusCreated, resp2.StatusCode)

	var result map[string]any
	require.NoError(t, json.NewDecoder(resp2.Body).Decode(&result))
	_ = resp2.Body.Close()

	assert.Equal(t, float64(2), result["number"])
}

func TestCreateSpot_RejectsOutOfRangeCoordinates(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupSpotsScenario(t, db)
	srv := newSpotsServer(db)
	t.Cleanup(srv.Close)

	cases := []struct{ body, name string }{
		{`{"lat":91,"lng":0}`, "lat > 90"},
		{`{"lat":-91,"lng":0}`, "lat < -90"},
		{`{"lat":0,"lng":181}`, "lng > 180"},
		{`{"lat":0,"lng":-181}`, "lng < -180"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			resp := doRequest(t, srv, "POST", "/festivals/"+sc.festID+"/spots", tc.body, sc.orgToken)
			require.Equal(t, http.StatusBadRequest, resp.StatusCode)
			_ = resp.Body.Close()
		})
	}
}

// ─── UpdateSpot ──────────────────────────────────────────────────────────────

func TestUpdateSpot_UpdatesDetails(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupSpotsScenario(t, db)
	srv := newSpotsServer(db)
	t.Cleanup(srv.Close)

	createResp := doRequest(t, srv, "POST", "/festivals/"+sc.festID+"/spots",
		`{"lat":51.9,"lng":-2.07}`, sc.orgToken)
	require.Equal(t, http.StatusCreated, createResp.StatusCode)
	var created map[string]any
	require.NoError(t, json.NewDecoder(createResp.Body).Decode(&created))
	_ = createResp.Body.Close()
	spotID := created["id"].(string)

	updateBody := `{"lat":51.901,"lng":-2.071,"notes":"needs cherry picker","width_m":8,"height_m":6}`
	resp := doRequest(t, srv, "PATCH", "/festivals/"+sc.festID+"/spots/"+spotID, updateBody, sc.orgToken)
	require.Equal(t, http.StatusOK, resp.StatusCode)

	var result map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&result))
	_ = resp.Body.Close()

	assert.Equal(t, "needs cherry picker", result["notes"])
	assert.Equal(t, float64(8), result["width_m"])
}

// ─── DeleteSpot ──────────────────────────────────────────────────────────────

func TestDeleteSpot_Returns204(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupSpotsScenario(t, db)
	srv := newSpotsServer(db)
	t.Cleanup(srv.Close)

	createResp := doRequest(t, srv, "POST", "/festivals/"+sc.festID+"/spots",
		`{"lat":51.9,"lng":-2.07}`, sc.orgToken)
	var created map[string]any
	require.NoError(t, json.NewDecoder(createResp.Body).Decode(&created))
	_ = createResp.Body.Close()
	spotID := created["id"].(string)

	resp := doRequest(t, srv, "DELETE", "/festivals/"+sc.festID+"/spots/"+spotID, "", sc.orgToken)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	_ = resp.Body.Close()
}

// ─── SetSpotArtist ───────────────────────────────────────────────────────────

func TestSetSpotArtist_AssignsArtist(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupSpotsScenario(t, db)
	srv := newSpotsServer(db)
	t.Cleanup(srv.Close)

	createResp := doRequest(t, srv, "POST", "/festivals/"+sc.festID+"/spots",
		`{"lat":51.9,"lng":-2.07}`, sc.orgToken)
	var created map[string]any
	require.NoError(t, json.NewDecoder(createResp.Body).Decode(&created))
	_ = createResp.Body.Close()
	spotID := created["id"].(string)

	assignBody := `{"artist_id":"` + sc.artistProfileID + `"}`
	resp := doRequest(t, srv, "PUT", "/festivals/"+sc.festID+"/spots/"+spotID+"/artist", assignBody, sc.orgToken)
	require.Equal(t, http.StatusOK, resp.StatusCode)

	var result map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&result))
	_ = resp.Body.Close()

	assert.Equal(t, sc.artistProfileID, result["artist_id"])
	assert.Equal(t, "Spot Artist", result["artist_name"])
}

func TestSetSpotArtist_ConflictWhenAlreadyAssigned(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupSpotsScenario(t, db)
	srv := newSpotsServer(db)
	t.Cleanup(srv.Close)

	createSpot := func(lat string) string {
		r := doRequest(t, srv, "POST", "/festivals/"+sc.festID+"/spots",
			`{"lat":`+lat+`,"lng":-2.07}`, sc.orgToken)
		var m map[string]any
		require.NoError(t, json.NewDecoder(r.Body).Decode(&m))
		_ = r.Body.Close()
		return m["id"].(string)
	}
	spot1ID := createSpot("51.9")
	spot2ID := createSpot("51.91")

	body := `{"artist_id":"` + sc.artistProfileID + `"}`
	r1 := doRequest(t, srv, "PUT", "/festivals/"+sc.festID+"/spots/"+spot1ID+"/artist", body, sc.orgToken)
	_ = r1.Body.Close()

	resp := doRequest(t, srv, "PUT", "/festivals/"+sc.festID+"/spots/"+spot2ID+"/artist", body, sc.orgToken)
	require.Equal(t, http.StatusConflict, resp.StatusCode)
	_ = resp.Body.Close()
}

func TestSetSpotArtist_422ForNonAcceptedArtist(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupSpotsScenario(t, db)

	otherUserID, _ := createTestUser(t, db, "spotuninvited@example.com")
	otherProfileID := createTestArtistProfile(t, db, otherUserID, "Uninvited Artist")

	srv := newSpotsServer(db)
	t.Cleanup(srv.Close)

	createResp := doRequest(t, srv, "POST", "/festivals/"+sc.festID+"/spots",
		`{"lat":51.9,"lng":-2.07}`, sc.orgToken)
	var created map[string]any
	require.NoError(t, json.NewDecoder(createResp.Body).Decode(&created))
	_ = createResp.Body.Close()
	spotID := created["id"].(string)

	body := `{"artist_id":"` + otherProfileID + `"}`
	resp := doRequest(t, srv, "PUT", "/festivals/"+sc.festID+"/spots/"+spotID+"/artist", body, sc.orgToken)
	require.Equal(t, http.StatusUnprocessableEntity, resp.StatusCode)
	_ = resp.Body.Close()
}

// ─── ClearSpotArtist ─────────────────────────────────────────────────────────

func TestClearSpotArtist_UnassignsArtist(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := setupSpotsScenario(t, db)
	srv := newSpotsServer(db)
	t.Cleanup(srv.Close)

	createResp := doRequest(t, srv, "POST", "/festivals/"+sc.festID+"/spots",
		`{"lat":51.9,"lng":-2.07}`, sc.orgToken)
	var created map[string]any
	require.NoError(t, json.NewDecoder(createResp.Body).Decode(&created))
	_ = createResp.Body.Close()
	spotID := created["id"].(string)

	r1 := doRequest(t, srv, "PUT", "/festivals/"+sc.festID+"/spots/"+spotID+"/artist",
		`{"artist_id":"`+sc.artistProfileID+`"}`, sc.orgToken)
	_ = r1.Body.Close()

	resp := doRequest(t, srv, "DELETE", "/festivals/"+sc.festID+"/spots/"+spotID+"/artist", "", sc.orgToken)
	require.Equal(t, http.StatusOK, resp.StatusCode)

	var result map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&result))
	_ = resp.Body.Close()

	assert.Nil(t, result["artist_id"])
	assert.Nil(t, result["artist_name"])
}
