package auth_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/config"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

func ptr[T any](v T) *T { return &v }

func TestSignupHandler_Success(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	handler := auth.SignupHandler(db, config.Config{})

	body := `{"email":"alice@example.com","password":"hunter2hunter"}`
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/auth/signup", bytes.NewBufferString(body))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, r)

	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
	var resp map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	assert.Equal(t, "alice@example.com", resp["email"])
	assert.Equal(t, false, resp["is_admin"])
	assert.Nil(t, resp["password_hash"], "password_hash must not appear in response")
}

func TestSignupHandler_DuplicateEmail(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	handler := auth.SignupHandler(db, config.Config{})

	body := `{"email":"bob@example.com","password":"hunter2hunter"}`
	for i := range 2 {
		r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/auth/signup", bytes.NewBufferString(body))
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if i == 0 {
			require.Equal(t, http.StatusCreated, w.Code, "first signup: %s", w.Body.String())
		} else {
			assert.Equal(t, http.StatusConflict, w.Code, "duplicate signup: %s", w.Body.String())
		}
	}
}

func TestSignupHandler_WeakPassword(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	handler := auth.SignupHandler(db, config.Config{})

	body := `{"email":"carol@example.com","password":"short"}`
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/auth/signup", bytes.NewBufferString(body))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, r)

	assert.Equal(t, http.StatusUnprocessableEntity, w.Code, w.Body.String())
}

func TestSignupHandler_InvalidEmail(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	handler := auth.SignupHandler(db, config.Config{})

	body := `{"email":"notanemail","password":"hunter2hunter"}`
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/auth/signup", bytes.NewBufferString(body))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, r)

	assert.Equal(t, http.StatusUnprocessableEntity, w.Code, w.Body.String())
}

func TestSignup_BetaModeOn_NoInviteCode_Returns403(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	cfg := config.Config{BetaMode: true}
	handler := auth.SignupHandler(db, cfg)

	body := `{"email":"nobeta@test.com","password":"password123"}`
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/auth/signup", strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	assert.Equal(t, http.StatusForbidden, w.Code)
}

func TestSignup_BetaModeOn_InvalidInviteCode_Returns403(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	cfg := config.Config{BetaMode: true}
	handler := auth.SignupHandler(db, cfg)

	body := `{"email":"badinvite@test.com","password":"password123","invite_code":"nonexistent-code"}`
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/auth/signup", strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	assert.Equal(t, http.StatusForbidden, w.Code)
}

func TestSignup_BetaModeOn_ValidInvite_SetsBetaFields(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	ctx := context.Background()

	q := sqlcdb.New(db)
	inviter, err := q.CreateUser(ctx, sqlcdb.CreateUserParams{
		Email: "inviter-" + uuid.NewString() + "@test", PasswordHash: ptr("x"),
	})
	require.NoError(t, err)
	_, err = db.Exec(ctx, "UPDATE users SET is_beta = true WHERE id = $1", inviter.ID)
	require.NoError(t, err)

	invite, err := q.CreateBetaInvite(ctx, sqlcdb.CreateBetaInviteParams{
		Code:      "TESTCODE-" + uuid.NewString()[:8],
		CreatedBy: inviter.ID,
		MaxUses:   3,
		Cohort:    "founding",
		ExpiresAt: pgtype.Timestamptz{Valid: false},
	})
	require.NoError(t, err)

	cfg := config.Config{BetaMode: true}
	handler := auth.SignupHandler(db, cfg)

	testEmail := "newbeta-" + uuid.NewString()[:8] + "@test.com"
	body := `{"email":"` + testEmail + `","password":"password123","invite_code":"` + invite.Code + `"}`
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/auth/signup", strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	assert.Equal(t, http.StatusCreated, w.Code)

	var isBeta bool
	var betaCohort *string
	var invitedBy, invitedVia pgtype.UUID
	err = db.QueryRow(ctx,
		`SELECT is_beta, beta_cohort, invited_by, invited_via FROM users WHERE email = $1`,
		testEmail,
	).Scan(&isBeta, &betaCohort, &invitedBy, &invitedVia)
	require.NoError(t, err)
	assert.True(t, isBeta)
	require.NotNil(t, betaCohort)
	assert.Equal(t, "founding", *betaCohort)
	assert.Equal(t, inviter.ID, invitedBy)
	assert.Equal(t, invite.ID, invitedVia)

	var used int32
	err = db.QueryRow(ctx, `SELECT used_count FROM beta_invites WHERE id = $1`, invite.ID).Scan(&used)
	require.NoError(t, err)
	assert.Equal(t, int32(1), used)
}
