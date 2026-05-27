package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"

	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

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
func ForgotPasswordHandler(pool *pgxpool.Pool, mailer EmailSender, baseURL string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req forgotRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.BadRequest(w, "invalid request body")
			return
		}

		w.WriteHeader(http.StatusAccepted)

		go func() {
			ctx := context.Background()
			q := sqlcdb.New(pool)
			user, err := q.GetUserByEmail(ctx, req.Email)
			if err != nil {
				return
			}
			if user.PasswordHash == nil {
				return // OAuth-only user — password reset not applicable
			}

			rawToken := make([]byte, 32)
			if _, err := rand.Read(rawToken); err != nil {
				return
			}
			rawHex := hex.EncodeToString(rawToken)
			hash := sha256.Sum256(rawToken)
			tokenHash := hex.EncodeToString(hash[:])

			_, err = q.CreatePasswordResetToken(ctx, sqlcdb.CreatePasswordResetTokenParams{
				UserID:    user.ID,
				TokenHash: tokenHash,
				ExpiresAt: pgtype_timestamptz(time.Now().Add(time.Hour)),
			})
			if err != nil {
				return
			}

			resetURL := fmt.Sprintf("%s/reset-password?token=%s", baseURL, rawHex)
			body := fmt.Sprintf(`<p>Reset your Render password: <a href="%s">%s</a></p><p>This link expires in 1 hour.</p>`, resetURL, resetURL)
			_ = mailer.Send(ctx, user.Email, "Reset your Render password", body)
		}()
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

		if err = q.MarkResetTokenUsed(r.Context(), rec.ID); err != nil {
			httperr.InternalServerError(w)
			return
		}

		w.WriteHeader(http.StatusOK)
	}
}
