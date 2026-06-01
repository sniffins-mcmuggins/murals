package endorsement_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/endorsement"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

var festSeq atomic.Int64

func nextFestSlug() string {
	return fmt.Sprintf("test-fest-%d", festSeq.Add(1))
}

const testSecret = testutil.TestSecret

func pgUUID(t *testing.T, s string) pgtype.UUID {
	t.Helper()
	var u pgtype.UUID
	require.NoError(t, u.Scan(s))
	return u
}

func createArtistProfile(t *testing.T, pool *pgxpool.Pool, userID, name string) string {
	t.Helper()
	q := sqlcdb.New(pool)
	p, err := q.CreateArtistProfile(context.Background(), sqlcdb.CreateArtistProfileParams{
		UserID:      pgUUID(t, userID),
		DisplayName: name,
	})
	require.NoError(t, err)
	return p.ID.String()
}

func publishProfile(t *testing.T, pool *pgxpool.Pool, profileID string) {
	t.Helper()
	_, err := pool.Exec(context.Background(),
		`UPDATE artist_profiles SET visibility = 'public' WHERE id = $1`, profileID)
	require.NoError(t, err)
}

func createFestival(t *testing.T, pool *pgxpool.Pool, organiserID string) string {
	t.Helper()
	q := sqlcdb.New(pool)
	f, err := q.CreateFestival(context.Background(), sqlcdb.CreateFestivalParams{
		OrganiserID:   pgUUID(t, organiserID),
		Name:          "Test Festival",
		Slug:          nextFestSlug(),
		Description:   "",
		LocationLabel: "",
		Status:        sqlcdb.FestivalStatusDraft,
	})
	require.NoError(t, err)
	return f.ID.String()
}

func jsonBody(t *testing.T, v interface{}) *bytes.Buffer {
	t.Helper()
	b, err := json.Marshal(v)
	require.NoError(t, err)
	return bytes.NewBuffer(b)
}

// ── Tests ──

func TestCreateEndorsement_PeerSuccess(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	endorserID, endorserToken, _ := testutil.CreateUser(t, db)
	endorseeUserID, _, _ := testutil.CreateUser(t, db)
	createArtistProfile(t, db, endorserID, "Endorser Artist")
	endorseeProfileID := createArtistProfile(t, db, endorseeUserID, "Endorsee Artist")
	publishProfile(t, db, endorseeProfileID)

	handler := auth.Middleware(db, testSecret)(endorsement.CreateHandler(db))
	body := jsonBody(t, map[string]interface{}{
		"endorsee_id": endorseeProfileID,
		"kind":        "peer",
		"body":        "Great murals!",
		"skills":      []string{"mural", "stencil"},
	})
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/endorsements", body)
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+endorserToken)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
	var resp map[string]interface{}
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	assert.Equal(t, "peer", resp["kind"])
	assert.Equal(t, "Great murals!", resp["body"])
	assert.Equal(t, []interface{}{"mural", "stencil"}, resp["skills"])
}

func TestCreateEndorsement_Unauthorized(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	handler := auth.Middleware(db, testSecret)(endorsement.CreateHandler(db))
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/endorsements",
		bytes.NewBufferString(`{"endorsee_id":"00000000-0000-0000-0000-000000000001","kind":"peer"}`))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestCreateEndorsement_SelfEndorse(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	userID, token, _ := testutil.CreateUser(t, db)
	profileID := createArtistProfile(t, db, userID, "Self Artist")
	publishProfile(t, db, profileID)

	handler := auth.Middleware(db, testSecret)(endorsement.CreateHandler(db))
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/endorsements",
		jsonBody(t, map[string]interface{}{"endorsee_id": profileID, "kind": "peer"}))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestCreateEndorsement_PeerWithoutProfile(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	_, endorserToken, _ := testutil.CreateUser(t, db)
	endorseeUserID, _, _ := testutil.CreateUser(t, db)
	endorseeProfileID := createArtistProfile(t, db, endorseeUserID, "Endorsee")
	publishProfile(t, db, endorseeProfileID)

	handler := auth.Middleware(db, testSecret)(endorsement.CreateHandler(db))
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/endorsements",
		jsonBody(t, map[string]interface{}{"endorsee_id": endorseeProfileID, "kind": "peer"}))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+endorserToken)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	assert.Equal(t, http.StatusForbidden, w.Code)
}

func TestCreateEndorsement_OrganiserSuccess(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	organiserID, organiserToken, _ := testutil.CreateUser(t, db)
	endorseeUserID, _, _ := testutil.CreateUser(t, db)
	endorseeProfileID := createArtistProfile(t, db, endorseeUserID, "Endorsee")
	publishProfile(t, db, endorseeProfileID)
	festivalID := createFestival(t, db, organiserID)

	handler := auth.Middleware(db, testSecret)(endorsement.CreateHandler(db))
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/endorsements",
		jsonBody(t, map[string]interface{}{
			"endorsee_id": endorseeProfileID,
			"kind":        "organiser",
			"festival_id": festivalID,
			"body":        "Excellent mural work.",
		}))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+organiserToken)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
	var resp map[string]interface{}
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	assert.Equal(t, "organiser", resp["kind"])
	assert.Equal(t, festivalID, resp["festival_id"])
}

func TestCreateEndorsement_OrganiserUnownedFestival(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	_, organiserToken, _ := testutil.CreateUser(t, db)
	otherOrganiserID, _, _ := testutil.CreateUser(t, db)
	endorseeUserID, _, _ := testutil.CreateUser(t, db)
	endorseeProfileID := createArtistProfile(t, db, endorseeUserID, "Endorsee")
	publishProfile(t, db, endorseeProfileID)
	otherFestivalID := createFestival(t, db, otherOrganiserID)

	handler := auth.Middleware(db, testSecret)(endorsement.CreateHandler(db))
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/endorsements",
		jsonBody(t, map[string]interface{}{
			"endorsee_id": endorseeProfileID,
			"kind":        "organiser",
			"festival_id": otherFestivalID,
		}))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+organiserToken)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	assert.Equal(t, http.StatusForbidden, w.Code)
}

func TestCreateEndorsement_Upsert(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	endorserID, endorserToken, _ := testutil.CreateUser(t, db)
	endorseeUserID, _, _ := testutil.CreateUser(t, db)
	createArtistProfile(t, db, endorserID, "Endorser")
	endorseeProfileID := createArtistProfile(t, db, endorseeUserID, "Endorsee")
	publishProfile(t, db, endorseeProfileID)

	handler := auth.Middleware(db, testSecret)(endorsement.CreateHandler(db))

	var firstID string
	for i := 0; i < 2; i++ {
		r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/endorsements",
			jsonBody(t, map[string]interface{}{
				"endorsee_id": endorseeProfileID,
				"kind":        "peer",
				"body":        fmt.Sprintf("Version %d", i+1),
			}))
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Authorization", "Bearer "+endorserToken)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		require.Equal(t, http.StatusCreated, w.Code, "iteration %d: %s", i, w.Body.String())
		var resp map[string]interface{}
		require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
		if i == 0 {
			firstID = resp["id"].(string)
		} else {
			assert.Equal(t, firstID, resp["id"].(string), "upsert must return the same row ID")
			assert.Equal(t, "Version 2", resp["body"])
		}
	}

	var count int
	err := db.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM endorsements WHERE endorser_id = $1`, endorserID).Scan(&count)
	require.NoError(t, err)
	assert.Equal(t, 1, count, "upsert should keep exactly one endorsement per pair")
}

func TestDeleteEndorsement(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	endorserID, endorserToken, _ := testutil.CreateUser(t, db)
	endorseeUserID, endorseeToken, _ := testutil.CreateUser(t, db)
	createArtistProfile(t, db, endorserID, "Endorser")
	endorseeProfileID := createArtistProfile(t, db, endorseeUserID, "Endorsee")
	publishProfile(t, db, endorseeProfileID)

	var endorsementID string
	err := db.QueryRow(context.Background(),
		`INSERT INTO endorsements (endorser_id, endorsee_id, kind, skills)
		 VALUES ($1, $2, 'peer', '{}') RETURNING id::text`,
		endorserID, endorseeProfileID).Scan(&endorsementID)
	require.NoError(t, err)

	router := chi.NewRouter()
	router.Use(auth.Middleware(db, testSecret))
	router.Delete("/endorsements/{endorsementID}", endorsement.DeleteHandler(db))
	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)

	// Endorsee cannot delete.
	resp := testutil.DoRequest(t, srv, http.MethodDelete, "/endorsements/"+endorsementID, "", endorseeToken)
	assert.Equal(t, http.StatusForbidden, resp.StatusCode)
	_ = resp.Body.Close()

	// Endorser can delete.
	resp = testutil.DoRequest(t, srv, http.MethodDelete, "/endorsements/"+endorsementID, "", endorserToken)
	assert.Equal(t, http.StatusNoContent, resp.StatusCode)
	_ = resp.Body.Close()

	// Second delete → 404.
	resp = testutil.DoRequest(t, srv, http.MethodDelete, "/endorsements/"+endorsementID, "", endorserToken)
	assert.Equal(t, http.StatusNotFound, resp.StatusCode)
	_ = resp.Body.Close()
}

func TestListPublicEndorsements(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	endorserID, _, _ := testutil.CreateUser(t, db)
	endorseeUserID, _, _ := testutil.CreateUser(t, db)
	createArtistProfile(t, db, endorserID, "Endorser")
	endorseeProfileID := createArtistProfile(t, db, endorseeUserID, "Endorsee")
	publishProfile(t, db, endorseeProfileID)

	_, err := db.Exec(context.Background(),
		`INSERT INTO endorsements (endorser_id, endorsee_id, kind, body, skills)
		 VALUES ($1, $2, 'peer', 'Great work', '{mural}')`,
		endorserID, endorseeProfileID)
	require.NoError(t, err)

	router := chi.NewRouter()
	router.Get("/profiles/{profileID}/endorsements", endorsement.ListPublicHandler(db))
	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)

	resp := testutil.DoRequest(t, srv, http.MethodGet, "/profiles/"+endorseeProfileID+"/endorsements", "", "")
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var body struct {
		Endorsements []map[string]interface{} `json:"endorsements"`
	}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	_ = resp.Body.Close()
	require.Len(t, body.Endorsements, 1)
	assert.Equal(t, "peer", body.Endorsements[0]["kind"])
	assert.Equal(t, "Great work", body.Endorsements[0]["body"])
	assert.Equal(t, "Endorser", body.Endorsements[0]["endorser_display_name"])
}

func TestListPublicEndorsements_HiddenExcluded(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	endorserID, _, _ := testutil.CreateUser(t, db)
	endorseeUserID, _, _ := testutil.CreateUser(t, db)
	createArtistProfile(t, db, endorserID, "Endorser")
	endorseeProfileID := createArtistProfile(t, db, endorseeUserID, "Endorsee")
	publishProfile(t, db, endorseeProfileID)

	_, err := db.Exec(context.Background(),
		`INSERT INTO endorsements (endorser_id, endorsee_id, kind, hidden_by_endorsee, skills)
		 VALUES ($1, $2, 'peer', true, '{}')`,
		endorserID, endorseeProfileID)
	require.NoError(t, err)

	router := chi.NewRouter()
	router.Get("/profiles/{profileID}/endorsements", endorsement.ListPublicHandler(db))
	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)

	resp := testutil.DoRequest(t, srv, http.MethodGet, "/profiles/"+endorseeProfileID+"/endorsements", "", "")
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var body struct {
		Endorsements []map[string]interface{} `json:"endorsements"`
	}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	_ = resp.Body.Close()
	assert.Empty(t, body.Endorsements, "hidden endorsements must not appear in public list")
}

func TestSetVisibility(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	endorserID, endorserToken, _ := testutil.CreateUser(t, db)
	endorseeUserID, endorseeToken, _ := testutil.CreateUser(t, db)
	createArtistProfile(t, db, endorserID, "Endorser")
	endorseeProfileID := createArtistProfile(t, db, endorseeUserID, "Endorsee")
	publishProfile(t, db, endorseeProfileID)

	var endorsementID string
	err := db.QueryRow(context.Background(),
		`INSERT INTO endorsements (endorser_id, endorsee_id, kind, skills)
		 VALUES ($1, $2, 'peer', '{}') RETURNING id::text`,
		endorserID, endorseeProfileID).Scan(&endorsementID)
	require.NoError(t, err)

	router := chi.NewRouter()
	router.Use(auth.Middleware(db, testSecret))
	router.Patch("/endorsements/{endorsementID}/visibility", endorsement.SetVisibilityHandler(db))
	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)

	// Endorser cannot set visibility.
	resp := testutil.DoRequest(t, srv, http.MethodPatch,
		"/endorsements/"+endorsementID+"/visibility", `{"hidden":true}`, endorserToken)
	assert.Equal(t, http.StatusForbidden, resp.StatusCode)
	_ = resp.Body.Close()

	// Endorsee can hide.
	resp = testutil.DoRequest(t, srv, http.MethodPatch,
		"/endorsements/"+endorsementID+"/visibility", `{"hidden":true}`, endorseeToken)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var respBody map[string]interface{}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&respBody))
	_ = resp.Body.Close()
	assert.Equal(t, true, respBody["hidden_by_endorsee"])

	// Endorsee can show again.
	resp = testutil.DoRequest(t, srv, http.MethodPatch,
		"/endorsements/"+endorsementID+"/visibility", `{"hidden":false}`, endorseeToken)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&respBody))
	_ = resp.Body.Close()
	assert.Equal(t, false, respBody["hidden_by_endorsee"])
}

func TestListReceivedEndorsements(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	endorserID, _, _ := testutil.CreateUser(t, db)
	endorser2ID, _, _ := testutil.CreateUser(t, db)
	endorseeUserID, endorseeToken, _ := testutil.CreateUser(t, db)
	createArtistProfile(t, db, endorserID, "Endorser1")
	createArtistProfile(t, db, endorser2ID, "Endorser2")
	endorseeProfileID := createArtistProfile(t, db, endorseeUserID, "Endorsee")
	publishProfile(t, db, endorseeProfileID)

	// One visible + one hidden.
	_, err := db.Exec(context.Background(),
		`INSERT INTO endorsements (endorser_id, endorsee_id, kind, hidden_by_endorsee, skills)
		 VALUES ($1, $2, 'peer', false, '{}'), ($3, $2, 'peer', true, '{}')`,
		endorserID, endorseeProfileID, endorser2ID)
	require.NoError(t, err)

	handler := auth.Middleware(db, testSecret)(endorsement.ListReceivedHandler(db))
	r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/endorsements/received", nil)
	r.Header.Set("Authorization", "Bearer "+endorseeToken)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	var body struct {
		Endorsements []map[string]interface{} `json:"endorsements"`
	}
	require.NoError(t, json.NewDecoder(w.Body).Decode(&body))
	assert.Len(t, body.Endorsements, 2, "received list includes hidden endorsements")
}

func TestListReceivedEndorsements_NoProfile(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	_, token, _ := testutil.CreateUser(t, db) // no artist profile

	handler := auth.Middleware(db, testSecret)(endorsement.ListReceivedHandler(db))
	r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/endorsements/received", nil)
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	assert.Equal(t, http.StatusNotFound, w.Code)
}
