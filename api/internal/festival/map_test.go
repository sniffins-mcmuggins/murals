package festival_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/festival"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

func TestGetMapData_LiveFestivalReturnsPins(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	orgID, _ := createTestUser(t, db, "maporg@example.com")
	festID := createTestFestival(t, db, orgID, "map-fest-live", "live")

	// Create artist and accept them
	artistUserID, _ := createTestUser(t, db, "mapartist@example.com")
	artistProfileID := createTestArtistProfile(t, db, artistUserID, "Map Artist")

	q := sqlcdb.New(db)

	// Accept the artist into the festival
	_, err := q.AddFestivalArtist(context.Background(), sqlcdb.AddFestivalArtistParams{
		FestivalID: pgUUID(t, festID),
		ArtistID:   pgUUID(t, artistProfileID),
		Status:     sqlcdb.FestivalArtistStatusAccepted,
	})
	require.NoError(t, err, "add festival artist")

	// Create a spot with lat/lng
	lat := pgtype.Numeric{}
	require.NoError(t, lat.Scan("51.900740"))
	lng := pgtype.Numeric{}
	require.NoError(t, lng.Scan("-2.074060"))
	w3w := "filled.count.soap"
	spot, err := q.CreateFestivalSpot(context.Background(), sqlcdb.CreateFestivalSpotParams{
		FestivalID: pgUUID(t, festID),
		Lat:        lat,
		Lng:        lng,
		W3w:        &w3w,
	})
	require.NoError(t, err, "create festival spot")

	// Assign the accepted artist to the spot
	_, err = q.SetFestivalSpotArtist(context.Background(), sqlcdb.SetFestivalSpotArtistParams{
		ID:         spot.ID,
		FestivalID: pgUUID(t, festID),
		ArtistID:   pgUUID(t, artistProfileID),
	})
	require.NoError(t, err, "set festival spot artist")

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Get("/festivals/slug/{slug}/map", festival.GetMapDataHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "GET", "/festivals/slug/map-fest-live/map", "", "")
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var body map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	_ = resp.Body.Close()

	pins, ok := body["pins"].([]any)
	require.True(t, ok, "pins field missing or wrong type")
	require.Len(t, pins, 1)
	pin := pins[0].(map[string]any)
	assert.Equal(t, artistProfileID, pin["artist_id"])
	assert.Equal(t, "Map Artist", pin["name"])
}

func TestGetMapData_NonLiveFestivalReturns404(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	orgID, _ := createTestUser(t, db, "maporg2@example.com")
	createTestFestival(t, db, orgID, "map-fest-draft", "draft")

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Get("/festivals/slug/{slug}/map", festival.GetMapDataHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "GET", "/festivals/slug/map-fest-draft/map", "", "")
	require.Equal(t, http.StatusNotFound, resp.StatusCode, "expected 404 for non-live festival")
	_ = resp.Body.Close()
}
