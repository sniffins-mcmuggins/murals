package middleware

import (
	"log/slog"
	"net/http"
	"runtime/debug"

	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
)

// Recover catches panics, logs the stack trace, and returns a 500.
func Recover(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				slog.Error("panic recovered",
					"panic", rec,
					"stack", string(debug.Stack()),
					"method", r.Method,
					"path", r.URL.Path,
				)
				httperr.InternalServerError(w)
			}
		}()
		next.ServeHTTP(w, r)
	})
}
