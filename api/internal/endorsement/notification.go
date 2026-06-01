package endorsement

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

// sendEndorseeNotification emails the endorsee asynchronously.
// Errors are logged and swallowed — the endorsement is already saved.
func sendEndorseeNotification(pool *pgxpool.Pool, mailer auth.EmailSender, endorseeProfileID pgtype.UUID, endorserName string) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

		q := sqlcdb.New(pool)
		profile, err := q.GetArtistProfileByID(ctx, endorseeProfileID)
		if err != nil {
			slog.Error("endorsement notification: get profile", "err", err)
			return
		}
		if !profile.UserID.Valid {
			return // unclaimed prospect profile — no user to notify
		}
		user, err := q.GetUserByID(ctx, profile.UserID)
		if err != nil {
			slog.Error("endorsement notification: get user", "err", err)
			return
		}

		escapedName := html.EscapeString(endorserName)
		subject := "You received an endorsement"
		body := "<p>" + escapedName + " has endorsed your Render profile.</p>"
		if err := mailer.Send(ctx, user.Email, subject, body); err != nil {
			slog.Error("endorsement notification: send failed", "err", err, "to", user.Email)
		}
	}()
}
