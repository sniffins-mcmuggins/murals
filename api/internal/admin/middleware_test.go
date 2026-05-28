package admin_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/sniffins-mcmuggins/render/api/internal/admin"
	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

func ptr[T any](v T) *T { return &v }

func okHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
}

func TestRequireAdmin_Anonymous_Returns401(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	handler := admin.RequireAdmin(db)(okHandler())
	r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestRequireAdmin_ArtistRole_Returns403(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	q := sqlcdb.New(db)
	user, err := q.CreateUser(context.Background(), sqlcdb.CreateUserParams{
		Email: "artist-" + uuid.NewString() + "@test", PasswordHash: ptr("x"),
	})
	require.NoError(t, err)

	handler := admin.RequireAdmin(db)(okHandler())
	r := httptest.NewRequestWithContext(
		auth.WithUserForTest(t.Context(), user.ID.String(), false),
		http.MethodGet, "/", nil,
	)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	assert.Equal(t, http.StatusForbidden, w.Code)
}

func TestRequireAdmin_AdminWithoutMFA_Returns403(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	q := sqlcdb.New(db)
	ctx := context.Background()
	user, err := q.CreateUser(ctx, sqlcdb.CreateUserParams{
		Email: "admin-nomfa-" + uuid.NewString() + "@test", PasswordHash: ptr("x"),
	})
	require.NoError(t, err)
	// Set is_admin directly — CreateUserParams does not expose this field.
	_, err = db.Exec(ctx, "UPDATE users SET is_admin = true WHERE id = $1", user.ID)
	require.NoError(t, err)

	handler := admin.RequireAdmin(db)(okHandler())
	r := httptest.NewRequestWithContext(
		auth.WithUserForTest(t.Context(), user.ID.String(), true),
		http.MethodGet, "/", nil,
	)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	assert.Equal(t, http.StatusForbidden, w.Code)
}

func TestRequireAdmin_AdminWithMFA_PassesThrough(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	q := sqlcdb.New(db)
	ctx := context.Background()
	user, err := q.CreateUser(ctx, sqlcdb.CreateUserParams{
		Email: "admin-mfa-" + uuid.NewString() + "@test", PasswordHash: ptr("x"),
	})
	require.NoError(t, err)
	// Set is_admin directly — CreateUserParams does not expose this field.
	_, err = db.Exec(ctx, "UPDATE users SET is_admin = true WHERE id = $1", user.ID)
	require.NoError(t, err)
	_, err = q.SetMFAEnabled(ctx, sqlcdb.SetMFAEnabledParams{
		ID: user.ID, MfaEnabled: true, MfaSecret: ptr("fake-secret"),
	})
	require.NoError(t, err)

	called := false
	handler := admin.RequireAdmin(db)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))
	r := httptest.NewRequestWithContext(
		auth.WithUserForTest(t.Context(), user.ID.String(), true),
		http.MethodGet, "/", nil,
	)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	assert.True(t, called)
	assert.Equal(t, http.StatusOK, w.Code)
}
