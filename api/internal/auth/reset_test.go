package auth_test

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

type stubSender struct {
	mu   sync.Mutex
	sent []string
}

func (s *stubSender) Send(_ context.Context, to, _, _ string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sent = append(s.sent, to)
	return nil
}

func (s *stubSender) getSent() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string{}, s.sent...)
}

func TestForgotPassword_KnownEmail(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	email := createTestUser(t, db, "password123")
	sender := &stubSender{}
	handler := auth.ForgotPasswordHandler(db, sender, "")

	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/auth/forgot-password",
		bytes.NewBufferString(fmt.Sprintf(`{"email":%q}`, email)))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	assert.Equal(t, http.StatusAccepted, w.Code)
	// Email is sent in a goroutine — give it a moment
	require.Eventually(t, func() bool { return len(sender.getSent()) == 1 }, 2*time.Second, 50*time.Millisecond)
	assert.Equal(t, email, sender.getSent()[0])
}

func TestForgotPassword_UnknownEmail_StillAccepted(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sender := &stubSender{}
	handler := auth.ForgotPasswordHandler(db, sender, "")

	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/auth/forgot-password",
		bytes.NewBufferString(`{"email":"nobody@example.com"}`))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	assert.Equal(t, http.StatusAccepted, w.Code, "must not leak whether email exists")
	// Wait briefly to confirm no email was sent
	time.Sleep(100 * time.Millisecond)
	assert.Empty(t, sender.getSent())
}

func TestResetPassword_InvalidToken(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	handler := auth.ResetPasswordHandler(db)

	body := `{"token":"0000000000000000000000000000000000000000000000000000000000000000","new_password":"newpassword123"}`
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/auth/reset-password",
		bytes.NewBufferString(body))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

// TestResetPassword_InvalidatesOldSessions proves the end-to-end revocation
// flow: log in (get a JWT), reset password, then attempt to use the JWT — the
// middleware refuses to attach a Principal because session_version has been
// bumped on the user row.
func TestResetPassword_InvalidatesOldSessions(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	_, oldToken, siEmail := signupAndLogin(t, db, "password123")

	// Build a reset token directly (skipping the email step).
	q := sqlcdb.New(db)
	user, err := q.GetUserByEmail(t.Context(), siEmail)
	require.NoError(t, err)

	rawToken := make([]byte, 32)
	_, err = rand.Read(rawToken)
	require.NoError(t, err)
	rawHex := hex.EncodeToString(rawToken)
	hashBytes := sha256.Sum256(rawToken)
	tokenHash := hex.EncodeToString(hashBytes[:])

	_, err = q.CreatePasswordResetToken(t.Context(), sqlcdb.CreatePasswordResetTokenParams{
		UserID:    user.ID,
		TokenHash: tokenHash,
		ExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(time.Hour), Valid: true},
	})
	require.NoError(t, err)

	// Perform the reset.
	resetHandler := auth.ResetPasswordHandler(db)
	bodyJSON, _ := json.Marshal(map[string]string{
		"token":        rawHex,
		"new_password": "differentpassword456",
	})
	rr := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/auth/reset-password",
		bytes.NewReader(bodyJSON))
	rr.Header.Set("Content-Type", "application/json")
	rw := httptest.NewRecorder()
	resetHandler.ServeHTTP(rw, rr)
	require.Equal(t, http.StatusOK, rw.Code, rw.Body.String())

	// The old session token must no longer authenticate.
	called := false
	guarded := auth.Middleware(db, testSecret)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		_, err := auth.User(r.Context())
		assert.ErrorIs(t, err, auth.ErrUnauthenticated, "old token must not produce a Principal post-reset")
	}))
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/me", nil)
	req.Header.Set("Authorization", "Bearer "+oldToken)
	guarded.ServeHTTP(httptest.NewRecorder(), req)
	require.True(t, called)

	// Logging in with the new password yields a token that DOES authenticate.
	newLogin := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/auth/login",
		strings.NewReader(fmt.Sprintf(`{"email":%q,"password":"differentpassword456"}`, siEmail)))
	newLogin.Header.Set("Content-Type", "application/json")
	newW := httptest.NewRecorder()
	auth.LoginHandler(db, testSecret).ServeHTTP(newW, newLogin)
	require.Equal(t, http.StatusOK, newW.Code, newW.Body.String())
}
