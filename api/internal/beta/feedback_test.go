package beta_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/beta"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

func TestSubmitFeedbackHandler_Accepts(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	memberID := testutil.CreateBetaUser(t, db)
	handler := beta.SubmitFeedbackHandler(db)

	r := httptest.NewRequestWithContext(
		auth.WithUserForTest(t.Context(), memberID, false),
		http.MethodPost, "/beta/feedback",
		jsonBody(`{"kind":"idea","body":"Add dark mode"}`),
	)
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	require.Equal(t, http.StatusCreated, w.Code)
	var resp struct {
		ID   string `json:"id"`
		Kind string `json:"kind"`
		Body string `json:"body"`
	}
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	assert.NotEmpty(t, resp.ID)
	assert.Equal(t, "idea", resp.Kind)
	assert.Equal(t, "Add dark mode", resp.Body)
}

func TestSubmitFeedbackHandler_InvalidKind(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	memberID := testutil.CreateBetaUser(t, db)
	handler := beta.SubmitFeedbackHandler(db)

	r := httptest.NewRequestWithContext(
		auth.WithUserForTest(t.Context(), memberID, false),
		http.MethodPost, "/beta/feedback",
		jsonBody(`{"kind":"spam","body":"hello"}`),
	)
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	assert.Equal(t, http.StatusUnprocessableEntity, w.Code)
}

func TestSubmitFeedbackHandler_MissingBody(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	memberID := testutil.CreateBetaUser(t, db)
	handler := beta.SubmitFeedbackHandler(db)

	r := httptest.NewRequestWithContext(
		auth.WithUserForTest(t.Context(), memberID, false),
		http.MethodPost, "/beta/feedback",
		jsonBody(`{"kind":"bug"}`),
	)
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	assert.Equal(t, http.StatusUnprocessableEntity, w.Code)
}

func TestGetMyFeedbackHandler_ReturnsOwnFeedback(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	memberID := testutil.CreateBetaUser(t, db)
	submitH := beta.SubmitFeedbackHandler(db)
	getH := beta.GetMyFeedbackHandler(db)

	for _, body := range []string{
		`{"kind":"idea","body":"First idea"}`,
		`{"kind":"bug","body":"Found a bug"}`,
	} {
		r := httptest.NewRequestWithContext(
			auth.WithUserForTest(t.Context(), memberID, false),
			http.MethodPost, "/beta/feedback", jsonBody(body),
		)
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		submitH.ServeHTTP(w, r)
		require.Equal(t, http.StatusCreated, w.Code)
	}

	r := httptest.NewRequestWithContext(
		auth.WithUserForTest(t.Context(), memberID, false),
		http.MethodGet, "/beta/feedback", nil,
	)
	w := httptest.NewRecorder()
	getH.ServeHTTP(w, r)

	require.Equal(t, http.StatusOK, w.Code)
	var resp []map[string]interface{}
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	assert.Len(t, resp, 2)
}

func TestGetMyFeedbackHandler_IDOR_CannotSeeOthersFeedback(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	memberA := testutil.CreateBetaUser(t, db)
	memberB := testutil.CreateBetaUser(t, db)
	submitH := beta.SubmitFeedbackHandler(db)
	getH := beta.GetMyFeedbackHandler(db)

	// Member A submits feedback.
	r := httptest.NewRequestWithContext(
		auth.WithUserForTest(t.Context(), memberA, false),
		http.MethodPost, "/beta/feedback",
		jsonBody(`{"kind":"praise","body":"Love it"}`),
	)
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	submitH.ServeHTTP(w, r)
	require.Equal(t, http.StatusCreated, w.Code)

	// Member B sees nothing.
	r = httptest.NewRequestWithContext(
		auth.WithUserForTest(t.Context(), memberB, false),
		http.MethodGet, "/beta/feedback", nil,
	)
	w = httptest.NewRecorder()
	getH.ServeHTTP(w, r)

	require.Equal(t, http.StatusOK, w.Code)
	var resp []map[string]interface{}
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	assert.Empty(t, resp)
}

func TestAdminListFeedbackHandler_ReturnsAll(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	memberA := testutil.CreateBetaUser(t, db)
	memberB := testutil.CreateBetaUser(t, db)
	adminID, _, _ := testutil.CreateAdminUser(t, db)
	submitH := beta.SubmitFeedbackHandler(db)

	for _, tc := range []struct {
		uid  string
		body string
	}{
		{memberA, `{"kind":"idea","body":"Idea from A"}`},
		{memberB, `{"kind":"bug","body":"Bug from B"}`},
	} {
		r := httptest.NewRequestWithContext(
			auth.WithUserForTest(t.Context(), tc.uid, false),
			http.MethodPost, "/beta/feedback", jsonBody(tc.body),
		)
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		submitH.ServeHTTP(w, r)
		require.Equal(t, http.StatusCreated, w.Code)
	}

	listH := beta.AdminListFeedbackHandler(db)
	r := httptest.NewRequestWithContext(
		auth.WithUserForTest(t.Context(), adminID, true),
		http.MethodGet, "/admin/beta/feedback", nil,
	)
	w := httptest.NewRecorder()
	listH.ServeHTTP(w, r)

	require.Equal(t, http.StatusOK, w.Code)
	var resp []map[string]interface{}
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	assert.GreaterOrEqual(t, len(resp), 2)
}

func TestAdminUpdateFeedbackHandler_AddsNote(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	memberID := testutil.CreateBetaUser(t, db)
	adminID, _, _ := testutil.CreateAdminUser(t, db)
	submitH := beta.SubmitFeedbackHandler(db)

	// Submit feedback.
	r := httptest.NewRequestWithContext(
		auth.WithUserForTest(t.Context(), memberID, false),
		http.MethodPost, "/beta/feedback",
		jsonBody(`{"kind":"direction","body":"What about maps?"}`),
	)
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	submitH.ServeHTTP(w, r)
	require.Equal(t, http.StatusCreated, w.Code)

	var created struct {
		ID string `json:"id"`
	}
	require.NoError(t, json.NewDecoder(w.Body).Decode(&created))

	// Admin adds a note via chi router (needed for path param injection).
	rtr := chi.NewRouter()
	rtr.Patch("/admin/beta/feedback/{feedbackID}", beta.AdminUpdateFeedbackHandler(db))

	req := httptest.NewRequestWithContext(
		auth.WithUserForTest(t.Context(), adminID, true),
		http.MethodPatch, "/admin/beta/feedback/"+created.ID,
		jsonBody(`{"admin_note":"Great idea, tracking in E17"}`),
	)
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	rtr.ServeHTTP(w, req)

	require.Equal(t, http.StatusOK, w.Code)
	var resp struct {
		AdminNote *string `json:"admin_note"`
	}
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	require.NotNil(t, resp.AdminNote)
	assert.Equal(t, "Great idea, tracking in E17", *resp.AdminNote)
}
