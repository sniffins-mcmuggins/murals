package admin_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/sniffins-mcmuggins/render/api/internal/admin"
	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

const testSecret = testutil.TestSecret

// createAdminUser creates an admin user with MFA enabled and returns (userID, token).
func createAdminUser(t *testing.T, db *pgxpool.Pool) (string, string) {
	t.Helper()
	q := sqlcdb.New(db)
	ctx := context.Background()

	// Create the user
	user, err := q.CreateUser(ctx, sqlcdb.CreateUserParams{
		Email:        "admin-" + uuid.NewString() + "@test",
		PasswordHash: ptr("x"),
	})
	require.NoError(t, err)

	// Set is_admin = true
	_, err = db.Exec(ctx, "UPDATE users SET is_admin = true WHERE id = $1", user.ID)
	require.NoError(t, err)

	// Enable MFA
	_, err = q.SetMFAEnabled(ctx, sqlcdb.SetMFAEnabledParams{
		ID:         user.ID,
		MfaEnabled: true,
		MfaSecret:  ptr("fake-secret"),
	})
	require.NoError(t, err)

	// Issue a JWT token
	token, err := auth.IssueToken(user.ID.String(), true, user.SessionVersion, testSecret)
	require.NoError(t, err)

	return user.ID.String(), token
}

func TestCreateProspectHandler_Success(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	_, adminToken := createAdminUser(t, db)

	body := `{
		"display_name": "Street Artist",
		"bio": "I paint walls.",
		"location_label": "Cheltenham, UK",
		"medium_tags": ["mural", "stencil"],
		"social_links": {"instagram": "https://instagram.com/street"},
		"images": []
	}`

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Use(admin.RequireAdmin(db))
	r.Post("/admin/prospects", admin.CreateProspectHandler(db))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := testutil.DoRequest(t, srv, http.MethodPost, "/admin/prospects", body, adminToken)
	defer func() { _ = resp.Body.Close() }()

	require.Equal(t, http.StatusCreated, resp.StatusCode)
	var result map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&result))
	assert.NotEmpty(t, result["profile_id"])
	assert.NotEmpty(t, result["claim_token"])
	assert.NotEmpty(t, result["preview_url"])
}

func TestCreateProspectHandler_MissingDisplayName(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	_, adminToken := createAdminUser(t, db)

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Use(admin.RequireAdmin(db))
	r.Post("/admin/prospects", admin.CreateProspectHandler(db))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := testutil.DoRequest(t, srv, http.MethodPost, "/admin/prospects", `{"bio":"no name"}`, adminToken)
	defer func() { _ = resp.Body.Close() }()

	assert.Equal(t, http.StatusUnprocessableEntity, resp.StatusCode)
}

func TestCreateProspectHandler_Unauthenticated(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Use(admin.RequireAdmin(db))
	r.Post("/admin/prospects", admin.CreateProspectHandler(db))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := testutil.DoRequest(t, srv, http.MethodPost, "/admin/prospects", `{}`, "")
	defer func() { _ = resp.Body.Close() }()

	assert.Equal(t, http.StatusUnauthorized, resp.StatusCode)
}

func TestCreateProspectHandler_NonAdmin(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	_, userToken, _ := testutil.CreateUser(t, db)

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Use(admin.RequireAdmin(db))
	r.Post("/admin/prospects", admin.CreateProspectHandler(db))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	resp := testutil.DoRequest(t, srv, http.MethodPost, "/admin/prospects", `{}`, userToken)
	defer func() { _ = resp.Body.Close() }()

	assert.Equal(t, http.StatusForbidden, resp.StatusCode)
}

func TestCreateProspectHandler_IdempotentByName(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	_, adminToken := createAdminUser(t, db)

	r := chi.NewRouter()
	r.Use(auth.Middleware(db, testSecret))
	r.Use(admin.RequireAdmin(db))
	r.Post("/admin/prospects", admin.CreateProspectHandler(db))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	body := `{"display_name":"Idempotent Artist","bio":"","images":[]}`

	resp1 := testutil.DoRequest(t, srv, http.MethodPost, "/admin/prospects", body, adminToken)
	defer func() { _ = resp1.Body.Close() }()
	require.Equal(t, http.StatusCreated, resp1.StatusCode)
	var r1 map[string]any
	require.NoError(t, json.NewDecoder(resp1.Body).Decode(&r1))

	time.Sleep(2 * time.Millisecond)

	resp2 := testutil.DoRequest(t, srv, http.MethodPost, "/admin/prospects", body, adminToken)
	defer func() { _ = resp2.Body.Close() }()
	require.Equal(t, http.StatusCreated, resp2.StatusCode)
	var r2 map[string]any
	require.NoError(t, json.NewDecoder(resp2.Body).Decode(&r2))

	assert.Equal(t, r1["profile_id"], r2["profile_id"])
}
