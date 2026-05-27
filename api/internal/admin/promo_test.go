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
	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

// createPromoAdminUser creates a plain user suitable for use as admin in promo tests.
func createPromoAdminUser(t *testing.T, q *sqlcdb.Queries, suffix string) sqlcdb.User {
	t.Helper()
	u, err := q.CreateUser(context.Background(), sqlcdb.CreateUserParams{
		Email: "promo-admin-" + suffix + "@test", PasswordHash: ptr("x"),
	})
	require.NoError(t, err)
	return u
}

// createPromoArtistUser creates a plain user suitable for use as an artist in promo tests.
func createPromoArtistUser(t *testing.T, q *sqlcdb.Queries, suffix string) sqlcdb.User {
	t.Helper()
	u, err := q.CreateUser(context.Background(), sqlcdb.CreateUserParams{
		Email: "promo-artist-" + suffix + "@test", PasswordHash: ptr("x"),
	})
	require.NoError(t, err)
	return u
}

func TestCreatePromoCodeHandler_Returns201(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	q := sqlcdb.New(db)

	suffix := uuid.NewString()
	adminUser := createPromoAdminUser(t, q, suffix)

	body, _ := json.Marshal(map[string]any{
		"code":          "FEST2027-" + suffix[:8],
		"plan":          "artist_pro",
		"duration_days": 90,
	})

	rtr := chi.NewRouter()
	rtr.Post("/admin/promo-codes", admin.CreatePromoCodeHandler(db))
	req := httptest.NewRequestWithContext(
		adminCtx(t, adminUser.ID.String()),
		http.MethodPost, "/admin/promo-codes",
		bytes.NewReader(body),
	)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	rtr.ServeHTTP(w, req)

	require.Equal(t, http.StatusCreated, w.Code)
	var resp map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	assert.NotEmpty(t, resp["id"])
	assert.Equal(t, "artist_pro", resp["plan"])
	assert.Equal(t, float64(90), resp["duration_days"])
}

func TestCreatePromoCodeHandler_DuplicateCode_Returns409(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	q := sqlcdb.New(db)

	suffix := uuid.NewString()
	adminUser := createPromoAdminUser(t, q, suffix)
	code := "DUPE-" + suffix[:8]

	rtr := chi.NewRouter()
	rtr.Post("/admin/promo-codes", admin.CreatePromoCodeHandler(db))

	// First creation — must succeed.
	body, _ := json.Marshal(map[string]any{
		"code":          code,
		"plan":          "artist_basic",
		"duration_days": 30,
	})
	req := httptest.NewRequestWithContext(
		adminCtx(t, adminUser.ID.String()),
		http.MethodPost, "/admin/promo-codes",
		bytes.NewReader(body),
	)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	rtr.ServeHTTP(w, req)
	require.Equal(t, http.StatusCreated, w.Code)

	// Second creation with the same code — must return 409.
	body2, _ := json.Marshal(map[string]any{
		"code":          code,
		"plan":          "artist_basic",
		"duration_days": 30,
	})
	req2 := httptest.NewRequestWithContext(
		adminCtx(t, adminUser.ID.String()),
		http.MethodPost, "/admin/promo-codes",
		bytes.NewReader(body2),
	)
	req2.Header.Set("Content-Type", "application/json")
	w2 := httptest.NewRecorder()
	rtr.ServeHTTP(w2, req2)
	assert.Equal(t, http.StatusConflict, w2.Code)
}

func TestRevokePromoCodeHandler_Returns204(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	q := sqlcdb.New(db)

	suffix := uuid.NewString()
	adminUser := createPromoAdminUser(t, q, suffix)

	pc, err := q.CreatePromoCode(context.Background(), sqlcdb.CreatePromoCodeParams{
		Code:         "REVOKE-" + suffix[:8],
		Plan:         "artist_basic",
		DurationDays: 30,
		CreatedBy:    adminUser.ID,
	})
	require.NoError(t, err)

	rtr := chi.NewRouter()
	rtr.Delete("/admin/promo-codes/{codeID}", admin.RevokePromoCodeHandler(db))
	req := httptest.NewRequestWithContext(
		adminCtx(t, adminUser.ID.String()),
		http.MethodDelete, "/admin/promo-codes/"+pc.ID.String(), nil,
	)
	w := httptest.NewRecorder()
	rtr.ServeHTTP(w, req)

	assert.Equal(t, http.StatusNoContent, w.Code)
}

func TestListPromoCodesHandler_Returns200(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	q := sqlcdb.New(db)

	suffix := uuid.NewString()
	adminUser := createPromoAdminUser(t, q, suffix)

	_, err := q.CreatePromoCode(context.Background(), sqlcdb.CreatePromoCodeParams{
		Code:         "LIST-" + suffix[:8],
		Plan:         "artist_basic",
		DurationDays: 30,
		CreatedBy:    adminUser.ID,
	})
	require.NoError(t, err)

	rtr := chi.NewRouter()
	rtr.Get("/admin/promo-codes", admin.ListPromoCodesHandler(db))
	req := httptest.NewRequestWithContext(
		adminCtx(t, adminUser.ID.String()),
		http.MethodGet, "/admin/promo-codes", nil,
	)
	w := httptest.NewRecorder()
	rtr.ServeHTTP(w, req)

	require.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	codes, ok := resp["promo_codes"].([]any)
	require.True(t, ok)
	assert.GreaterOrEqual(t, len(codes), 1)
}

func TestRedeemPromoHandler_ValidCode_Returns200(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	q := sqlcdb.New(db)

	suffix := uuid.NewString()
	adminUser := createPromoAdminUser(t, q, suffix)
	artistUser := createPromoArtistUser(t, q, suffix)

	pc, err := q.CreatePromoCode(context.Background(), sqlcdb.CreatePromoCodeParams{
		Code:         "VALID-" + suffix[:8],
		Plan:         "artist_pro",
		DurationDays: 90,
		CreatedBy:    adminUser.ID,
	})
	require.NoError(t, err)

	body, _ := json.Marshal(map[string]any{"code": pc.Code})

	rtr := chi.NewRouter()
	rtr.Post("/promo/redeem", admin.RedeemPromoHandler(db))
	req := httptest.NewRequestWithContext(
		auth.WithUserForTest(t.Context(), artistUser.ID.String(), false),
		http.MethodPost, "/promo/redeem",
		bytes.NewReader(body),
	)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	rtr.ServeHTTP(w, req)

	require.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	assert.NotEmpty(t, resp["id"])
	assert.Equal(t, "artist_pro", resp["plan"])
}

func TestRedeemPromoHandler_AlreadyRedeemed_Returns409(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	q := sqlcdb.New(db)
	ctx := context.Background()

	suffix := uuid.NewString()
	adminUser := createPromoAdminUser(t, q, suffix)
	artistUser := createPromoArtistUser(t, q, suffix)

	pc, err := q.CreatePromoCode(ctx, sqlcdb.CreatePromoCodeParams{
		Code:         "ALREADY-" + suffix[:8],
		Plan:         "artist_pro",
		DurationDays: 90,
		CreatedBy:    adminUser.ID,
	})
	require.NoError(t, err)

	// Pre-create a redemption so the code is already redeemed by this user.
	_, err = q.CreateAccessGrant(ctx, sqlcdb.CreateAccessGrantParams{
		UserID:      artistUser.ID,
		Plan:        pc.Plan,
		ValidUntil:  pgtype.Timestamptz{Time: time.Now().Add(90 * 24 * time.Hour), Valid: true},
		GrantedBy:   pgtype.UUID{},
		PromoCodeID: pc.ID,
	})
	require.NoError(t, err)

	body, _ := json.Marshal(map[string]any{"code": pc.Code})

	rtr := chi.NewRouter()
	rtr.Post("/promo/redeem", admin.RedeemPromoHandler(db))
	req := httptest.NewRequestWithContext(
		auth.WithUserForTest(t.Context(), artistUser.ID.String(), false),
		http.MethodPost, "/promo/redeem",
		bytes.NewReader(body),
	)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	rtr.ServeHTTP(w, req)

	assert.Equal(t, http.StatusConflict, w.Code)
}

func TestRedeemPromoHandler_RevokedCode_Returns410(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	q := sqlcdb.New(db)
	ctx := context.Background()

	suffix := uuid.NewString()
	adminUser := createPromoAdminUser(t, q, suffix)
	artistUser := createPromoArtistUser(t, q, suffix)

	pc, err := q.CreatePromoCode(ctx, sqlcdb.CreatePromoCodeParams{
		Code:         "REVD-" + suffix[:8],
		Plan:         "artist_basic",
		DurationDays: 30,
		CreatedBy:    adminUser.ID,
	})
	require.NoError(t, err)

	// Revoke the promo code.
	err = q.RevokePromoCode(ctx, pc.ID)
	require.NoError(t, err)

	body, _ := json.Marshal(map[string]any{"code": pc.Code})

	rtr := chi.NewRouter()
	rtr.Post("/promo/redeem", admin.RedeemPromoHandler(db))
	req := httptest.NewRequestWithContext(
		auth.WithUserForTest(t.Context(), artistUser.ID.String(), false),
		http.MethodPost, "/promo/redeem",
		bytes.NewReader(body),
	)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	rtr.ServeHTTP(w, req)

	assert.Equal(t, http.StatusGone, w.Code)
}

func TestRedeemPromoHandler_MaxUsesExceeded_Returns409(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	q := sqlcdb.New(db)
	ctx := context.Background()

	suffix := uuid.NewString()
	adminUser := createPromoAdminUser(t, q, suffix)
	artistUser := createPromoArtistUser(t, q, suffix)

	maxUses := int32(1)
	pc, err := q.CreatePromoCode(ctx, sqlcdb.CreatePromoCodeParams{
		Code:         "MAXUSE-" + suffix[:8],
		Plan:         "artist_basic",
		DurationDays: 30,
		MaxUses:      &maxUses,
		CreatedBy:    adminUser.ID,
	})
	require.NoError(t, err)

	// Use up the one slot by setting use_count = max_uses directly.
	_, err = db.Exec(ctx, "UPDATE promo_codes SET use_count = max_uses WHERE id = $1", pc.ID)
	require.NoError(t, err)

	body, _ := json.Marshal(map[string]any{"code": pc.Code})

	rtr := chi.NewRouter()
	rtr.Post("/promo/redeem", admin.RedeemPromoHandler(db))
	req := httptest.NewRequestWithContext(
		auth.WithUserForTest(t.Context(), artistUser.ID.String(), false),
		http.MethodPost, "/promo/redeem",
		bytes.NewReader(body),
	)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	rtr.ServeHTTP(w, req)

	assert.Equal(t, http.StatusConflict, w.Code)
}
