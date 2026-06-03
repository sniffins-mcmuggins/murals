package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

const verificationWorkTimeout = 30 * time.Second

// VerifyEmailHandler handles GET /auth/verify-email?token=<hex-token>.
// Validates the token, marks it used, sets email_verified = true, issues a
// full JWT (same cookie + body as post-login), returns 200 {"token": "..."}.
func VerifyEmailHandler(pool *pgxpool.Pool, jwtSecret string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rawHex := r.URL.Query().Get("token")
		if rawHex == "" {
			httperr.BadRequest(w, "missing token")
			return
		}
		raw, err := hex.DecodeString(rawHex)
		if err != nil || len(raw) == 0 {
			httperr.BadRequest(w, "invalid token")
			return
		}
		hash := sha256.Sum256(raw)
		tokenHash := hex.EncodeToString(hash[:])

		q := sqlcdb.New(pool)
		rec, err := q.GetEmailVerificationToken(r.Context(), tokenHash)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.BadRequest(w, "invalid or expired token")
				return
			}
			httperr.InternalServerError(w)
			return
		}

		// Mark used BEFORE issuing JWT — prevents any window of double-use.
		if err := q.MarkEmailVerificationTokenUsed(r.Context(), rec.ID); err != nil {
			httperr.InternalServerError(w)
			return
		}

		if err := q.SetEmailVerified(r.Context(), rec.UserID); err != nil {
			httperr.InternalServerError(w)
			return
		}

		user, err := q.GetUserByID(r.Context(), rec.UserID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		token, err := IssueToken(user.ID.String(), user.IsAdmin, user.SessionVersion, jwtSecret)
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
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]string{"token": token})
	}
}

// ResendVerificationHandler handles POST /auth/resend-verification.
// Always returns 202 — never leaks whether the email is registered.
func ResendVerificationHandler(pool *pgxpool.Pool, mailer EmailSender, webBase string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Email string `json:"email"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.BadRequest(w, "invalid request body")
			return
		}
		email := strings.ToLower(strings.TrimSpace(req.Email))
		w.WriteHeader(http.StatusAccepted)
		go sendVerificationEmailWork(pool, mailer, webBase, email)
	}
}

// SendVerificationEmail is called from SignupHandler immediately after user
// creation — exposed so signup.go can call it directly.
func SendVerificationEmail(pool *pgxpool.Pool, mailer EmailSender, webBase, email string) {
	go sendVerificationEmailWork(pool, mailer, webBase, email)
}

func sendVerificationEmailWork(pool *pgxpool.Pool, mailer EmailSender, webBase, email string) {
	ctx, cancel := context.WithTimeout(context.Background(), verificationWorkTimeout)
	defer cancel()

	q := sqlcdb.New(pool)
	user, err := q.GetUserByEmail(ctx, email)
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			slog.Error("send-verification: user lookup failed", "err", err)
		}
		return
	}
	if user.EmailVerified {
		return
	}

	rawToken := make([]byte, 32)
	if _, err := rand.Read(rawToken); err != nil {
		slog.Error("send-verification: rand.Read failed", "err", err)
		return
	}
	rawHex := hex.EncodeToString(rawToken)
	hash := sha256.Sum256(rawToken)
	tokenHash := hex.EncodeToString(hash[:])

	if _, err = q.CreateEmailVerificationToken(ctx, sqlcdb.CreateEmailVerificationTokenParams{
		UserID:    user.ID,
		TokenHash: tokenHash,
		ExpiresAt: pgTimestamptz(time.Now().Add(24 * time.Hour)),
	}); err != nil {
		slog.Error("send-verification: create token failed", "err", err)
		return
	}

	verifyURL := fmt.Sprintf("%s/verify-email?token=%s", webBase, rawHex)
	body := fmt.Sprintf(
		`<p>Verify your Painttrace account: <a href="%s">%s</a></p><p>This link expires in 24 hours.</p>`,
		verifyURL, verifyURL,
	)
	if err := mailer.Send(ctx, user.Email, "Verify your Painttrace account", body); err != nil {
		slog.Error("send-verification: mailer.Send failed", "err", err, "to", user.Email)
	}
}

// VerifyEmailTestHandler handles POST /_test/verify-email.
// Sets email_verified = true for the given email directly in the DB,
// bypassing the token flow. Only registered outside production.
func VerifyEmailTestHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Email string `json:"email"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.BadRequest(w, "invalid request body")
			return
		}
		email := strings.ToLower(strings.TrimSpace(req.Email))
		q := sqlcdb.New(pool)
		if err := q.SetEmailVerifiedByEmail(r.Context(), email); err != nil {
			httperr.InternalServerError(w)
			return
		}
		w.WriteHeader(http.StatusOK)
	}
}
