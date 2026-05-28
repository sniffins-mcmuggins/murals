package auth

import (
	"context"
	"errors"
)

type contextKey struct{}

// Principal holds the authenticated user's identity extracted from the JWT.
type Principal struct {
	UserID  string
	IsAdmin bool
}

// ErrUnauthenticated is returned by User when no principal is on the context.
var ErrUnauthenticated = errors.New("unauthenticated")

func setPrincipal(ctx context.Context, p Principal) context.Context {
	return context.WithValue(ctx, contextKey{}, p)
}

// WithUserForTest injects a principal into ctx without going through the JWT
// middleware. Intended only for tests of handlers/middleware that gate on the
// principal — production callers must use Middleware.
func WithUserForTest(ctx context.Context, userID string, isAdmin bool) context.Context {
	return setPrincipal(ctx, Principal{UserID: userID, IsAdmin: isAdmin})
}

// User returns the authenticated principal from ctx, or ErrUnauthenticated.
func User(ctx context.Context) (Principal, error) {
	p, ok := ctx.Value(contextKey{}).(Principal)
	if !ok {
		return Principal{}, ErrUnauthenticated
	}
	return p, nil
}
