package analytics_test

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/sniffins-mcmuggins/render/api/internal/analytics"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

// setupProfile creates a user + artist profile and returns the profile UUID string.
func setupProfile(t *testing.T, db *pgxpool.Pool) string {
	t.Helper()
	userID, _, _ := testutil.CreateUser(t, db)
	q := sqlcdb.New(db)
	profile, err := q.CreateArtistProfile(context.Background(), sqlcdb.CreateArtistProfileParams{
		UserID:      toPgUUID(t, userID),
		DisplayName: "Test Artist",
	})
	require.NoError(t, err)
	return profile.ID.String()
}

func TestRecordEvent_ProfileView(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	profileID := setupProfile(t, db)

	err := analytics.RecordEvent(context.Background(), db, analytics.EventProfileView, profileID)
	require.NoError(t, err)
}

func TestRecordEvent_AllTypes(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	profileID := setupProfile(t, db)

	for _, et := range []analytics.EventType{
		analytics.EventProfileView,
		analytics.EventQRScan,
		analytics.EventLinkClick,
	} {
		require.NoError(t, analytics.RecordEvent(context.Background(), db, et, profileID),
			"event type %s should be recordable", et)
	}
}

func TestGetCounts_ByType(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	profileID := setupProfile(t, db)

	// Record 3 profile views and 1 QR scan.
	for range 3 {
		require.NoError(t, analytics.RecordEvent(context.Background(), db, analytics.EventProfileView, profileID))
	}
	require.NoError(t, analytics.RecordEvent(context.Background(), db, analytics.EventQRScan, profileID))

	counts, err := analytics.GetCounts(context.Background(), db, profileID, time.Now().Add(-time.Hour))
	require.NoError(t, err)

	assert.Equal(t, int64(3), counts[analytics.EventProfileView])
	assert.Equal(t, int64(1), counts[analytics.EventQRScan])
	assert.Equal(t, int64(0), counts[analytics.EventLinkClick])
}

func TestGetCounts_ExcludesOtherProfiles(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	profileA := setupProfile(t, db)
	profileB := setupProfile(t, db)

	require.NoError(t, analytics.RecordEvent(context.Background(), db, analytics.EventProfileView, profileA))
	require.NoError(t, analytics.RecordEvent(context.Background(), db, analytics.EventProfileView, profileB))

	counts, err := analytics.GetCounts(context.Background(), db, profileA, time.Now().Add(-time.Hour))
	require.NoError(t, err)

	assert.Equal(t, int64(1), counts[analytics.EventProfileView])
}

func TestGetCounts_SinceWindow(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	profileID := setupProfile(t, db)

	// Insert an old event directly via SQL.
	_, err := db.Exec(context.Background(),
		`INSERT INTO analytics_events (event_type, profile_id, occurred_at)
		 VALUES ('profile_view', $1, now() - interval '2 hours')`,
		profileID,
	)
	require.NoError(t, err)

	// Insert a recent event via the API.
	require.NoError(t, analytics.RecordEvent(context.Background(), db, analytics.EventProfileView, profileID))

	// Only the last 1 hour — old event excluded.
	counts, err := analytics.GetCounts(context.Background(), db, profileID, time.Now().Add(-time.Hour))
	require.NoError(t, err)

	assert.Equal(t, int64(1), counts[analytics.EventProfileView])
}
