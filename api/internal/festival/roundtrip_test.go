package festival_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/festival"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

func TestFestivalDomainRoundTrip(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Post("/auth/signup", auth.SignupHandler(db))
	r.Post("/auth/login", auth.LoginHandler(db, testSecret))
	r.Get("/me", auth.MeHandler(db))

	// Festivals
	r.Post("/festivals", festival.CreateHandler(db))
	r.Get("/festivals", festival.ListHandler(db))
	r.Get("/festivals/{festivalID}", festival.GetHandler(db))
	r.Patch("/festivals/{festivalID}", festival.UpdateHandler(db))
	r.Delete("/festivals/{festivalID}", festival.DeleteHandler(db))

	// Application forms
	r.Put("/festivals/{festivalID}/form", festival.UpsertFormHandler(db))
	r.Get("/festivals/{festivalID}/form", festival.GetFormHandler(db))

	// Applications
	r.Post("/festivals/{festivalID}/apply", festival.SubmitApplicationHandler(db))

	// Review
	r.Get("/festivals/{festivalID}/applications", festival.ListApplicationsHandler(db))
	r.Post("/festivals/{festivalID}/applications/{applicationID}/accept", festival.AcceptApplicationHandler(db))
	r.Post("/festivals/{festivalID}/applications/{applicationID}/decline", festival.DeclineApplicationHandler(db))

	// Map
	r.Get("/festivals/slug/{slug}/map", festival.GetMapDataHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	do := func(method, path, body, token string) *http.Response {
		t.Helper()
		var reqBody io.Reader
		if body != "" {
			reqBody = strings.NewReader(body)
		}
		req, err := http.NewRequestWithContext(t.Context(), method, srv.URL+path, reqBody)
		require.NoError(t, err)
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		resp, err := http.DefaultClient.Do(req)
		require.NoError(t, err)
		return resp
	}

	decodeJSON := func(resp *http.Response) map[string]any {
		t.Helper()
		body, err := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		require.NoError(t, err, "read body")
		var m map[string]any
		require.NoError(t, json.Unmarshal(body, &m), "decode JSON from %s", resp.Request.URL.Path)
		return m
	}

	decodeJSONArray := func(resp *http.Response) []map[string]any {
		t.Helper()
		body, err := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		require.NoError(t, err, "read body")
		var arr []map[string]any
		require.NoError(t, json.Unmarshal(body, &arr), "decode JSON array")
		return arr
	}

	assertStatus := func(resp *http.Response, want int) {
		t.Helper()
		if resp.StatusCode != want {
			body, _ := io.ReadAll(resp.Body)
			_ = resp.Body.Close()
			t.Fatalf("expected %d, got %d: %s", want, resp.StatusCode, body)
		}
	}

	// 1. Sign up organiser
	resp := do("POST", "/auth/signup",
		`{"email":"rtorg@example.com","password":"hunter2hunter"}`, "")
	assertStatus(resp, http.StatusCreated)
	_ = resp.Body.Close()

	// 2. Log in as organiser
	loginResp := do("POST", "/auth/login",
		`{"email":"rtorg@example.com","password":"hunter2hunter"}`, "")
	defer func() { _ = loginResp.Body.Close() }()
	assertStatus(loginResp, http.StatusOK)
	orgToken := decodeJSON(loginResp)["token"].(string)

	// 3. Get organiser user ID
	meResp := do("GET", "/me", "", orgToken)
	defer func() { _ = meResp.Body.Close() }()
	assertStatus(meResp, http.StatusOK)
	orgUserID := decodeJSON(meResp)["id"].(string)
	_ = orgUserID

	// 4. Create festival
	resp = do("POST", "/festivals",
		`{"name":"Roundtrip Festival","slug":"rt-festival-2027","description":"Test festival","locationLabel":"Bristol"}`,
		orgToken)
	assertStatus(resp, http.StatusCreated)
	fest := decodeJSON(resp)
	_ = resp.Body.Close()
	festID := fest["id"].(string)
	assert.Equal(t, "draft", fest["status"])

	// 5. Upsert application form
	resp = do("PUT", "/festivals/"+festID+"/form",
		`{"fields":[{"id":"q1","label":"Why do you want to paint?","type":"long_text","required":true}]}`,
		orgToken)
	assertStatus(resp, http.StatusOK)
	form := decodeJSON(resp)
	_ = resp.Body.Close()
	assert.Equal(t, festID, form["festival_id"])

	// 6. Get form (public)
	resp = do("GET", "/festivals/"+festID+"/form", "", "")
	assertStatus(resp, http.StatusOK)
	_ = resp.Body.Close()

	// 7. Update festival to open status
	resp = do("PATCH", "/festivals/"+festID, `{"status":"open"}`, orgToken)
	assertStatus(resp, http.StatusOK)
	updated := decodeJSON(resp)
	_ = resp.Body.Close()
	assert.Equal(t, "open", updated["status"])

	// 8. Sign up artist
	resp = do("POST", "/auth/signup",
		`{"email":"rtartist@example.com","password":"hunter2hunter"}`, "")
	assertStatus(resp, http.StatusCreated)
	_ = resp.Body.Close()

	// 9. Log in as artist
	artistLogin := do("POST", "/auth/login",
		`{"email":"rtartist@example.com","password":"hunter2hunter"}`, "")
	defer func() { _ = artistLogin.Body.Close() }()
	assertStatus(artistLogin, http.StatusOK)
	artistToken := decodeJSON(artistLogin)["token"].(string)

	// 10. Get artist user ID via /me, create profile directly via sqlc
	meResp2 := do("GET", "/me", "", artistToken)
	defer func() { _ = meResp2.Body.Close() }()
	assertStatus(meResp2, http.StatusOK)
	artistUserID := decodeJSON(meResp2)["id"].(string)
	artistProfileID := createTestArtistProfile(t, db, artistUserID, "Roundtrip Artist")

	// 11. Submit application
	resp = do("POST", "/festivals/"+festID+"/apply",
		`{"answers":{"q1":"I love street art and have painted 20 murals"}}`,
		artistToken)
	assertStatus(resp, http.StatusCreated)
	app := decodeJSON(resp)
	_ = resp.Body.Close()
	applicationID := app["id"].(string)
	assert.Equal(t, "submitted", app["status"])

	// 12. List applications (organiser)
	resp = do("GET", "/festivals/"+festID+"/applications", "", orgToken)
	assertStatus(resp, http.StatusOK)
	apps := decodeJSONArray(resp)
	_ = resp.Body.Close()
	assert.Len(t, apps, 1)

	// 13. Accept application
	resp = do("POST", "/festivals/"+festID+"/applications/"+applicationID+"/accept", "", orgToken)
	assertStatus(resp, http.StatusOK)
	accepted := decodeJSON(resp)
	_ = resp.Body.Close()
	assert.Equal(t, "accepted", accepted["status"])

	// 14. Set festival to live
	resp = do("PATCH", "/festivals/"+festID, `{"status":"live"}`, orgToken)
	assertStatus(resp, http.StatusOK)
	_ = resp.Body.Close()

	// 15. Map is live but artist has no pin — pins should be empty
	resp = do("GET", "/festivals/slug/rt-festival-2027/map", "", "")
	assertStatus(resp, http.StatusOK)
	mapData := decodeJSON(resp)
	_ = resp.Body.Close()
	assert.Len(t, mapData["pins"].([]any), 0, "expected 0 pins (no pin coordinates set)")

	// 16. Assign a pin directly via sqlc (artist already has a festival_artist row from accept step)
	q := sqlcdb.New(db)
	lat := pgtype.Numeric{}
	require.NoError(t, lat.Scan("51.900740"))
	lng := pgtype.Numeric{}
	require.NoError(t, lng.Scan("-2.074060"))
	w3w := "filled.count.soap"
	_, err := q.SetFestivalArtistPin(context.Background(), sqlcdb.SetFestivalArtistPinParams{
		FestivalID: pgUUID(t, festID),
		ArtistID:   pgUUID(t, artistProfileID),
		PinLat:     lat,
		PinLng:     lng,
		W3w:        &w3w,
	})
	require.NoError(t, err, "set pin")

	// 17. Map now shows the pin
	resp = do("GET", "/festivals/slug/rt-festival-2027/map", "", "")
	assertStatus(resp, http.StatusOK)
	mapData2 := decodeJSON(resp)
	_ = resp.Body.Close()
	pins2 := mapData2["pins"].([]any)
	require.Len(t, pins2, 1)
	pin := pins2[0].(map[string]any)
	assert.Equal(t, artistProfileID, pin["artist_id"])
}

func TestFestivalDomainRoundTrip_ClosedFormBlocked(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	orgID, orgToken := createTestUser(t, db, "rtclosed-org@example.com")
	festID := createTestFestival(t, db, orgID, "rt-closed-form", "open")

	// Set close_at in the past
	pastTime := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)
	closeAt := pgtype.Timestamptz{Time: pastTime, Valid: true}

	q := sqlcdb.New(db)
	_, err := q.UpsertApplicationForm(context.Background(), sqlcdb.UpsertApplicationFormParams{
		FestivalID: pgUUID(t, festID),
		Fields:     []byte(`[]`),
		CloseAt:    closeAt,
	})
	require.NoError(t, err, "upsert form")

	artistID, artistToken := createTestUser(t, db, "rtclosed-artist@example.com")
	createTestArtistProfile(t, db, artistID, "Closed Form Artist")

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Post("/festivals/{festivalID}/apply", festival.SubmitApplicationHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "POST", "/festivals/"+festID+"/apply", `{"answers":{}}`, artistToken)
	require.Equal(t, http.StatusUnprocessableEntity, resp.StatusCode, "expected 422 for closed form")
	_ = resp.Body.Close()
	_ = orgToken
}

func TestFestivalDomainRoundTrip_MapOnlyShowsPinnedArtists(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	orgID, _ := createTestUser(t, db, "rtmap-org@example.com")
	festID := createTestFestival(t, db, orgID, "rt-map-pins", "live")

	// Accept artist WITHOUT pin
	artistUserID, _ := createTestUser(t, db, "rtmap-artist@example.com")
	artistProfileID := createTestArtistProfile(t, db, artistUserID, "Unpinned Artist")

	q := sqlcdb.New(db)
	_, err := q.AddFestivalArtist(context.Background(), sqlcdb.AddFestivalArtistParams{
		FestivalID: pgUUID(t, festID),
		ArtistID:   pgUUID(t, artistProfileID),
		Status:     sqlcdb.FestivalArtistStatusAccepted,
		// PinLat/PinLng left as zero — pin_lat/pin_lng will be NULL in DB
	})
	require.NoError(t, err, "add festival artist")

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Get("/festivals/slug/{slug}/map", festival.GetMapDataHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "GET", "/festivals/slug/rt-map-pins/map", "", "")
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var body map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	_ = resp.Body.Close()
	assert.Len(t, body["pins"].([]any), 0, "expected 0 pins for unpinned artist")
}
