package festival

import "github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"

type reviewRoundState int //nolint:unused

const (
	reviewNotStarted reviewRoundState = iota //nolint:unused
	reviewOpen                               //nolint:unused
	reviewClosed                             //nolint:unused
)

// reviewRoundStatus derives the round state from the festival's timestamps.
func reviewRoundStatus(f sqlcdb.Festival) reviewRoundState { //nolint:unused
	if f.ReviewClosedAt.Valid {
		return reviewClosed
	}
	if f.ReviewOpenedAt.Valid {
		return reviewOpen
	}
	return reviewNotStarted
}
