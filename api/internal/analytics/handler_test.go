package analytics_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/sniffins-mcmuggins/render/api/internal/analytics"
	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

const handlerSecret = testutil.TestSecret

func toPgUUID(t *testing.T, s string) pgtype.UUID {
	t.Helper()
	parsed, err := uuid.Parse(s)
	require.NoError(t, err)
	return pgtype.UUID{Bytes: [16]byte(parsed), Valid: true}
}

func makeUser(t *testing.T, db *pgxpool.Pool) (userID, token string) {
	userID, token, _ = testutil.CreateUser(t, db)
	return userID, token
}

func makeProfile(t *testing.T, db *pgxpool.Pool, userID string) string {
	t.Helper()
	q := sqlcdb.New(db)
	p, err := q.CreateArtistProfile(context.Background(), sqlcdb.CreateArtistProfileParams{
		UserID:      toPgUUID(t, userID),
		DisplayName: "Test Artist",
	})
	require.NoError(t, err)
	return p.ID.String()
}

// grantPro inserts a never-expiring artist_pro access grant via raw SQL.
func grantPro(t *testing.T, db *pgxpool.Pool, userID string) {
	t.Helper()
	_, err := db.Exec(context.Background(),
		`INSERT INTO access_grants (user_id, plan, valid_until, granted_by)
		 VALUES ($1, 'artist_pro', now() + interval '10 years', $1)`,
		userID,
	)
	require.NoError(t, err)
}

func TestMyAnalyticsHandler_Unauthenticated(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	handler := auth.Middleware(db, handlerSecret)(analytics.MyAnalyticsHandler(db))

	r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/profiles/me/analytics", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestMyAnalyticsHandler_NoProfile_Returns404(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	_, token := makeUser(t, db)
	handler := auth.Middleware(db, handlerSecret)(analytics.MyAnalyticsHandler(db))

	r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/profiles/me/analytics", nil)
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestMyAnalyticsHandler_FreeUser_90DayWindow(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	userID, token := makeUser(t, db)
	profileID := makeProfile(t, db, userID)

	require.NoError(t, analytics.RecordEvent(context.Background(), db, analytics.EventProfileView, profileID))
	require.NoError(t, analytics.RecordEvent(context.Background(), db, analytics.EventQRScan, profileID))

	handler := auth.Middleware(db, handlerSecret)(analytics.MyAnalyticsHandler(db))
	r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/profiles/me/analytics", nil)
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	var resp analytics.AnalyticsResponse
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	assert.Equal(t, int64(1), resp.ProfileViews)
	assert.Equal(t, int64(1), resp.QRScans)
	assert.Equal(t, int64(0), resp.LinkClicks)
	assert.Equal(t, 90, resp.WindowDays)
}

func TestMyAnalyticsHandler_ProUser_2YearWindow(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	userID, token := makeUser(t, db)
	profileID := makeProfile(t, db, userID)
	grantPro(t, db, userID)

	// Old event: 13 months ago (outside 90-day window, inside 2-year window).
	_, err := db.Exec(context.Background(),
		`INSERT INTO analytics_events (event_type, profile_id, occurred_at)
		 VALUES ('profile_view', $1, now() - interval '13 months')`,
		profileID,
	)
	require.NoError(t, err)

	handler := auth.Middleware(db, handlerSecret)(analytics.MyAnalyticsHandler(db))
	r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/profiles/me/analytics", nil)
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	var resp analytics.AnalyticsResponse
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	// Pro window: 730 days — old event should be included.
	assert.Equal(t, int64(1), resp.ProfileViews)
	assert.Equal(t, 730, resp.WindowDays)
}

func TestMyAnalyticsHandler_ZeroCountsWhenNoEvents(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	userID, token := makeUser(t, db)
	makeProfile(t, db, userID)

	handler := auth.Middleware(db, handlerSecret)(analytics.MyAnalyticsHandler(db))
	r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/profiles/me/analytics", nil)
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	var resp analytics.AnalyticsResponse
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	assert.Equal(t, int64(0), resp.ProfileViews)
	assert.Equal(t, int64(0), resp.QRScans)
	assert.Equal(t, int64(0), resp.LinkClicks)
	assert.Equal(t, 90, resp.WindowDays)
}
