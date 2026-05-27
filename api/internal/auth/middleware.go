package auth

import (
	"net/http"
	"strings"
)

// Middleware extracts a JWT from the session cookie or Authorization: Bearer header,
// verifies it, and injects the Principal into the request context.
// Requests without a valid token pass through unchanged — call auth.User(ctx) in handlers to gate access.
//
// Tokens carrying Scope == ScopeMFAPending are intentionally NOT attached as a
// Principal: holders of an mfa_pending token must only be able to call
// POST /auth/mfa/verify (which parses the bearer token directly), and must
// fail authentication for every other protected route.
func Middleware(secret string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if token := tokenFromRequest(r); token != "" {
				if claims, err := ParseToken(token, secret); err == nil && claims.Scope != ScopeMFAPending {
					r = r.WithContext(setPrincipal(r.Context(), Principal{
						UserID: claims.Subject,
						Role:   claims.Role,
					}))
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

func tokenFromRequest(r *http.Request) string {
	if c, err := r.Cookie("session"); err == nil && c.Value != "" {
		return c.Value
	}
	if v := r.Header.Get("Authorization"); strings.HasPrefix(v, "Bearer ") {
		return strings.TrimPrefix(v, "Bearer ")
	}
	return ""
}
