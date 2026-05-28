package festival

import (
	"context"
	"html"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

// sendApplicationNotification emails the artist about a status change.
// Runs in a detached goroutine — errors are logged, never propagated.
func sendApplicationNotification(pool *pgxpool.Pool, mailer auth.EmailSender, artistID pgtype.UUID, festivalName, status string) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

		q := sqlcdb.New(pool)
		profile, err := q.GetArtistProfileByID(ctx, artistID)
		if err != nil {
			slog.Error("application notification: get artist profile", "err", err)
			return
		}
		user, err := q.GetUserByID(ctx, profile.UserID)
		if err != nil {
			slog.Error("application notification: get user", "err", err)
			return
		}

		escapedName := html.EscapeString(festivalName)
		subject := "Your application to " + festivalName
		var body string
		switch status {
		case "accepted":
			body = "Congratulations — your application to " + escapedName + " has been accepted."
		case "declined":
			body = "Thank you for applying to " + escapedName + ". Unfortunately your application was not successful this time."
		case "waitlisted":
			body = "Thank you for applying to " + escapedName + ". You're on the waitlist — we'll be in touch if a spot opens up."
		default:
			return
		}

		if err := mailer.Send(ctx, user.Email, subject, "<p>"+body+"</p>"); err != nil {
			slog.Error("application notification: send failed", "err", err, "to", user.Email)
		}
	}()
}
