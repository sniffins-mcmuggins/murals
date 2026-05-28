package auth

import (
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const tokenTTL = 7 * 24 * time.Hour

const mfaPendingTTL = 5 * time.Minute

// ScopeMFAPending marks a JWT that may only call POST /auth/mfa/verify.
// Holders cannot access any other protected resource — Middleware refuses
// to set a Principal for tokens carrying this scope.
const ScopeMFAPending = "mfa_pending"

// Claims are the JWT payload fields this API issues and trusts.
//
// SessionVersion is a server-side revocation counter that the auth middleware
// compares against users.session_version. Password reset bumps the counter,
// invalidating every JWT previously issued for that user. Without this field
// an attacker who lifted a session token would keep working until the JWT's
// natural expiry (7 days).
type Claims struct {
	IsAdmin        bool   `json:"is_admin,omitempty"`
	Scope          string `json:"scope,omitempty"` // "" = full access; "mfa_pending" = awaiting MFA verification
	SessionVersion int32  `json:"sv,omitempty"`    // server-side revocation counter
	jwt.RegisteredClaims
}

// IssueToken mints a signed HS256 JWT for the given user.
//
// sessionVersion must come from the user row (users.session_version) so the
// middleware can detect and reject stale tokens after a password reset.
func IssueToken(userID string, isAdmin bool, sessionVersion int32, secret string) (string, error) {
	now := time.Now()
	claims := Claims{
		IsAdmin:        isAdmin,
		SessionVersion: sessionVersion,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(tokenTTL)),
		},
	}
	t := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return t.SignedString([]byte(secret))
}

// IssueMFAPendingToken mints a short-lived JWT scoped to MFA verification only.
// Holders cannot access protected resources — only POST /auth/mfa/verify.
//
// mfa_pending tokens do NOT carry SessionVersion: they're short-lived (5min)
// and the verify handler always re-reads the user row anyway.
func IssueMFAPendingToken(userID, secret string) (string, error) {
	now := time.Now()
	claims := Claims{
		Scope: ScopeMFAPending,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(mfaPendingTTL)),
		},
	}
	t := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return t.SignedString([]byte(secret))
}

// ParseToken verifies a signed JWT and returns its claims.
func ParseToken(tokenStr, secret string) (*Claims, error) {
	t, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return []byte(secret), nil
	})
	if err != nil {
		return nil, err
	}
	claims, ok := t.Claims.(*Claims)
	if !ok || !t.Valid {
		return nil, fmt.Errorf("invalid token")
	}
	return claims, nil
}
