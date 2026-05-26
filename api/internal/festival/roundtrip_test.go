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

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/festival"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

func TestFestivalDomainRoundTrip(t *testing.T) {
	db := testutil.NewDB(t)

	r := chi.NewRouter()
	r.Use(auth.Middleware(testSecret))
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
		req, _ := http.NewRequestWithContext(t.Context(), method, srv.URL+path, reqBody)
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("%s %s: %v", method, path, err)
		}
		return resp
	}

	decodeJSON := func(resp *http.Response) map[string]any {
		t.Helper()
		body, err := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		if err != nil {
			t.Fatalf("read body: %v", err)
		}
		var m map[string]any
		if err := json.Unmarshal(body, &m); err != nil {
			t.Fatalf("decode JSON from %s: %v (body: %s)", resp.Request.URL.Path, err, body)
		}
		return m
	}

	decodeJSONArray := func(resp *http.Response) []map[string]any {
		t.Helper()
		body, err := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		if err != nil {
			t.Fatalf("read body: %v", err)
		}
		var arr []map[string]any
		if err := json.Unmarshal(body, &arr); err != nil {
			t.Fatalf("decode JSON array: %v (body: %s)", err, body)
		}
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
		`{"email":"rtorg@example.com","password":"hunter2hunter","role":"organiser"}`, "")
	assertStatus(resp, http.StatusCreated)
	_ = resp.Body.Close()

	// 2. Log in as organiser
	loginResp := do("POST", "/auth/login",
		`{"email":"rtorg@example.com","password":"hunter2hunter"}`, "")
	assertStatus(loginResp, http.StatusOK)
	orgToken := decodeJSON(loginResp)["token"].(string)

	// 3. Get organiser user ID
	meResp := do("GET", "/me", "", orgToken)
	assertStatus(meResp, http.StatusOK)
	orgUserID := decodeJSON(meResp)["id"].(string)
	_ = orgUserID

	// 4. Create festival
	resp = do("POST", "/festivals",
		`{"name":"Roundtrip Festival","slug":"rt-festival-2027","description":"Test festival","locationLabel":"Bristol"}`,
		orgToken)
	assertStatus(resp, http.StatusCreated)
	fest := decodeJSON(resp)
	festID := fest["id"].(string)
	if fest["status"] != "draft" {
		t.Errorf("expected draft status, got %v", fest["status"])
	}

	// 5. Upsert application form
	resp = do("PUT", "/festivals/"+festID+"/form",
		`{"fields":[{"id":"q1","label":"Why do you want to paint?","type":"long_text","required":true}]}`,
		orgToken)
	assertStatus(resp, http.StatusOK)
	form := decodeJSON(resp)
	if form["festival_id"] != festID {
		t.Errorf("form festival_id mismatch: %v", form["festival_id"])
	}

	// 6. Get form (public)
	resp = do("GET", "/festivals/"+festID+"/form", "", "")
	assertStatus(resp, http.StatusOK)
	_ = resp.Body.Close()

	// 7. Update festival to open status
	resp = do("PATCH", "/festivals/"+festID, `{"status":"open"}`, orgToken)
	assertStatus(resp, http.StatusOK)
	updated := decodeJSON(resp)
	if updated["status"] != "open" {
		t.Errorf("expected open status, got %v", updated["status"])
	}

	// 8. Sign up artist
	resp = do("POST", "/auth/signup",
		`{"email":"rtartist@example.com","password":"hunter2hunter","role":"artist"}`, "")
	assertStatus(resp, http.StatusCreated)
	_ = resp.Body.Close()

	// 9. Log in as artist
	artistLogin := do("POST", "/auth/login",
		`{"email":"rtartist@example.com","password":"hunter2hunter"}`, "")
	assertStatus(artistLogin, http.StatusOK)
	artistToken := decodeJSON(artistLogin)["token"].(string)

	// 10. Get artist user ID via /me, create profile directly via sqlc
	meResp2 := do("GET", "/me", "", artistToken)
	assertStatus(meResp2, http.StatusOK)
	artistUserID := decodeJSON(meResp2)["id"].(string)
	artistProfileID := createTestArtistProfile(t, db, artistUserID, "Roundtrip Artist")

	// 11. Submit application
	resp = do("POST", "/festivals/"+festID+"/apply",
		`{"answers":{"q1":"I love street art and have painted 20 murals"}}`,
		artistToken)
	assertStatus(resp, http.StatusCreated)
	app := decodeJSON(resp)
	applicationID := app["id"].(string)
	if app["status"] != "submitted" {
		t.Errorf("expected submitted, got %v", app["status"])
	}

	// 12. List applications (organiser)
	resp = do("GET", "/festivals/"+festID+"/applications", "", orgToken)
	assertStatus(resp, http.StatusOK)
	apps := decodeJSONArray(resp)
	if len(apps) != 1 {
		t.Errorf("expected 1 application, got %d", len(apps))
	}

	// 13. Accept application
	resp = do("POST", "/festivals/"+festID+"/applications/"+applicationID+"/accept", "", orgToken)
	assertStatus(resp, http.StatusOK)
	accepted := decodeJSON(resp)
	if accepted["status"] != "accepted" {
		t.Errorf("expected accepted, got %v", accepted["status"])
	}

	// 14. Set festival to live
	resp = do("PATCH", "/festivals/"+festID, `{"status":"live"}`, orgToken)
	assertStatus(resp, http.StatusOK)
	_ = resp.Body.Close()

	// 15. Map is live but artist has no pin — pins should be empty
	resp = do("GET", "/festivals/slug/rt-festival-2027/map", "", "")
	assertStatus(resp, http.StatusOK)
	mapData := decodeJSON(resp)
	pins := mapData["pins"].([]any)
	if len(pins) != 0 {
		t.Errorf("expected 0 pins (no pin coordinates set), got %d", len(pins))
	}

	// 16. Assign a pin directly via sqlc (artist already has a festival_artist row from accept step)
	q := sqlcdb.New(db)
	lat := pgtype.Numeric{}
	_ = lat.Scan("51.900740")
	lng := pgtype.Numeric{}
	_ = lng.Scan("-2.074060")
	w3w := "filled.count.soap"
	_, err := q.SetFestivalArtistPin(context.Background(), sqlcdb.SetFestivalArtistPinParams{
		FestivalID: pgUUID(t, festID),
		ArtistID:   pgUUID(t, artistProfileID),
		PinLat:     lat,
		PinLng:     lng,
		W3w:        &w3w,
	})
	if err != nil {
		t.Fatalf("set pin: %v", err)
	}

	// 17. Map now shows the pin
	resp = do("GET", "/festivals/slug/rt-festival-2027/map", "", "")
	assertStatus(resp, http.StatusOK)
	mapData2 := decodeJSON(resp)
	pins2 := mapData2["pins"].([]any)
	if len(pins2) != 1 {
		t.Fatalf("expected 1 pin, got %d", len(pins2))
	}
	pin := pins2[0].(map[string]any)
	if pin["artist_id"] != artistProfileID {
		t.Errorf("pin artist_id: expected %s, got %v", artistProfileID, pin["artist_id"])
	}
}

func TestFestivalDomainRoundTrip_ClosedFormBlocked(t *testing.T) {
	db := testutil.NewDB(t)
	orgID, orgToken := createTestUser(t, db, "rtclosed-org@example.com", "organiser")
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
	if err != nil {
		t.Fatalf("upsert form: %v", err)
	}

	artistID, artistToken := createTestUser(t, db, "rtclosed-artist@example.com", "artist")
	createTestArtistProfile(t, db, artistID, "Closed Form Artist")

	r := chi.NewRouter()
	r.Use(auth.Middleware(testSecret))
	r.Post("/festivals/{festivalID}/apply", festival.SubmitApplicationHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "POST", "/festivals/"+festID+"/apply", `{"answers":{}}`, artistToken)
	if resp.StatusCode != http.StatusUnprocessableEntity {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		t.Fatalf("expected 422 for closed form, got %d: %s", resp.StatusCode, body)
	}
	resp.Body.Close()
	_ = orgToken
}

func TestFestivalDomainRoundTrip_MapOnlyShowsPinnedArtists(t *testing.T) {
	db := testutil.NewDB(t)
	orgID, _ := createTestUser(t, db, "rtmap-org@example.com", "organiser")
	festID := createTestFestival(t, db, orgID, "rt-map-pins", "live")

	// Accept artist WITHOUT pin
	artistUserID, _ := createTestUser(t, db, "rtmap-artist@example.com", "artist")
	artistProfileID := createTestArtistProfile(t, db, artistUserID, "Unpinned Artist")

	q := sqlcdb.New(db)
	_, err := q.AddFestivalArtist(context.Background(), sqlcdb.AddFestivalArtistParams{
		FestivalID: pgUUID(t, festID),
		ArtistID:   pgUUID(t, artistProfileID),
		Status:     sqlcdb.FestivalArtistStatusAccepted,
		// PinLat/PinLng left as zero — pin_lat/pin_lng will be NULL in DB
	})
	if err != nil {
		t.Fatalf("add festival artist: %v", err)
	}

	r := chi.NewRouter()
	r.Use(auth.Middleware(testSecret))
	r.Get("/festivals/slug/{slug}/map", festival.GetMapDataHandler(db))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "GET", "/festivals/slug/rt-map-pins/map", "", "")
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		t.Fatalf("expected 200, got %d: %s", resp.StatusCode, body)
	}
	var body map[string]any
	json.NewDecoder(resp.Body).Decode(&body)
	resp.Body.Close()
	pins := body["pins"].([]any)
	if len(pins) != 0 {
		t.Errorf("expected 0 pins for unpinned artist, got %d", len(pins))
	}
}
