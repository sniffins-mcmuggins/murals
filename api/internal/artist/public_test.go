package artist_test

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
	"golang.org/x/crypto/bcrypt"

	"github.com/sniffins-mcmuggins/render/api/internal/artist"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

func createArtistWithProfile(t *testing.T, pool *pgxpool.Pool, email, displayName string) {
	t.Helper()
	hash, _ := bcrypt.GenerateFromPassword([]byte("pass"), bcrypt.MinCost)
	hashStr := string(hash)
	q := sqlcdb.New(pool)
	user, err := q.CreateUser(context.Background(), sqlcdb.CreateUserParams{
		Email:        email,
		PasswordHash: &hashStr,
	})
	require.NoError(t, err)
	_, err = q.CreateArtistProfile(context.Background(), sqlcdb.CreateArtistProfileParams{
		UserID:      user.ID,
		DisplayName: displayName,
	})
	require.NoError(t, err)
}

func TestListPublicProfiles(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)

	r := chi.NewRouter()
	r.Get("/public/profiles", artist.ListPublicProfilesHandler(db))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	// Empty initially
	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, srv.URL+"/public/profiles", nil)
	require.NoError(t, err)
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var empty struct {
		Profiles []any `json:"profiles"`
		Total    int   `json:"total"`
	}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&empty))
	_ = resp.Body.Close()
	assert.Equal(t, 0, empty.Total)
	assert.Empty(t, empty.Profiles)
}

func TestListPublicProfiles_Pagination(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)

	// Insert 3 profiles
	for i := range 3 {
		email := "artist" + string(rune('a'+i)) + "@example.com"
		createArtistWithProfile(t, db, email, "Artist "+string(rune('A'+i)))
	}

	r := chi.NewRouter()
	r.Get("/public/profiles", artist.ListPublicProfilesHandler(db))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	req2, err := http.NewRequestWithContext(context.Background(), http.MethodGet, srv.URL+"/public/profiles?page=1&per_page=2", nil)
	require.NoError(t, err)
	resp, err := http.DefaultClient.Do(req2)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, resp.StatusCode)

	var body struct {
		Profiles []any `json:"profiles"`
		Total    int   `json:"total"`
		Page     int   `json:"page"`
		PerPage  int   `json:"per_page"`
	}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	_ = resp.Body.Close()

	assert.Equal(t, 3, body.Total)
	assert.Equal(t, 2, len(body.Profiles))
	assert.Equal(t, 1, body.Page)
	assert.Equal(t, 2, body.PerPage)
}
