package billing

import (
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stripe/stripe-go/v82"
)

// Prices holds the Stripe Price IDs loaded from config.
type Prices struct {
	ArtistBasicAnnual string
	ArtistBasicMonth  string
	ArtistProAnnual   string
	ArtistProMonth    string
	OrgSetup          string
	FestivalMonth     string
	FestivalAnnual    string
}

// NewStripeClient initialises the Stripe API client with the given secret key.
func NewStripeClient(secretKey string) *stripe.Client {
	return stripe.NewClient(secretKey)
}

// PlanFromPriceID maps a Stripe Price ID to a plan name.
func PlanFromPriceID(priceID string, prices Prices) string {
	switch priceID {
	case prices.ArtistBasicAnnual, prices.ArtistBasicMonth:
		return "artist_basic"
	case prices.ArtistProAnnual, prices.ArtistProMonth:
		return "artist_pro"
	case prices.FestivalAnnual:
		return "festival_annual"
	default:
		return "unknown"
	}
}

// IntervalFromPriceID returns "year" or "month" for a given price ID.
func IntervalFromPriceID(priceID string, prices Prices) string {
	switch priceID {
	case prices.ArtistBasicAnnual, prices.ArtistProAnnual, prices.FestivalAnnual:
		return "year"
	default:
		return "month"
	}
}

// pgUUIDFromString parses a UUID string into pgtype.UUID.
func pgUUIDFromString(s string) (pgtype.UUID, error) {
	parsed, err := uuid.Parse(s)
	if err != nil {
		return pgtype.UUID{}, err
	}
	return pgtype.UUID{Bytes: [16]byte(parsed), Valid: true}, nil
}

// pgUUIDNullable parses a UUID string into pgtype.UUID, returning invalid (NULL) for empty string.
func pgUUIDNullable(s string) pgtype.UUID {
	if s == "" {
		return pgtype.UUID{}
	}
	v, err := pgUUIDFromString(s)
	if err != nil {
		return pgtype.UUID{}
	}
	return v
}
