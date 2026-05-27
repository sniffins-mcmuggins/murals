package billing_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/billing"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

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
		PasswordHash: "x",
		Role:         sqlcdb.UserRoleArtist,
	})
	require.NoError(t, err)

	middleware := billing.RequirePlan(db, "artist_pro")
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	handler := middleware(next)

	r := httptest.NewRequestWithContext(
		auth.WithUserForTest(t.Context(), uuid.UUID(user.ID.Bytes).String(), "artist"),
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
		PasswordHash: "x",
		Role:         sqlcdb.UserRoleArtist,
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
		auth.WithUserForTest(t.Context(), uuid.UUID(user.ID.Bytes).String(), "artist"),
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
		PasswordHash: "x",
		Role:         sqlcdb.UserRoleArtist,
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
		auth.WithUserForTest(t.Context(), uuid.UUID(user.ID.Bytes).String(), "artist"),
		http.MethodGet, "/", nil,
	)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	assert.Equal(t, http.StatusForbidden, w.Code)
}
