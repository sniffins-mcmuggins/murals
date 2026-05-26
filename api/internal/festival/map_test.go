package festival_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/festival"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

func TestGetMapData_LiveFestivalReturnsPins(t *testing.T) {
	db := testutil.NewDB(t)
	orgID, _ := createTestUser(t, db, "maporg@example.com", "organiser")
	festID := createTestFestival(t, db, orgID, "map-fest-live", "live")

	// Create artist and accept them with a pin
	artistUserID, _ := createTestUser(t, db, "mapartist@example.com", "artist")
	artistProfileID := createTestArtistProfile(t, db, artistUserID, "Map Artist")

	q := sqlcdb.New(db)

	// First add the artist with accepted status
	_, err := q.AddFestivalArtist(context.Background(), sqlcdb.AddFestivalArtistParams{
		FestivalID: pgUUID(t, festID),
		ArtistID:   pgUUID(t, artistProfileID),
		Status:     sqlcdb.FestivalArtistStatusAccepted,
	})
	if err != nil {
		t.Fatalf("add festival artist: %v", err)
	}

	// Then set the pin
	lat := pgtype.Numeric{}
	_ = lat.Scan("51.900740")
	lng := pgtype.Numeric{}
	_ = lng.Scan("-2.074060")
	w3w := "filled.count.soap"
	_, err = q.SetFestivalArtistPin(context.Background(), sqlcdb.SetFestivalArtistPinParams{
		FestivalID: pgUUID(t, festID),
		ArtistID:   pgUUID(t, artistProfileID),
		PinLat:     lat,
		PinLng:     lng,
		W3w:        &w3w,
	})
	if err != nil {
		t.Fatalf("set festival artist pin: %v", err)
	}

	r := chi.NewRouter()
	r.Use(auth.Middleware(testSecret))
	r.Get("/festivals/slug/{slug}/map", festival.GetMapDataHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "GET", "/festivals/slug/map-fest-live/map", "", "")
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("expected 200, got %d: %s", resp.StatusCode, b)
	}
	var body map[string]any
	json.NewDecoder(resp.Body).Decode(&body)
	resp.Body.Close()

	pins, ok := body["pins"].([]any)
	if !ok || len(pins) != 1 {
		t.Fatalf("expected 1 pin, got %v", body["pins"])
	}
	pin := pins[0].(map[string]any)
	if pin["artist_id"] != artistProfileID {
		t.Errorf("expected artist_id %s, got %v", artistProfileID, pin["artist_id"])
	}
	if pin["name"] != "Map Artist" {
		t.Errorf("expected name 'Map Artist', got %v", pin["name"])
	}
}

func TestGetMapData_NonLiveFestivalReturns404(t *testing.T) {
	db := testutil.NewDB(t)
	orgID, _ := createTestUser(t, db, "maporg2@example.com", "organiser")
	createTestFestival(t, db, orgID, "map-fest-draft", "draft")

	r := chi.NewRouter()
	r.Use(auth.Middleware(testSecret))
	r.Get("/festivals/slug/{slug}/map", festival.GetMapDataHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "GET", "/festivals/slug/map-fest-draft/map", "", "")
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404 for non-live festival, got %d", resp.StatusCode)
	}
	resp.Body.Close()
}

func strPtr(s string) *string { return &s }
