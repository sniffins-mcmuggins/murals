package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

// InviteReviewerEmail sends a festival-review invite, detached from the request.
// New (passwordless) users get a set-password link via a reset token; existing
// users get a plain log-in notice and their password/session is never touched.
func InviteReviewerEmail(pool *pgxpool.Pool, mailer EmailSender, webBase string, userID pgtype.UUID, email string, hasPassword bool, festivalName string) {
	ctx, cancel := context.WithTimeout(context.Background(), forgotPasswordWorkTimeout)
	defer cancel()

	if hasPassword {
		body := fmt.Sprintf(
			`<p>You've been added as a reviewer for <strong>%s</strong> on Render.</p><p><a href="%s/login">Log in</a> to start reviewing applications.</p>`,
			festivalName, webBase,
		)
		if err := mailer.Send(ctx, email, "You're a reviewer for "+festivalName, body); err != nil {
			slog.Error("reviewer-invite: mailer.Send failed", "err", err, "to", email)
		}
		return
	}

	rawToken := make([]byte, 32)
	if _, err := rand.Read(rawToken); err != nil {
		slog.Error("reviewer-invite: rand.Read failed", "err", err)
		return
	}
	rawHex := hex.EncodeToString(rawToken)
	hash := sha256.Sum256(rawToken)
	tokenHash := hex.EncodeToString(hash[:])

	q := sqlcdb.New(pool)
	if _, err := q.CreatePasswordResetToken(ctx, sqlcdb.CreatePasswordResetTokenParams{
		UserID:    userID,
		TokenHash: tokenHash,
		ExpiresAt: pgTimestamptz(time.Now().Add(24 * time.Hour)),
	}); err != nil {
		slog.Error("reviewer-invite: create token failed", "err", err)
		return
	}

	setURL := fmt.Sprintf("%s/reset-password?token=%s", webBase, rawHex)
	body := fmt.Sprintf(
		`<p>You've been invited to review applications for <strong>%s</strong> on Render.</p><p><a href="%s">Set your password</a> to get started. This link expires in 24 hours.</p>`,
		festivalName, setURL,
	)
	if err := mailer.Send(ctx, email, "Review invitation: "+festivalName, body); err != nil {
		slog.Error("reviewer-invite: mailer.Send failed", "err", err, "to", email)
	}
}
