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

	handler := auth.Middleware(db, testSecret)(auth.TOTPEnrollHandler(db, testTOTPKey))

	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/auth/mfa/enroll", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	assert.Equal(t, http.StatusUnauthorized, w.Code, w.Body.String())
}

func TestTOTPEnroll_ReturnsQRAndSecret(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	_, token, enrollEmail := signupAndLogin(t, db, "password123")

	handler := auth.Middleware(db, testSecret)(auth.TOTPEnrollHandler(db, testTOTPKey))

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
	user := fetchUser(t, db, enrollEmail)
	assert.False(t, user.MfaEnabled, "mfa_enabled must remain false until confirm")
	require.NotNil(t, user.MfaSecret, "mfa_secret must be stored after enroll")
	assert.NotEqual(t, secret, *user.MfaSecret, "stored secret must be encrypted, not plaintext")
}

func TestTOTPConfirm_ValidCode(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	_, token, confirmEmail := signupAndLogin(t, db, "password123")

	// Enroll first.
	enrollHandler := auth.Middleware(db, testSecret)(auth.TOTPEnrollHandler(db, testTOTPKey))
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
	confirmHandler := auth.Middleware(db, testSecret)(auth.TOTPConfirmHandler(db, testTOTPKey))
	body := `{"code":"` + code + `"}`
	cr := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/auth/mfa/confirm", strings.NewReader(body))
	cr.Header.Set("Authorization", "Bearer "+token)
	cr.Header.Set("Content-Type", "application/json")
	cw := httptest.NewRecorder()
	confirmHandler.ServeHTTP(cw, cr)
	require.Equal(t, http.StatusOK, cw.Code, cw.Body.String())

	user := fetchUser(t, db, confirmEmail)
	assert.True(t, user.MfaEnabled, "mfa_enabled must be true after confirm with valid code")
}

func TestTOTPConfirm_InvalidCode(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	_, token, invalidEmail := signupAndLogin(t, db, "password123")

	// Enroll first.
	enrollHandler := auth.Middleware(db, testSecret)(auth.TOTPEnrollHandler(db, testTOTPKey))
	er := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/auth/mfa/enroll", nil)
	er.Header.Set("Authorization", "Bearer "+token)
	ew := httptest.NewRecorder()
	enrollHandler.ServeHTTP(ew, er)
	require.Equal(t, http.StatusOK, ew.Code, ew.Body.String())

	// Submit obviously-wrong code.
	confirmHandler := auth.Middleware(db, testSecret)(auth.TOTPConfirmHandler(db, testTOTPKey))
	body := `{"code":"000000"}`
	cr := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/auth/mfa/confirm", strings.NewReader(body))
	cr.Header.Set("Authorization", "Bearer "+token)
	cr.Header.Set("Content-Type", "application/json")
	cw := httptest.NewRecorder()
	confirmHandler.ServeHTTP(cw, cr)

	assert.Equal(t, http.StatusUnauthorized, cw.Code, cw.Body.String())

	user := fetchUser(t, db, invalidEmail)
	assert.False(t, user.MfaEnabled, "mfa_enabled must stay false after invalid code")
}

// TestTOTPEnroll_RejectsReEnrollWithoutCurrentCode verifies the re-enrol guard:
// once MFA is enabled, /auth/mfa/enroll must require a valid TOTP code for the
// EXISTING secret before issuing a new one. Without this, a stolen session
// token could silently rotate the user's MFA secret.
func TestTOTPEnroll_RejectsReEnrollWithoutCurrentCode(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	_, token, reenrollEmail := signupAndLogin(t, db, "password123")
	enrollAndConfirmMFA(t, db, token)

	// Attempt to re-enrol without supplying current_code — must be rejected.
	enrollHandler := auth.Middleware(db, testSecret)(auth.TOTPEnrollHandler(db, testTOTPKey))
	er := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/auth/mfa/enroll",
		strings.NewReader(`{}`))
	er.Header.Set("Authorization", "Bearer "+token)
	er.Header.Set("Content-Type", "application/json")
	ew := httptest.NewRecorder()
	enrollHandler.ServeHTTP(ew, er)

	assert.Equal(t, http.StatusUnauthorized, ew.Code, ew.Body.String())

	// The stored secret must not have changed (mfa_enabled still true).
	user := fetchUser(t, db, reenrollEmail)
	assert.True(t, user.MfaEnabled, "mfa_enabled must remain true after rejected re-enrol")
}

// TestTOTPEnroll_AllowsReEnrollWithValidCurrentCode verifies the happy path:
// supplying a valid TOTP for the existing secret unlocks re-enrolment.
func TestTOTPEnroll_AllowsReEnrollWithValidCurrentCode(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	_, token, reenrollOkEmail := signupAndLogin(t, db, "password123")
	oldSecret := enrollAndConfirmMFA(t, db, token)

	code, err := totp.GenerateCode(oldSecret, time.Now())
	require.NoError(t, err)

	enrollHandler := auth.Middleware(db, testSecret)(auth.TOTPEnrollHandler(db, testTOTPKey))
	body := `{"current_code":"` + code + `"}`
	er := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/auth/mfa/enroll",
		strings.NewReader(body))
	er.Header.Set("Authorization", "Bearer "+token)
	er.Header.Set("Content-Type", "application/json")
	ew := httptest.NewRecorder()
	enrollHandler.ServeHTTP(ew, er)

	require.Equal(t, http.StatusOK, ew.Code, ew.Body.String())

	var resp map[string]any
	require.NoError(t, json.NewDecoder(ew.Body).Decode(&resp))
	newSecret, _ := resp["secret"].(string)
	assert.NotEmpty(t, newSecret)
	assert.NotEqual(t, oldSecret, newSecret, "re-enrol must produce a different secret")

	// mfa_enabled must drop back to false until the new secret is confirmed.
	user := fetchUser(t, db, reenrollOkEmail)
	assert.False(t, user.MfaEnabled, "re-enrol returns user to un-confirmed state")
}

func TestTOTPConfirm_NoEnrollment(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	_, token, _ := signupAndLogin(t, db, "password123")

	confirmHandler := auth.Middleware(db, testSecret)(auth.TOTPConfirmHandler(db, testTOTPKey))
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

// enrollAndConfirmMFA runs the full enroll + confirm flow for an already-authed
// user and returns the plaintext TOTP secret so subsequent tests can generate
// valid codes (for /auth/mfa/verify).
func enrollAndConfirmMFA(t *testing.T, db *pgxpool.Pool, token string) string {
	t.Helper()

	enrollHandler := auth.Middleware(db, testSecret)(auth.TOTPEnrollHandler(db, testTOTPKey))
	er := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/auth/mfa/enroll", nil)
	er.Header.Set("Authorization", "Bearer "+token)
	ew := httptest.NewRecorder()
	enrollHandler.ServeHTTP(ew, er)
	require.Equal(t, http.StatusOK, ew.Code, ew.Body.String())

	var enrollResp map[string]any
	require.NoError(t, json.NewDecoder(ew.Body).Decode(&enrollResp))
	secret := enrollResp["secret"].(string)

	code, err := totp.GenerateCode(secret, time.Now())
	require.NoError(t, err)

	confirmHandler := auth.Middleware(db, testSecret)(auth.TOTPConfirmHandler(db, testTOTPKey))
	body := `{"code":"` + code + `"}`
	cr := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/auth/mfa/confirm", strings.NewReader(body))
	cr.Header.Set("Authorization", "Bearer "+token)
	cr.Header.Set("Content-Type", "application/json")
	cw := httptest.NewRecorder()
	confirmHandler.ServeHTTP(cw, cr)
	require.Equal(t, http.StatusOK, cw.Code, cw.Body.String())

	return secret
}

// loginRaw posts to /auth/login and returns the recorder so tests can assert
// on body + cookies. It does NOT fail on non-200 (the MFA branch is 200, the
// wrong-password branch is 401; callers decide).
func loginRaw(t *testing.T, db *pgxpool.Pool, email, password string) *httptest.ResponseRecorder {
	t.Helper()
	body := `{"email":"` + email + `","password":"` + password + `"}`
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/auth/login", strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	auth.LoginHandler(db, testSecret).ServeHTTP(w, r)
	return w
}

func TestLogin_MFAEnabled_ReturnsMFAToken(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	_, token, mfaEmail := signupAndLogin(t, db, "password123")
	enrollAndConfirmMFA(t, db, token)

	w := loginRaw(t, db, mfaEmail, "password123")
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())

	var resp map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))

	assert.Equal(t, true, resp["mfa_required"], "expected mfa_required:true")
	assert.NotEmpty(t, resp["mfa_token"], "expected non-empty mfa_token")
	assert.Nil(t, resp["token"], "full session token must not be issued on the MFA branch")
	assert.Nil(t, resp["user"], "user payload must not leak on the MFA branch")

	for _, c := range w.Result().Cookies() {
		assert.NotEqual(t, "session", c.Name, "session cookie must NOT be set before MFA verify")
	}
}

func TestLogin_MFADisabled_ReturnsFullToken(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	noMFAEmail := createTestUser(t, db, "password123")

	w := loginRaw(t, db, noMFAEmail, "password123")
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())

	var resp map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	assert.NotEmpty(t, resp["token"], "expected full token on non-MFA login")
	assert.NotNil(t, resp["user"], "expected user payload on non-MFA login")
	assert.Nil(t, resp["mfa_required"], "mfa_required must not appear when MFA is disabled")

	var sessionCookie *http.Cookie
	for _, c := range w.Result().Cookies() {
		if c.Name == "session" {
			sessionCookie = c
		}
	}
	require.NotNil(t, sessionCookie, "session cookie must be set on non-MFA login")
}

func TestTOTPVerify_ValidCode(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	_, sessionToken, verifyEmail := signupAndLogin(t, db, "password123")
	secret := enrollAndConfirmMFA(t, db, sessionToken)

	// Login → get mfa_token.
	lw := loginRaw(t, db, verifyEmail, "password123")
	require.Equal(t, http.StatusOK, lw.Code, lw.Body.String())
	var loginResp map[string]any
	require.NoError(t, json.NewDecoder(lw.Body).Decode(&loginResp))
	mfaToken, _ := loginResp["mfa_token"].(string)
	require.NotEmpty(t, mfaToken)

	// Verify with a valid TOTP code.
	code, err := totp.GenerateCode(secret, time.Now())
	require.NoError(t, err)

	verifyHandler := auth.TOTPVerifyHandler(db, testTOTPKey, testSecret)
	body := `{"code":"` + code + `"}`
	vr := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/auth/mfa/verify", strings.NewReader(body))
	vr.Header.Set("Authorization", "Bearer "+mfaToken)
	vr.Header.Set("Content-Type", "application/json")
	vw := httptest.NewRecorder()
	verifyHandler.ServeHTTP(vw, vr)
	require.Equal(t, http.StatusOK, vw.Code, vw.Body.String())

	var verifyResp map[string]any
	require.NoError(t, json.NewDecoder(vw.Body).Decode(&verifyResp))
	assert.NotEmpty(t, verifyResp["token"], "full session token expected after verify")
	assert.NotNil(t, verifyResp["user"], "user payload expected after verify")

	var sessionCookie *http.Cookie
	for _, c := range vw.Result().Cookies() {
		if c.Name == "session" {
			sessionCookie = c
		}
	}
	require.NotNil(t, sessionCookie, "session cookie must be set after verify")
	assert.True(t, sessionCookie.HttpOnly)
}

func TestTOTPVerify_InvalidCode(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	_, sessionToken, verifyBadEmail := signupAndLogin(t, db, "password123")
	enrollAndConfirmMFA(t, db, sessionToken)

	lw := loginRaw(t, db, verifyBadEmail, "password123")
	require.Equal(t, http.StatusOK, lw.Code, lw.Body.String())
	var loginResp map[string]any
	require.NoError(t, json.NewDecoder(lw.Body).Decode(&loginResp))
	mfaToken := loginResp["mfa_token"].(string)

	verifyHandler := auth.TOTPVerifyHandler(db, testTOTPKey, testSecret)
	vr := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/auth/mfa/verify", strings.NewReader(`{"code":"000000"}`))
	vr.Header.Set("Authorization", "Bearer "+mfaToken)
	vr.Header.Set("Content-Type", "application/json")
	vw := httptest.NewRecorder()
	verifyHandler.ServeHTTP(vw, vr)

	assert.Equal(t, http.StatusUnauthorized, vw.Code, vw.Body.String())
	for _, c := range vw.Result().Cookies() {
		assert.NotEqual(t, "session", c.Name, "session cookie must NOT be set on bad code")
	}
}

func TestTOTPVerify_NoToken(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)

	verifyHandler := auth.TOTPVerifyHandler(db, testTOTPKey, testSecret)
	vr := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/auth/mfa/verify", strings.NewReader(`{"code":"123456"}`))
	vr.Header.Set("Content-Type", "application/json")
	vw := httptest.NewRecorder()
	verifyHandler.ServeHTTP(vw, vr)

	assert.Equal(t, http.StatusUnauthorized, vw.Code, vw.Body.String())
}

func TestTOTPVerify_FullTokenRejected(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	_, fullToken, _ := signupAndLogin(t, db, "password123")
	// Enroll + confirm MFA so the user even has a secret — verifying with the
	// full session token (Scope == "") must still be rejected because only
	// mfa_pending-scoped tokens may exchange for a session.
	enrollAndConfirmMFA(t, db, fullToken)

	verifyHandler := auth.TOTPVerifyHandler(db, testTOTPKey, testSecret)
	vr := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/auth/mfa/verify", strings.NewReader(`{"code":"123456"}`))
	vr.Header.Set("Authorization", "Bearer "+fullToken)
	vr.Header.Set("Content-Type", "application/json")
	vw := httptest.NewRecorder()
	verifyHandler.ServeHTTP(vw, vr)

	assert.Equal(t, http.StatusUnauthorized, vw.Code, vw.Body.String())
}
