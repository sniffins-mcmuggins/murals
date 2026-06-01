package beta_test

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/beta"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

func jsonBody(s string) io.Reader { return strings.NewReader(s) }

func betaReq(t *testing.T, userID, method, path string) *http.Request {
	t.Helper()
	return httptest.NewRequestWithContext(
		auth.WithUserForTest(t.Context(), userID, false),
		method, path, nil,
	)
}

func TestAdminCreateInviteHandler_Creates(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	adminID, _, _ := testutil.CreateAdminUser(t, db)
	handler := beta.AdminCreateInviteHandler(db, "http://localhost:3000")

	r := httptest.NewRequestWithContext(
		auth.WithUserForTest(t.Context(), adminID, true),
		http.MethodPost, "/admin/beta/invites",
		jsonBody(`{"cohort":"founding","max_uses":5}`),
	)
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	require.Equal(t, http.StatusCreated, w.Code)
	var resp struct {
		Code    string `json:"code"`
		Link    string `json:"link"`
		MaxUses int    `json:"max_uses"`
	}
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	assert.NotEmpty(t, resp.Code)
	assert.Contains(t, resp.Link, "/signup?invite=")
	assert.Contains(t, resp.Link, resp.Code)
	assert.Equal(t, 5, resp.MaxUses)
}

func TestAdminCreateInviteHandler_DefaultMaxUses(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	adminID, _, _ := testutil.CreateAdminUser(t, db)
	handler := beta.AdminCreateInviteHandler(db, "http://localhost:3000")

	r := httptest.NewRequestWithContext(
		auth.WithUserForTest(t.Context(), adminID, true),
		http.MethodPost, "/admin/beta/invites",
		jsonBody(`{"cohort":"founding"}`),
	)
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	require.Equal(t, http.StatusCreated, w.Code)
	var resp struct {
		MaxUses int `json:"max_uses"`
	}
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	assert.Equal(t, 3, resp.MaxUses)
}

func TestAdminListInvitesHandler(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	adminID, _, _ := testutil.CreateAdminUser(t, db)
	createH := beta.AdminCreateInviteHandler(db, "http://localhost:3000")

	for i := 0; i < 2; i++ {
		r := httptest.NewRequestWithContext(
			auth.WithUserForTest(t.Context(), adminID, true),
			http.MethodPost, "/admin/beta/invites",
			jsonBody(`{"cohort":"founding"}`),
		)
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		createH.ServeHTTP(w, r)
		require.Equal(t, http.StatusCreated, w.Code)
	}

	listH := beta.AdminListInvitesHandler(db)
	r := httptest.NewRequestWithContext(
		auth.WithUserForTest(t.Context(), adminID, true),
		http.MethodGet, "/admin/beta/invites", nil,
	)
	w := httptest.NewRecorder()
	listH.ServeHTTP(w, r)

	require.Equal(t, http.StatusOK, w.Code)
	var resp []map[string]interface{}
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	assert.GreaterOrEqual(t, len(resp), 2)
}

func TestMintInviteHandler_BetaMemberCanMint(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	memberID := testutil.CreateBetaUser(t, db)
	handler := beta.MintInviteHandler(db, "http://localhost:3000")

	r := betaReq(t, memberID, http.MethodPost, "/beta/invites")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	require.Equal(t, http.StatusCreated, w.Code)
	var resp struct {
		Code string `json:"code"`
		Link string `json:"link"`
	}
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	assert.NotEmpty(t, resp.Code)
	assert.Contains(t, resp.Link, resp.Code)
}

func TestMintInviteHandler_QuotaEnforced(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	memberID := testutil.CreateBetaUser(t, db)
	handler := beta.MintInviteHandler(db, "http://localhost:3000")

	// Mint up to the default quota of 3.
	for i := 0; i < 3; i++ {
		r := betaReq(t, memberID, http.MethodPost, "/beta/invites")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		require.Equal(t, http.StatusCreated, w.Code, "mint %d should succeed", i+1)
	}

	// 4th mint should be rejected.
	r := betaReq(t, memberID, http.MethodPost, "/beta/invites")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	assert.Equal(t, http.StatusForbidden, w.Code, "4th mint past quota should be 403")
}

func TestGetMyInvitesHandler(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	memberID := testutil.CreateBetaUser(t, db)
	mintH := beta.MintInviteHandler(db, "http://localhost:3000")
	getH := beta.GetMyInvitesHandler(db)

	for i := 0; i < 2; i++ {
		r := betaReq(t, memberID, http.MethodPost, "/beta/invites")
		w := httptest.NewRecorder()
		mintH.ServeHTTP(w, r)
		require.Equal(t, http.StatusCreated, w.Code)
	}

	r := betaReq(t, memberID, http.MethodGet, "/beta/me/invites")
	w := httptest.NewRecorder()
	getH.ServeHTTP(w, r)

	require.Equal(t, http.StatusOK, w.Code)
	var resp struct {
		Invites        []map[string]interface{} `json:"invites"`
		Invitees       []interface{}            `json:"invitees"`
		RemainingQuota int                      `json:"remaining_quota"`
	}
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	assert.Len(t, resp.Invites, 2)
	assert.Equal(t, 1, resp.RemainingQuota) // 3 quota - 2 minted = 1
}

func TestGetMyInvitesHandler_IsolatesPerMember(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	memberA := testutil.CreateBetaUser(t, db)
	memberB := testutil.CreateBetaUser(t, db)
	mintH := beta.MintInviteHandler(db, "http://localhost:3000")

	// Member A mints an invite.
	r := betaReq(t, memberA, http.MethodPost, "/beta/invites")
	w := httptest.NewRecorder()
	mintH.ServeHTTP(w, r)
	require.Equal(t, http.StatusCreated, w.Code)

	// Member B's list should be empty.
	getH := beta.GetMyInvitesHandler(db)
	r = betaReq(t, memberB, http.MethodGet, "/beta/me/invites")
	w = httptest.NewRecorder()
	getH.ServeHTTP(w, r)

	require.Equal(t, http.StatusOK, w.Code)
	var resp struct {
		Invites []interface{} `json:"invites"`
	}
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	assert.Empty(t, resp.Invites)
}
