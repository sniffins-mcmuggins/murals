package admin_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/sniffins-mcmuggins/render/api/internal/admin"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

func TestCreateGrantHandler_Returns201(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	q := sqlcdb.New(db)
	ctx := context.Background()

	suffix := uuid.NewString()
	target, err := q.CreateUser(ctx, sqlcdb.CreateUserParams{
		Email: "grant-target-" + suffix + "@test", PasswordHash: ptr("x"),
	})
	require.NoError(t, err)
	adminUser, err := q.CreateUser(ctx, sqlcdb.CreateUserParams{
		Email: "admin-grant-" + suffix + "@test", PasswordHash: ptr("x"),
	})
	require.NoError(t, err)

	body, _ := json.Marshal(map[string]any{
		"plan": "artist_pro", "duration_days": 90, "note": "test grant",
	})
	r := chi.NewRouter()
	r.Post("/admin/users/{userID}/grants", admin.CreateGrantHandler(db))
	req := httptest.NewRequestWithContext(
		adminCtx(t, adminUser.ID.String()),
		http.MethodPost, "/admin/users/"+target.ID.String()+"/grants",
		bytes.NewReader(body),
	)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	require.Equal(t, http.StatusCreated, w.Code)
	var resp map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	assert.Equal(t, "artist_pro", resp["plan"])
	assert.NotEmpty(t, resp["id"])
}

func TestCreateGrantHandler_InvalidPlan_Returns400(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	q := sqlcdb.New(db)
	ctx := context.Background()

	suffix := uuid.NewString()
	target, err := q.CreateUser(ctx, sqlcdb.CreateUserParams{
		Email: "grant-badplan-" + suffix + "@test", PasswordHash: ptr("x"),
	})
	require.NoError(t, err)
	adminUser, err := q.CreateUser(ctx, sqlcdb.CreateUserParams{
		Email: "admin-badplan-" + suffix + "@test", PasswordHash: ptr("x"),
	})
	require.NoError(t, err)

	body, _ := json.Marshal(map[string]any{"plan": "not_a_real_plan", "duration_days": 30})
	r := chi.NewRouter()
	r.Post("/admin/users/{userID}/grants", admin.CreateGrantHandler(db))
	req := httptest.NewRequestWithContext(
		adminCtx(t, adminUser.ID.String()),
		http.MethodPost, "/admin/users/"+target.ID.String()+"/grants",
		bytes.NewReader(body),
	)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestRevokeGrantHandler_Returns204(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	q := sqlcdb.New(db)
	ctx := context.Background()

	target, err := q.CreateUser(ctx, sqlcdb.CreateUserParams{
		Email: "revoke-user-" + uuid.NewString() + "@test", PasswordHash: ptr("x"),
	})
	require.NoError(t, err)
	adminUser, err := q.CreateUser(ctx, sqlcdb.CreateUserParams{
		Email: "admin-revoke-" + uuid.NewString() + "@test", PasswordHash: ptr("x"),
	})
	require.NoError(t, err)

	grant, err := q.CreateAccessGrant(ctx, sqlcdb.CreateAccessGrantParams{
		UserID:     target.ID,
		Plan:       "artist_pro",
		ValidUntil: pgtype.Timestamptz{Time: time.Now().Add(30 * 24 * time.Hour), Valid: true},
	})
	require.NoError(t, err)

	r := chi.NewRouter()
	r.Delete("/admin/grants/{grantID}", admin.RevokeGrantHandler(db))
	req := httptest.NewRequestWithContext(
		adminCtx(t, adminUser.ID.String()),
		http.MethodDelete, "/admin/grants/"+grant.ID.String(), nil,
	)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusNoContent, w.Code)
}
