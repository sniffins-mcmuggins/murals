package auth

import (
	"net"
	"net/http"
	"sync"
	"time"

	"golang.org/x/time/rate"

	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
)

type ipLimiter struct {
	mu       sync.Mutex
	limiters map[string]*rateLimiterEntry
}

type rateLimiterEntry struct {
	limiter  *rate.Limiter
	lastSeen time.Time
}

var globalLimiter = &ipLimiter{limiters: make(map[string]*rateLimiterEntry)}

// Limiter config — set by ConfigureRateLimit from main.go. Defaults keep tests
// and dev runs working without explicit configuration; production binaries
// override via env (see config.LoginRateLimitPerMin).
var (
	rateLimitMu     sync.RWMutex
	rateLimitPerMin = 5
	rateLimitBurst  = 5
)

// ConfigureRateLimit changes the per-IP limit for new buckets. Call once at
// startup before serving traffic. Buckets already created keep their old
// limits — fine for our use case (each process starts fresh).
func ConfigureRateLimit(perMin, burst int) {
	if perMin <= 0 || burst <= 0 {
		return
	}
	rateLimitMu.Lock()
	rateLimitPerMin = perMin
	rateLimitBurst = burst
	rateLimitMu.Unlock()
}

func currentLimit() (perMin, burst int) {
	rateLimitMu.RLock()
	defer rateLimitMu.RUnlock()
	return rateLimitPerMin, rateLimitBurst
}

func init() {
	// Clean stale entries every 10 minutes
	go func() {
		for range time.Tick(10 * time.Minute) {
			globalLimiter.mu.Lock()
			for ip, e := range globalLimiter.limiters {
				if time.Since(e.lastSeen) > 10*time.Minute {
					delete(globalLimiter.limiters, ip)
				}
			}
			globalLimiter.mu.Unlock()
		}
	}()
}

func (l *ipLimiter) get(ip string) *rate.Limiter {
	l.mu.Lock()
	defer l.mu.Unlock()
	e, ok := l.limiters[ip]
	if !ok {
		perMin, burst := currentLimit()
		lim := rate.NewLimiter(rate.Every(time.Minute/time.Duration(perMin)), burst)
		l.limiters[ip] = &rateLimiterEntry{limiter: lim, lastSeen: time.Now()}
		return lim
	}
	e.lastSeen = time.Now()
	return e.limiter
}

// clientIP returns the client identifier for rate-limit keying.
//
// We rely on r.RemoteAddr only. The router applies chiMiddleware.RealIP, which
// rewrites RemoteAddr from X-Forwarded-For / X-Real-IP when those headers are
// present — so there is exactly one source of truth here, configured once at
// the router. Parsing XFF a second time in this middleware would either
// duplicate that logic or, worse, allow an attacker to defeat the limiter by
// rotating XFF values when no trusted proxy is in front.
//
// In deployments without a trusted proxy (local dev, accidental direct
// exposure), chiMiddleware.RealIP should be removed from the router — at that
// point RemoteAddr is the raw socket peer and is again the right source.
func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		// RemoteAddr without port (rare — fall through to raw value)
		return r.RemoteAddr
	}
	return host
}

// RateLimitMiddleware limits requests per IP on the wrapped handler. The rate
// is configured via ConfigureRateLimit (defaults: 5/min, burst 5).
// Note: per-process — with multiple ECS tasks, upgrade to go-redis/redis_rate.
func RateLimitMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := clientIP(r)
		if !globalLimiter.get(ip).Allow() {
			w.Header().Set("Retry-After", "60")
			httperr.Write(w, http.StatusTooManyRequests, "Too Many Requests", "rate limit exceeded")
			return
		}
		next.ServeHTTP(w, r)
	})
}
