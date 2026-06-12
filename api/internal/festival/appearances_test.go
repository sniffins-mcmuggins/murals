package festival_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
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

type appearanceResp struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	Slug      string  `json:"slug"`
	StartDate *string `json:"start_date"`
	EndDate   *string `json:"end_date"`
	Status    string  `json:"status"`
	MapSlug   *string `json:"map_slug"`
}

func TestListArtistFestivals_AcceptedAppears(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	q := sqlcdb.New(db)

	orgID, _, _ := createTestUser(t, db)
	artistUserID, _, _ := createTestUser(t, db)
	artistID := createTestArtistProfile(t, db, artistUserID, "Lady Gabe")

	start := time.Date(2027, 10, 1, 0, 0, 0, 0, time.UTC)
	end := time.Date(2027, 10, 5, 0, 0, 0, 0, time.UTC)
	fest, err := q.CreateFestival(context.Background(), sqlcdb.CreateFestivalParams{
		OrganiserID:   pgUUID(t, orgID),
		Name:          "Cheltenham Paint Festival",
		Slug:          "cpf-2027",
		Description:   "",
		LocationLabel: "Cheltenham",
		StartDate:     pgtype.Date{Time: start, Valid: true},
		EndDate:       pgtype.Date{Time: end, Valid: true},
		Status:        sqlcdb.FestivalStatusLive,
	})
	require.NoError(t, err)

	_, err = q.AddFestivalArtist(context.Background(), sqlcdb.AddFestivalArtistParams{
		FestivalID: fest.ID,
		ArtistID:   pgUUID(t, artistID),
		Source:     sqlcdb.FestivalArtistSourceApplication,
	})
	require.NoError(t, err)

	r := chi.NewRouter()
	r.Get("/profiles/{profileID}/festivals", festival.ListArtistFestivalsHandler(db))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "GET", "/profiles/"+artistID+"/festivals", "", "")
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var out []appearanceResp
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&out))
	_ = resp.Body.Close()

	require.Len(t, out, 1)
	assert.Equal(t, fest.ID.String(), out[0].ID)
	assert.Equal(t, "cpf-2027", out[0].Slug)
	assert.Equal(t, "live", out[0].Status)
	require.NotNil(t, out[0].StartDate)
	assert.Equal(t, "2027-10-01", *out[0].StartDate)
	require.NotNil(t, out[0].EndDate)
	assert.Equal(t, "2027-10-05", *out[0].EndDate)
	// Live festivals expose a working map link.
	require.NotNil(t, out[0].MapSlug)
	assert.Equal(t, "cpf-2027", *out[0].MapSlug)
}

func TestListArtistFestivals_AssignedSpotAppears(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	q := sqlcdb.New(db)

	orgID, _, _ := createTestUser(t, db)
	artistUserID, _, _ := createTestUser(t, db)
	artistID := createTestArtistProfile(t, db, artistUserID, "Spot Artist")

	festID, _ := createTestFestival(t, db, orgID, "live")

	// Artist has an assigned spot but no festival_artists row.
	lat := pgtype.Numeric{}
	require.NoError(t, lat.Scan("51.5"))
	lng := pgtype.Numeric{}
	require.NoError(t, lng.Scan("-2.1"))
	spot, err := q.CreateFestivalSpot(context.Background(), sqlcdb.CreateFestivalSpotParams{
		FestivalID: pgUUID(t, festID),
		Lat:        lat,
		Lng:        lng,
	})
	require.NoError(t, err)
	_, err = q.SetFestivalSpotArtist(context.Background(), sqlcdb.SetFestivalSpotArtistParams{
		ID:         spot.ID,
		FestivalID: pgUUID(t, festID),
		ArtistID:   pgUUID(t, artistID),
	})
	require.NoError(t, err)

	r := chi.NewRouter()
	r.Get("/profiles/{profileID}/festivals", festival.ListArtistFestivalsHandler(db))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "GET", "/profiles/"+artistID+"/festivals", "", "")
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var out []appearanceResp
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&out))
	_ = resp.Body.Close()

	require.Len(t, out, 1)
	assert.Equal(t, festID, out[0].ID)
}

func TestListArtistFestivals_ExcludesNonLineupArtist(t *testing.T) {
	// An artist who applied but was never added to festival_artists (e.g. declined or pending)
	// must not appear in the public appearances list.
	t.Parallel()
	db := testutil.NewDB(t)

	orgID, _, _ := createTestUser(t, db)
	artistUserID, _, _ := createTestUser(t, db)
	artistID := createTestArtistProfile(t, db, artistUserID, "Rejected Artist")

	// A live festival where the artist applied but was not added to the lineup.
	_, _ = createTestFestival(t, db, orgID, "live")

	r := chi.NewRouter()
	r.Get("/profiles/{profileID}/festivals", festival.ListArtistFestivalsHandler(db))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "GET", "/profiles/"+artistID+"/festivals", "", "")
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var out []appearanceResp
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&out))
	_ = resp.Body.Close()
	assert.Empty(t, out)
}

func TestListArtistFestivals_ExcludesNonPublicFestivals(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	q := sqlcdb.New(db)

	orgID, _, _ := createTestUser(t, db)
	artistUserID, _, _ := createTestUser(t, db)
	artistID := createTestArtistProfile(t, db, artistUserID, "Draft Artist")

	// Added to lineup at a draft festival and an archived one — neither is public.
	for _, status := range []string{"draft", "archived"} {
		festID, _ := createTestFestival(t, db, orgID, status)
		_, err := q.AddFestivalArtist(context.Background(), sqlcdb.AddFestivalArtistParams{
			FestivalID: pgUUID(t, festID),
			ArtistID:   pgUUID(t, artistID),
			Source:     sqlcdb.FestivalArtistSourceApplication,
		})
		require.NoError(t, err)
	}

	r := chi.NewRouter()
	r.Get("/profiles/{profileID}/festivals", festival.ListArtistFestivalsHandler(db))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "GET", "/profiles/"+artistID+"/festivals", "", "")
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var out []appearanceResp
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&out))
	_ = resp.Body.Close()
	assert.Empty(t, out)
}

func TestListArtistFestivals_OpenFestivalHasNoMapSlug(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	q := sqlcdb.New(db)

	orgID, _, _ := createTestUser(t, db)
	artistUserID, _, _ := createTestUser(t, db)
	artistID := createTestArtistProfile(t, db, artistUserID, "Open Artist")

	openFest, _ := createTestFestival(t, db, orgID, "open")
	_, err := q.AddFestivalArtist(context.Background(), sqlcdb.AddFestivalArtistParams{
		FestivalID: pgUUID(t, openFest),
		ArtistID:   pgUUID(t, artistID),
		Source:     sqlcdb.FestivalArtistSourceApplication,
	})
	require.NoError(t, err)

	r := chi.NewRouter()
	r.Get("/profiles/{profileID}/festivals", festival.ListArtistFestivalsHandler(db))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "GET", "/profiles/"+artistID+"/festivals", "", "")
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var out []appearanceResp
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&out))
	_ = resp.Body.Close()

	require.Len(t, out, 1)
	assert.Equal(t, "open", out[0].Status)
	// Public map only renders for live festivals → no map link for open ones.
	assert.Nil(t, out[0].MapSlug)
}

func TestListArtistFestivals_EmptyArrayNotNull(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)

	artistUserID, _, _ := createTestUser(t, db)
	artistID := createTestArtistProfile(t, db, artistUserID, "Lonely Artist")

	r := chi.NewRouter()
	r.Get("/profiles/{profileID}/festivals", festival.ListArtistFestivalsHandler(db))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "GET", "/profiles/"+artistID+"/festivals", "", "")
	require.Equal(t, http.StatusOK, resp.StatusCode)
	raw, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	_ = resp.Body.Close()
	// An empty result must serialise as `[]`, never `null`.
	assert.Equal(t, "[]", string(raw[:2]))
}

func TestListArtistFestivals_InvalidProfileID(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)

	r := chi.NewRouter()
	r.Get("/profiles/{profileID}/festivals", festival.ListArtistFestivalsHandler(db))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := doRequest(t, srv, "GET", "/profiles/not-a-uuid/festivals", "", "")
	assert.Equal(t, http.StatusBadRequest, resp.StatusCode)
	_ = resp.Body.Close()
}

func TestAppearances_PreReleaseSpotDoesNotLeak(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)

	orgID, orgToken, _ := testutil.CreateUser(t, db)
	artistUserID, _, _ := testutil.CreateUser(t, db)

	festID, _ := createTestFestival(t, db, orgID, "open")
	createTestApplicationForm(t, db, festID)
	profileID := createTestArtistProfile(t, db, artistUserID, "Appear Artist")
	appID := createTestApplicationInFestival(t, db, festID, artistUserID)

	q := sqlcdb.New(db)
	_, err := q.UpdateApplicationFlags(t.Context(), sqlcdb.UpdateApplicationFlagsParams{
		ID: pgUUID(t, appID), Shortlisted: false, ReviewFlag: false, Decision: sqlcdb.ApplicationDecisionAccept,
	})
	require.NoError(t, err)

	// Create a spot and assign the provisional accept via the HTTP handlers.
	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Post("/festivals/{festivalID}/spots", festival.CreateSpotHandler(db))
	r.Put("/festivals/{festivalID}/spots/{spotID}/artist", festival.SetSpotArtistHandler(db))
	r.Get("/profiles/{profileID}/festivals", festival.ListArtistFestivalsHandler(db))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	cr := doRequest(t, srv, "POST", "/festivals/"+festID+"/spots", `{"lat":51.9,"lng":-2.07}`, orgToken)
	require.Equal(t, http.StatusCreated, cr.StatusCode)
	var spot struct {
		ID string `json:"id"`
	}
	require.NoError(t, json.NewDecoder(cr.Body).Decode(&spot))
	_ = cr.Body.Close()

	ar := doRequest(t, srv, "PUT", "/festivals/"+festID+"/spots/"+spot.ID+"/artist",
		`{"artist_id":"`+profileID+`"}`, orgToken)
	require.Equal(t, http.StatusOK, ar.StatusCode)
	_ = ar.Body.Close()

	// Public appearances for this artist must NOT include the open festival
	// because spot assignments are pre-release (festival is not yet live).
	resp := doRequest(t, srv, "GET", "/profiles/"+profileID+"/festivals", "", "")
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var appearances []map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&appearances))
	_ = resp.Body.Close()
	require.Empty(t, appearances, "a pre-release spot assignment must not surface publicly")
}
