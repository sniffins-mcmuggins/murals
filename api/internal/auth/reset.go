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
	"golang.org/x/crypto/bcrypt"

	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

// forgotPasswordWorkTimeout caps the lifetime of the goroutine that creates
// the reset token and sends the email. Bounded to avoid orphaned work surviving
// process shutdown (and to fail loudly if SES hangs).
const forgotPasswordWorkTimeout = 30 * time.Second

// EmailSender is satisfied by email.Sender and by test stubs.
type EmailSender interface {
	Send(ctx context.Context, to, subject, bodyHTML string) error
}

// NoopMailer silently discards emails (used when SES is not configured).
type NoopMailer struct{}

func (NoopMailer) Send(_ context.Context, _, _, _ string) error { return nil }

type forgotRequest struct {
	Email string `json:"email"`
}

// ForgotPasswordHandler handles POST /auth/forgot-password.
// Always returns 202 to avoid leaking whether an email is registered.
// webBase is the public URL of the web app — reset links point at /reset-password there.
func ForgotPasswordHandler(pool *pgxpool.Pool, mailer EmailSender, webBase string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req forgotRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.BadRequest(w, "invalid request body")
			return
		}

		// Normalize email to match signup-time storage (lowercased + trimmed).
		email := strings.ToLower(strings.TrimSpace(req.Email))

		w.WriteHeader(http.StatusAccepted)

		go ForgotPasswordWork(pool, mailer, webBase, email)
	}
}

// ForgotPasswordWork runs the DB write + SES send detached from the HTTP
// request. Bounded context + error logging so failures are visible.
func ForgotPasswordWork(pool *pgxpool.Pool, mailer EmailSender, webBase, email string) {
	ctx, cancel := context.WithTimeout(context.Background(), forgotPasswordWorkTimeout)
	defer cancel()

	q := sqlcdb.New(pool)
	user, err := q.GetUserByEmail(ctx, email)
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			slog.Error("forgot-password: user lookup failed", "err", err)
		}
		return
	}
	if user.PasswordHash == nil {
		// OAuth-only user — password reset doesn't apply. Don't email (would
		// confuse them) and don't log at error level (this is normal).
		slog.Debug("forgot-password: oauth-only user skipped", "user_id", user.ID.String())
		return
	}

	rawToken := make([]byte, 32)
	if _, err := rand.Read(rawToken); err != nil {
		slog.Error("forgot-password: rand.Read failed", "err", err)
		return
	}
	rawHex := hex.EncodeToString(rawToken)
	hash := sha256.Sum256(rawToken)
	tokenHash := hex.EncodeToString(hash[:])

	if _, err = q.CreatePasswordResetToken(ctx, sqlcdb.CreatePasswordResetTokenParams{
		UserID:    user.ID,
		TokenHash: tokenHash,
		ExpiresAt: pgTimestamptz(time.Now().Add(time.Hour)),
	}); err != nil {
		slog.Error("forgot-password: create token failed", "err", err)
		return
	}

	resetURL := fmt.Sprintf("%s/reset-password?token=%s", webBase, rawHex)
	body := fmt.Sprintf(`<p>Reset your Render password: <a href="%s">%s</a></p><p>This link expires in 1 hour.</p>`, resetURL, resetURL)
	if err := mailer.Send(ctx, user.Email, "Reset your Render password", body); err != nil {
		slog.Error("forgot-password: mailer.Send failed", "err", err, "to", user.Email)
	}
}

type resetRequest struct {
	Token       string `json:"token"`
	NewPassword string `json:"new_password"`
}

// ResetPasswordHandler handles POST /auth/reset-password.
func ResetPasswordHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req resetRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.BadRequest(w, "invalid request body")
			return
		}
		if len(req.NewPassword) < 8 {
			httperr.UnprocessableEntity(w, "password must be at least 8 characters")
			return
		}

		raw, err := hex.DecodeString(req.Token)
		if err != nil || len(raw) == 0 {
			httperr.BadRequest(w, "invalid token")
			return
		}
		hash := sha256.Sum256(raw)
		tokenHash := hex.EncodeToString(hash[:])

		q := sqlcdb.New(pool)
		rec, err := q.GetPasswordResetToken(r.Context(), tokenHash)
		if err != nil {
			if err == pgx.ErrNoRows {
				httperr.BadRequest(w, "invalid or expired token")
				return
			}
			httperr.InternalServerError(w)
			return
		}

		newHash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), 12)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		newHashStr := string(newHash)
		if _, err = q.UpdateUserPassword(r.Context(), sqlcdb.UpdateUserPasswordParams{
			ID:           rec.UserID,
			PasswordHash: &newHashStr,
		}); err != nil {
			httperr.InternalServerError(w)
			return
		}

		// Invalidate every JWT issued before this reset. The middleware compares
		// claims.sv to users.session_version; bumping the column here makes
		// every outstanding token fail that check on the next request. This is
		// the entire point of resetting a password vs. just changing it — if
		// the reset was triggered by a compromise, the attacker's session is
		// dead within seconds rather than living up to tokenTTL (7 days).
		if _, err = q.IncrementSessionVersion(r.Context(), rec.UserID); err != nil {
			httperr.InternalServerError(w)
			return
		}

		if err = q.MarkResetTokenUsed(r.Context(), rec.ID); err != nil {
			httperr.InternalServerError(w)
			return
		}

		w.WriteHeader(http.StatusOK)
	}
}
