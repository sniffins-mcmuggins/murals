package auth_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pquerna/otp/totp"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

// testTOTPKey is 32 zero bytes, base64-encoded — a valid AES-256-GCM key for tests only.
const testTOTPKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="

func TestTOTPEnroll_Unauthenticated(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)

	handler := auth.Middleware(testSecret)(auth.TOTPEnrollHandler(db, testTOTPKey))

	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/auth/mfa/enroll", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	assert.Equal(t, http.StatusUnauthorized, w.Code, w.Body.String())
}

func TestTOTPEnroll_ReturnsQRAndSecret(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	_, token := signupAndLogin(t, db, "totp-enroll@example.com", "password123")

	handler := auth.Middleware(testSecret)(auth.TOTPEnrollHandler(db, testTOTPKey))

	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/auth/mfa/enroll", nil)
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())

	var resp map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))

	qr, _ := resp["qr_data_url"].(string)
	secret, _ := resp["secret"].(string)
	assert.True(t, strings.HasPrefix(qr, "data:image/png;base64,"), "qr_data_url should be a PNG data URL")
	assert.NotEmpty(t, secret, "secret should be returned in plaintext for manual entry")

	// Verify DB: encrypted secret stored, mfa_enabled still false.
	user := fetchUser(t, db, "totp-enroll@example.com")
	assert.False(t, user.MfaEnabled, "mfa_enabled must remain false until confirm")
	require.NotNil(t, user.MfaSecret, "mfa_secret must be stored after enroll")
	assert.NotEqual(t, secret, *user.MfaSecret, "stored secret must be encrypted, not plaintext")
}

func TestTOTPConfirm_ValidCode(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	_, token := signupAndLogin(t, db, "totp-confirm@example.com", "password123")

	// Enroll first.
	enrollHandler := auth.Middleware(testSecret)(auth.TOTPEnrollHandler(db, testTOTPKey))
	er := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/auth/mfa/enroll", nil)
	er.Header.Set("Authorization", "Bearer "+token)
	ew := httptest.NewRecorder()
	enrollHandler.ServeHTTP(ew, er)
	require.Equal(t, http.StatusOK, ew.Code, ew.Body.String())

	var enrollResp map[string]any
	require.NoError(t, json.NewDecoder(ew.Body).Decode(&enrollResp))
	secret := enrollResp["secret"].(string)

	// Generate a valid TOTP code from the plaintext secret.
	code, err := totp.GenerateCode(secret, time.Now())
	require.NoError(t, err)

	// Confirm.
	confirmHandler := auth.Middleware(testSecret)(auth.TOTPConfirmHandler(db, testTOTPKey))
	body := `{"code":"` + code + `"}`
	cr := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/auth/mfa/confirm", strings.NewReader(body))
	cr.Header.Set("Authorization", "Bearer "+token)
	cr.Header.Set("Content-Type", "application/json")
	cw := httptest.NewRecorder()
	confirmHandler.ServeHTTP(cw, cr)
	require.Equal(t, http.StatusOK, cw.Code, cw.Body.String())

	user := fetchUser(t, db, "totp-confirm@example.com")
	assert.True(t, user.MfaEnabled, "mfa_enabled must be true after confirm with valid code")
}

func TestTOTPConfirm_InvalidCode(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	_, token := signupAndLogin(t, db, "totp-invalid@example.com", "password123")

	// Enroll first.
	enrollHandler := auth.Middleware(testSecret)(auth.TOTPEnrollHandler(db, testTOTPKey))
	er := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/auth/mfa/enroll", nil)
	er.Header.Set("Authorization", "Bearer "+token)
	ew := httptest.NewRecorder()
	enrollHandler.ServeHTTP(ew, er)
	require.Equal(t, http.StatusOK, ew.Code, ew.Body.String())

	// Submit obviously-wrong code.
	confirmHandler := auth.Middleware(testSecret)(auth.TOTPConfirmHandler(db, testTOTPKey))
	body := `{"code":"000000"}`
	cr := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/auth/mfa/confirm", strings.NewReader(body))
	cr.Header.Set("Authorization", "Bearer "+token)
	cr.Header.Set("Content-Type", "application/json")
	cw := httptest.NewRecorder()
	confirmHandler.ServeHTTP(cw, cr)

	assert.Equal(t, http.StatusUnauthorized, cw.Code, cw.Body.String())

	user := fetchUser(t, db, "totp-invalid@example.com")
	assert.False(t, user.MfaEnabled, "mfa_enabled must stay false after invalid code")
}

func TestTOTPConfirm_NoEnrollment(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	_, token := signupAndLogin(t, db, "totp-noenroll@example.com", "password123")

	confirmHandler := auth.Middleware(testSecret)(auth.TOTPConfirmHandler(db, testTOTPKey))
	body := `{"code":"123456"}`
	cr := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/auth/mfa/confirm", strings.NewReader(body))
	cr.Header.Set("Authorization", "Bearer "+token)
	cr.Header.Set("Content-Type", "application/json")
	cw := httptest.NewRecorder()
	confirmHandler.ServeHTTP(cw, cr)

	assert.Equal(t, http.StatusBadRequest, cw.Code, cw.Body.String())
}

// fetchUser loads the user row for assertions. Tests use this directly rather
// than going through HTTP so they can inspect the encrypted mfa_secret column.
func fetchUser(t *testing.T, db *pgxpool.Pool, email string) sqlcdb.User {
	t.Helper()
	q := sqlcdb.New(db)
	u, err := q.GetUserByEmail(t.Context(), email)
	require.NoError(t, err)
	return u
}
