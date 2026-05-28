package billing_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	pgtype "github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/billing"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

func ptr[T any](v T) *T { return &v }

func TestRequirePlan_Unauthenticated_Returns401(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	middleware := billing.RequirePlan(db, "artist_pro")

	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	handler := middleware(next)

	r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	assert.Equal(t, http.StatusUnauthorized, w.Code, "no principal in context must 401, not 403")
}

func TestRequirePlan_NoSubscription_Returns403UpgradeRequired(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	q := sqlcdb.New(db)

	user, err := q.CreateUser(context.Background(), sqlcdb.CreateUserParams{
		Email:        "no-sub-" + uuid.NewString() + "@test",
		PasswordHash: ptr("x"),
	})
	require.NoError(t, err)

	middleware := billing.RequirePlan(db, "artist_pro")
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	handler := middleware(next)

	r := httptest.NewRequestWithContext(
		auth.WithUserForTest(t.Context(), uuid.UUID(user.ID.Bytes).String(), user.IsAdmin),
		http.MethodGet, "/", nil,
	)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	assert.Equal(t, http.StatusForbidden, w.Code)
	var body map[string]string
	require.NoError(t, json.NewDecoder(w.Body).Decode(&body))
	assert.Equal(t, "upgrade_required", body["code"])
}

func TestRequirePlan_ActiveProSub_PassesThrough(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	q := sqlcdb.New(db)
	ctx := context.Background()

	user, err := q.CreateUser(ctx, sqlcdb.CreateUserParams{
		Email:        "pro-" + uuid.NewString() + "@test",
		PasswordHash: ptr("x"),
	})
	require.NoError(t, err)

	subID := "sub_test_" + uuid.NewString()
	_, err = q.UpsertSubscription(ctx, sqlcdb.UpsertSubscriptionParams{
		UserID:               user.ID,
		FestivalID:           pgtype.UUID{},
		StripeSubscriptionID: &subID,
		StripePriceID:        "price_test",
		Plan:                 "artist_pro",
		BillingInterval:      "year",
		Status:               "active",
		CurrentPeriodEnd:     pgtype.Timestamptz{},
	})
	require.NoError(t, err)

	middleware := billing.RequirePlan(db, "artist_pro")
	called := false
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})
	handler := middleware(next)

	r := httptest.NewRequestWithContext(
		auth.WithUserForTest(t.Context(), uuid.UUID(user.ID.Bytes).String(), user.IsAdmin),
		http.MethodGet, "/", nil,
	)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	assert.True(t, called, "next handler should be invoked when subscription satisfies plan")
	assert.Equal(t, http.StatusOK, w.Code)
}

func TestRequirePlan_BasicSubFailsWhenProRequired(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	q := sqlcdb.New(db)
	ctx := context.Background()

	user, err := q.CreateUser(ctx, sqlcdb.CreateUserParams{
		Email:        "basic-" + uuid.NewString() + "@test",
		PasswordHash: ptr("x"),
	})
	require.NoError(t, err)

	subID := "sub_test_" + uuid.NewString()
	_, err = q.UpsertSubscription(ctx, sqlcdb.UpsertSubscriptionParams{
		UserID:               user.ID,
		FestivalID:           pgtype.UUID{},
		StripeSubscriptionID: &subID,
		StripePriceID:        "price_test",
		Plan:                 "artist_basic",
		BillingInterval:      "year",
		Status:               "active",
		CurrentPeriodEnd:     pgtype.Timestamptz{},
	})
	require.NoError(t, err)

	middleware := billing.RequirePlan(db, "artist_pro")
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	handler := middleware(next)

	r := httptest.NewRequestWithContext(
		auth.WithUserForTest(t.Context(), uuid.UUID(user.ID.Bytes).String(), user.IsAdmin),
		http.MethodGet, "/", nil,
	)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	assert.Equal(t, http.StatusForbidden, w.Code)
}

func TestRequirePlan_InsufficientTier_WithGrant_PassesThrough(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	q := sqlcdb.New(db)
	ctx := context.Background()

	user, err := q.CreateUser(ctx, sqlcdb.CreateUserParams{
		Email:        "tier-upgrade-" + uuid.NewString() + "@test",
		PasswordHash: ptr("x"),
	})
	require.NoError(t, err)

	// Give user an artist_basic subscription (lower tier than required).
	subID := "sub_test_" + uuid.NewString()
	_, err = q.UpsertSubscription(ctx, sqlcdb.UpsertSubscriptionParams{
		UserID:               user.ID,
		FestivalID:           pgtype.UUID{},
		StripeSubscriptionID: &subID,
		StripePriceID:        "price_test",
		Plan:                 "artist_basic",
		BillingInterval:      "year",
		Status:               "active",
		CurrentPeriodEnd:     pgtype.Timestamptz{},
	})
	require.NoError(t, err)

	// Also give user an artist_pro grant (higher tier).
	_, err = q.CreateAccessGrant(ctx, sqlcdb.CreateAccessGrantParams{
		UserID:     user.ID,
		Plan:       "artist_pro",
		ValidUntil: pgtype.Timestamptz{Time: time.Now().Add(30 * 24 * time.Hour), Valid: true},
	})
	require.NoError(t, err)

	called := false
	handler := billing.RequirePlan(db, "artist_pro")(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))

	r := httptest.NewRequestWithContext(
		auth.WithUserForTest(t.Context(), uuid.UUID(user.ID.Bytes).String(), false),
		http.MethodGet, "/", nil,
	)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	assert.True(t, called, "artist_pro grant should pass even with only artist_basic subscription")
	assert.Equal(t, http.StatusOK, w.Code)
}

func TestRequirePlan_ActiveGrant_PassesThrough(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	q := sqlcdb.New(db)
	ctx := context.Background()

	user, err := q.CreateUser(ctx, sqlcdb.CreateUserParams{
		Email:        "grant-passes-" + uuid.NewString() + "@test",
		PasswordHash: ptr("x"),
	})
	require.NoError(t, err)

	_, err = q.CreateAccessGrant(ctx, sqlcdb.CreateAccessGrantParams{
		UserID:     user.ID,
		Plan:       "artist_pro",
		ValidUntil: pgtype.Timestamptz{Time: time.Now().Add(30 * 24 * time.Hour), Valid: true},
	})
	require.NoError(t, err)

	called := false
	handler := billing.RequirePlan(db, "artist_pro")(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))

	r := httptest.NewRequestWithContext(
		auth.WithUserForTest(t.Context(), uuid.UUID(user.ID.Bytes).String(), false),
		http.MethodGet, "/", nil,
	)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	assert.True(t, called, "active grant must let request through")
	assert.Equal(t, http.StatusOK, w.Code)
}

func TestRequirePlan_RevokedGrant_Returns403(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	q := sqlcdb.New(db)
	ctx := context.Background()

	user, err := q.CreateUser(ctx, sqlcdb.CreateUserParams{
		Email:        "grant-revoked-" + uuid.NewString() + "@test",
		PasswordHash: ptr("x"),
	})
	require.NoError(t, err)

	grant, err := q.CreateAccessGrant(ctx, sqlcdb.CreateAccessGrantParams{
		UserID:     user.ID,
		Plan:       "artist_pro",
		ValidUntil: pgtype.Timestamptz{Time: time.Now().Add(30 * 24 * time.Hour), Valid: true},
	})
	require.NoError(t, err)

	// Revoke it immediately.
	err = q.RevokeAccessGrant(ctx, grant.ID)
	require.NoError(t, err)

	handler := billing.RequirePlan(db, "artist_pro")(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	r := httptest.NewRequestWithContext(
		auth.WithUserForTest(t.Context(), uuid.UUID(user.ID.Bytes).String(), false),
		http.MethodGet, "/", nil,
	)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	assert.Equal(t, http.StatusForbidden, w.Code)
}
