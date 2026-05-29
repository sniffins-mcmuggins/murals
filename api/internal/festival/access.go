package festival

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

type festivalRole int

const (
	roleNone festivalRole = iota
	roleReviewer
	roleOwner
)

// resolveFestivalAccess returns the caller's role for a festival.
// owner    = festival.organiser_id == userID
// reviewer = row in festival_reviewers
// none     = neither
// Returns pgx.ErrNoRows only if the festival itself does not exist.
func resolveFestivalAccess(ctx context.Context, q *sqlcdb.Queries, festUUID pgtype.UUID, userID string) (festivalRole, error) {
	fest, err := q.GetFestivalByID(ctx, festUUID)
	if err != nil {
		return roleNone, err
	}
	if fest.OrganiserID.String() == userID {
		return roleOwner, nil
	}
	uid, err := pgUUIDFromString(userID)
	if err != nil {
		return roleNone, nil
	}
	_, err = q.GetFestivalReviewer(ctx, sqlcdb.GetFestivalReviewerParams{
		FestivalID: festUUID,
		UserID:     uid,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return roleNone, nil
		}
		return roleNone, err
	}
	return roleReviewer, nil
}
