package auth

import (
	"context"
	"fmt"
	"log/slog"
)

// ReviewRoundOpenEmail notifies a reviewer that scoring is open for a festival.
// Best-effort: logs errors, never blocks the caller.
func ReviewRoundOpenEmail(ctx context.Context, mailer EmailSender, webBase, email, festivalName string) {
	subject := fmt.Sprintf("Scoring is open for %s", festivalName)
	body := fmt.Sprintf(
		`<p>The organiser has opened reviewer scoring for <strong>%s</strong>.</p>`+
			`<p><a href="%s/organiser/reviewing">Sign in to score the applicants</a>.</p>`,
		festivalName, webBase)
	if err := mailer.Send(ctx, email, subject, body); err != nil {
		slog.Error("review-round open email failed", "err", err, "email", email)
	}
}
