package auth

import (
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

// Middleware extracts a JWT from the session cookie or Authorization: Bearer header,
// verifies it, and injects the Principal into the request context.
// Requests without a valid token pass through unchanged — call auth.User(ctx) in handlers to gate access.
//
// Tokens carrying Scope == ScopeMFAPending are intentionally NOT attached as a
// Principal: holders of an mfa_pending token must only be able to call
// POST /auth/mfa/verify (which parses the bearer token directly), and must
// fail authentication for every other protected route.
//
// The middleware also performs a session_version check by reading the user
// row. This is what makes password reset actually invalidate outstanding
// sessions: the JWT's `sv` claim must match users.session_version. The cost
// is one indexed primary-key lookup per authenticated request — anonymous
// requests (no token) skip the lookup entirely.
func Middleware(pool *pgxpool.Pool, secret string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token := tokenFromRequest(r)
			if token == "" {
				next.ServeHTTP(w, r)
				return
			}
			claims, err := ParseToken(token, secret)
			if err != nil || claims.Scope == ScopeMFAPending {
				next.ServeHTTP(w, r)
				return
			}
			if !sessionVersionValid(r, pool, claims) {
				next.ServeHTTP(w, r)
				return
			}
			r = r.WithContext(setPrincipal(r.Context(), Principal{
				UserID:  claims.Subject,
				IsAdmin: claims.IsAdmin,
			}))
			next.ServeHTTP(w, r)
		})
	}
}

// sessionVersionValid compares the JWT's embedded sv against the live
// session_version on the user row. A mismatch (or any DB error / missing user)
// means we refuse to attach a Principal — the user can re-login to get a fresh
// token with the current sv.
func sessionVersionValid(r *http.Request, pool *pgxpool.Pool, claims *Claims) bool {
	userUUID, err := pgUUIDFromString(claims.Subject)
	if err != nil {
		return false
	}
	q := sqlcdb.New(pool)
	user, err := q.GetUserByID(r.Context(), userUUID)
	if err != nil {
		return false
	}
	return user.SessionVersion == claims.SessionVersion
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
