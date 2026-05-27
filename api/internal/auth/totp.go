package auth

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image/png"
	"io"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pquerna/otp/totp"

	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

// totpIssuer appears in authenticator apps next to the account name.
const totpIssuer = "Render"

type totpEnrollResponse struct {
	QRDataURL string `json:"qr_data_url"`
	Secret    string `json:"secret"`
}

// TOTPEnrollHandler handles POST /auth/mfa/enroll.
// Generates a new TOTP secret for the authenticated user, stores it encrypted
// (with mfa_enabled=false), and returns the QR code + plaintext secret so the
// client can register the account in an authenticator app.
//
// Re-enrolling overwrites any previous (un-confirmed or confirmed) secret.
func TOTPEnrollHandler(pool *pgxpool.Pool, encryptionKeyB64 string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, err := User(r.Context())
		if err != nil {
			httperr.Unauthorized(w)
			return
		}

		userUUID, err := pgUUIDFromString(principal.UserID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		q := sqlcdb.New(pool)
		user, err := q.GetUserByID(r.Context(), userUUID)
		if err != nil {
			if err == pgx.ErrNoRows {
				httperr.Unauthorized(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}

		key, err := totp.Generate(totp.GenerateOpts{
			Issuer:      totpIssuer,
			AccountName: user.Email,
		})
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		// Render QR code as PNG, base64-encode into a data URL.
		img, err := key.Image(200, 200)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}
		var buf bytes.Buffer
		if err := png.Encode(&buf, img); err != nil {
			httperr.InternalServerError(w)
			return
		}
		qrDataURL := "data:image/png;base64," + base64.StdEncoding.EncodeToString(buf.Bytes())

		encryptedSecret, err := encryptTOTPSecret(key.Secret(), encryptionKeyB64)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		secretCopy := encryptedSecret
		if _, err := q.SetMFAEnabled(r.Context(), sqlcdb.SetMFAEnabledParams{
			ID:         userUUID,
			MfaEnabled: false, // not confirmed yet — confirm endpoint flips this
			MfaSecret:  &secretCopy,
		}); err != nil {
			httperr.InternalServerError(w)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(totpEnrollResponse{
			QRDataURL: qrDataURL,
			Secret:    key.Secret(),
		})
	}
}

type totpConfirmRequest struct {
	Code string `json:"code"`
}

// TOTPConfirmHandler handles POST /auth/mfa/confirm.
// Validates the supplied TOTP code against the user's stored (encrypted) secret
// and flips mfa_enabled=true if it matches.
func TOTPConfirmHandler(pool *pgxpool.Pool, encryptionKeyB64 string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, err := User(r.Context())
		if err != nil {
			httperr.Unauthorized(w)
			return
		}

		var req totpConfirmRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.BadRequest(w, "invalid request body")
			return
		}
		if req.Code == "" {
			httperr.BadRequest(w, "code is required")
			return
		}

		userUUID, err := pgUUIDFromString(principal.UserID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		q := sqlcdb.New(pool)
		user, err := q.GetUserByID(r.Context(), userUUID)
		if err != nil {
			if err == pgx.ErrNoRows {
				httperr.Unauthorized(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}

		if user.MfaSecret == nil {
			httperr.BadRequest(w, "no MFA enrolment in progress")
			return
		}

		secret, err := decryptTOTPSecret(*user.MfaSecret, encryptionKeyB64)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		if !totp.Validate(req.Code, secret) {
			httperr.Write(w, http.StatusUnauthorized, "Unauthorized", "invalid TOTP code")
			return
		}

		if _, err := q.SetMFAEnabled(r.Context(), sqlcdb.SetMFAEnabledParams{
			ID:         userUUID,
			MfaEnabled: true,
			MfaSecret:  user.MfaSecret, // already encrypted *string
		}); err != nil {
			httperr.InternalServerError(w)
			return
		}

		w.WriteHeader(http.StatusOK)
	}
}

// TOTPVerifyHandler handles POST /auth/mfa/verify.
// Accepts an mfa_pending JWT in the Authorization: Bearer header, validates a
// TOTP code against the user's stored secret, and on success returns a full
// session JWT (and sets the session cookie). The bearer token is parsed
// directly here rather than via the auth middleware/context, because the
// middleware deliberately refuses to attach a Principal for mfa_pending tokens.
func TOTPVerifyHandler(pool *pgxpool.Pool, encryptionKeyB64, jwtSecret string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if !strings.HasPrefix(authHeader, "Bearer ") {
			httperr.Write(w, http.StatusUnauthorized, "Unauthorized", "missing mfa_pending token")
			return
		}
		tokenStr := strings.TrimPrefix(authHeader, "Bearer ")
		claims, err := ParseToken(tokenStr, jwtSecret)
		if err != nil || claims.Scope != ScopeMFAPending {
			httperr.Write(w, http.StatusUnauthorized, "Unauthorized", "invalid mfa_pending token")
			return
		}

		var req struct {
			Code string `json:"code"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.BadRequest(w, "invalid request body")
			return
		}
		if req.Code == "" {
			httperr.BadRequest(w, "code is required")
			return
		}

		userUUID, err := pgUUIDFromString(claims.Subject)
		if err != nil {
			httperr.Write(w, http.StatusUnauthorized, "Unauthorized", "invalid token subject")
			return
		}

		q := sqlcdb.New(pool)
		user, err := q.GetUserByID(r.Context(), userUUID)
		if err != nil {
			if err == pgx.ErrNoRows {
				httperr.Unauthorized(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}

		if !user.MfaEnabled || user.MfaSecret == nil {
			httperr.Write(w, http.StatusUnauthorized, "Unauthorized", "mfa not enabled")
			return
		}

		secret, err := decryptTOTPSecret(*user.MfaSecret, encryptionKeyB64)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}
		if !totp.Validate(req.Code, secret) {
			httperr.Write(w, http.StatusUnauthorized, "Unauthorized", "invalid TOTP code")
			return
		}

		token, err := IssueToken(user.ID.String(), string(user.Role), jwtSecret)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		http.SetCookie(w, &http.Cookie{
			Name:     "session",
			Value:    token,
			HttpOnly: true,
			SameSite: http.SameSiteLaxMode,
			Path:     "/",
			MaxAge:   int(tokenTTL.Seconds()),
		})

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(loginResponse{
			Token: token,
			User:  toUserResponse(user),
		})
	}
}

// encryptTOTPSecret seals plaintext with AES-256-GCM using a base64-encoded
// 32-byte key, returning a base64 string containing nonce || ciphertext || tag.
func encryptTOTPSecret(plaintext, keyB64 string) (string, error) {
	key, err := base64.StdEncoding.DecodeString(keyB64)
	if err != nil || len(key) != 32 {
		return "", fmt.Errorf("invalid encryption key")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err = io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	sealed := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return base64.StdEncoding.EncodeToString(sealed), nil
}

// decryptTOTPSecret reverses encryptTOTPSecret.
func decryptTOTPSecret(ciphertextB64, keyB64 string) (string, error) {
	key, err := base64.StdEncoding.DecodeString(keyB64)
	if err != nil || len(key) != 32 {
		return "", fmt.Errorf("invalid encryption key")
	}
	data, err := base64.StdEncoding.DecodeString(ciphertextB64)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonceSize := gcm.NonceSize()
	if len(data) < nonceSize {
		return "", fmt.Errorf("ciphertext too short")
	}
	plaintext, err := gcm.Open(nil, data[:nonceSize], data[nonceSize:], nil)
	if err != nil {
		return "", err
	}
	return string(plaintext), nil
}
