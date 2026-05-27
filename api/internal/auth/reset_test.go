package auth_test

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
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
	createTestUser(t, db, "alice@example.com", "password123")
	sender := &stubSender{}
	handler := auth.ForgotPasswordHandler(db, sender, "")

	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/auth/forgot-password",
		bytes.NewBufferString(`{"email":"alice@example.com"}`))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	assert.Equal(t, http.StatusAccepted, w.Code)
	// Email is sent in a goroutine — give it a moment
	require.Eventually(t, func() bool { return len(sender.getSent()) == 1 }, 2*time.Second, 50*time.Millisecond)
	assert.Equal(t, "alice@example.com", sender.getSent()[0])
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
