package beta_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/beta"
	"github.com/sniffins-mcmuggins/render/api/internal/config"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

func ptr[T any](v T) *T { return &v }

func okHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
}

func TestGate_BetaModeOff_Passthrough(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	cfg := config.Config{BetaMode: false}

	handler := beta.Gate(cfg, db)(okHandler())
	r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	assert.Equal(t, http.StatusOK, w.Code)
}

func TestGate_BetaModeOn_Anonymous_Passthrough(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	cfg := config.Config{BetaMode: true}

	handler := beta.Gate(cfg, db)(okHandler())
	r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	assert.Equal(t, http.StatusOK, w.Code)
}

func TestGate_BetaModeOn_NonBetaUser_Returns403(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	q := sqlcdb.New(db)
	user, err := q.CreateUser(context.Background(), sqlcdb.CreateUserParams{
		Email: "nonbeta-" + uuid.NewString() + "@test", PasswordHash: ptr("x"),
	})
	require.NoError(t, err)

	cfg := config.Config{BetaMode: true}
	handler := beta.Gate(cfg, db)(okHandler())
	r := httptest.NewRequestWithContext(
		auth.WithUserForTest(t.Context(), user.ID.String(), false),
		http.MethodGet, "/", nil,
	)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	assert.Equal(t, http.StatusForbidden, w.Code)
}

func TestGate_BetaModeOn_BetaUser_Passthrough(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	q := sqlcdb.New(db)
	user, err := q.CreateUser(context.Background(), sqlcdb.CreateUserParams{
		Email: "beta-" + uuid.NewString() + "@test", PasswordHash: ptr("x"),
	})
	require.NoError(t, err)
	_, err = db.Exec(context.Background(), "UPDATE users SET is_beta = true WHERE id = $1", user.ID)
	require.NoError(t, err)

	cfg := config.Config{BetaMode: true}
	handler := beta.Gate(cfg, db)(okHandler())
	r := httptest.NewRequestWithContext(
		auth.WithUserForTest(t.Context(), user.ID.String(), false),
		http.MethodGet, "/", nil,
	)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	assert.Equal(t, http.StatusOK, w.Code)
}
