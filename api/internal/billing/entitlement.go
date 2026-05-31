package billing

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

// CanPublish returns true when the user has a qualifying artist entitlement:
// either an active paid subscription (artist_basic or artist_pro) or an active
// access grant for either plan. Returns an error only for transient DB failures.
func CanPublish(ctx context.Context, pool *pgxpool.Pool, userUUID pgtype.UUID) (bool, error) {
	q := sqlcdb.New(pool)

	// Check active subscription first (Stripe-backed).
	sub, err := q.GetActiveSubscription(ctx, sqlcdb.GetActiveSubscriptionParams{
		UserID:     userUUID,
		FestivalID: pgtype.UUID{},
	})
	if err == nil {
		if sub.Plan == "artist_basic" || sub.Plan == "artist_pro" {
			return true, nil
		}
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return false, err
	}

	// Check access grants (admin comps, promo codes).
	hasBasic, err := q.HasActiveGrant(ctx, sqlcdb.HasActiveGrantParams{
		UserID:     userUUID,
		Plan:       "artist_basic",
		FestivalID: pgtype.UUID{},
	})
	if err != nil {
		return false, err
	}
	if hasBasic {
		return true, nil
	}

	hasPro, err := q.HasActiveGrant(ctx, sqlcdb.HasActiveGrantParams{
		UserID:     userUUID,
		Plan:       "artist_pro",
		FestivalID: pgtype.UUID{},
	})
	return hasPro, err
}
