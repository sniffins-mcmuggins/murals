package admin_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/sniffins-mcmuggins/render/api/internal/admin"
	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

// adminCtx creates an admin context for test requests.
func adminCtx(t *testing.T, userID string) context.Context {
	return auth.WithUserForTest(t.Context(), userID, true)
}

func TestListUsersHandler_ReturnsUsers(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	q := sqlcdb.New(db)
	ctx := context.Background()

	suffix := uuid.NewString()
	_, err := q.CreateUser(ctx, sqlcdb.CreateUserParams{
		Email: "list-user-" + suffix + "@test", PasswordHash: ptr("x"),
	})
	require.NoError(t, err)

	adminUser, err := q.CreateUser(ctx, sqlcdb.CreateUserParams{
		Email: "admin-list-" + suffix + "@test", PasswordHash: ptr("x"),
	})
	require.NoError(t, err)

	handler := admin.ListUsersHandler(db)
	r := httptest.NewRequestWithContext(adminCtx(t, adminUser.ID.String()), http.MethodGet, "/admin/users", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	require.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	users, ok := resp["users"].([]any)
	require.True(t, ok)
	assert.GreaterOrEqual(t, len(users), 2)
}

func TestListUsersHandler_FiltersEmail(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	q := sqlcdb.New(db)
	ctx := context.Background()

	suffix := uuid.NewString()
	_, err := q.CreateUser(ctx, sqlcdb.CreateUserParams{
		Email: "filterme-" + suffix + "@test", PasswordHash: ptr("x"),
	})
	require.NoError(t, err)
	adminUser, err := q.CreateUser(ctx, sqlcdb.CreateUserParams{
		Email: "admin-filter-" + suffix + "@test", PasswordHash: ptr("x"),
	})
	require.NoError(t, err)

	handler := admin.ListUsersHandler(db)
	r := httptest.NewRequestWithContext(adminCtx(t, adminUser.ID.String()), http.MethodGet, "/admin/users?email=filterme-"+suffix, nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	require.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	users := resp["users"].([]any)
	assert.Len(t, users, 1)
}

func TestGetUserHandler_Returns200(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	q := sqlcdb.New(db)
	ctx := context.Background()

	suffix := uuid.NewString()
	target, err := q.CreateUser(ctx, sqlcdb.CreateUserParams{
		Email: "get-user-" + suffix + "@test", PasswordHash: ptr("x"),
	})
	require.NoError(t, err)
	adminUser, err := q.CreateUser(ctx, sqlcdb.CreateUserParams{
		Email: "admin-get-" + suffix + "@test", PasswordHash: ptr("x"),
	})
	require.NoError(t, err)

	rtr := chi.NewRouter()
	rtr.Get("/admin/users/{userID}", admin.GetUserHandler(db))
	req := httptest.NewRequestWithContext(adminCtx(t, adminUser.ID.String()), http.MethodGet, "/admin/users/"+target.ID.String(), nil)
	w := httptest.NewRecorder()
	rtr.ServeHTTP(w, req)

	require.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	assert.Equal(t, target.ID.String(), resp["id"])
}

func TestGetUserHandler_NotFound_Returns404(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	q := sqlcdb.New(db)
	adminUser, err := q.CreateUser(context.Background(), sqlcdb.CreateUserParams{
		Email: "admin-notfound-" + uuid.NewString() + "@test", PasswordHash: ptr("x"),
	})
	require.NoError(t, err)

	rtr := chi.NewRouter()
	rtr.Get("/admin/users/{userID}", admin.GetUserHandler(db))
	req := httptest.NewRequestWithContext(adminCtx(t, adminUser.ID.String()), http.MethodGet, "/admin/users/"+uuid.NewString(), nil)
	w := httptest.NewRecorder()
	rtr.ServeHTTP(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestTriggerPasswordResetHandler_Returns202(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	q := sqlcdb.New(db)
	ctx := context.Background()

	suffix := uuid.NewString()
	target, err := q.CreateUser(ctx, sqlcdb.CreateUserParams{
		Email: "pw-reset-target-" + suffix + "@test", PasswordHash: ptr("x"),
	})
	require.NoError(t, err)
	adminUser, err := q.CreateUser(ctx, sqlcdb.CreateUserParams{
		Email: "admin-pwreset-" + suffix + "@test", PasswordHash: ptr("x"),
	})
	require.NoError(t, err)

	noop := auth.NoopMailer{}
	rtr := chi.NewRouter()
	rtr.Post("/admin/users/{userID}/password-reset", admin.TriggerPasswordResetHandler(db, noop, "http://localhost:3000"))
	req := httptest.NewRequestWithContext(
		adminCtx(t, adminUser.ID.String()),
		http.MethodPost, "/admin/users/"+target.ID.String()+"/password-reset",
		strings.NewReader(""),
	)
	w := httptest.NewRecorder()
	rtr.ServeHTTP(w, req)

	assert.Equal(t, http.StatusAccepted, w.Code)
}
