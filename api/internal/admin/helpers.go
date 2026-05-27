package admin

import (
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

func pgUUIDFromString(s string) (pgtype.UUID, error) {
	parsed, err := uuid.Parse(s)
	if err != nil {
		return pgtype.UUID{}, err
	}
	return pgtype.UUID{Bytes: [16]byte(parsed), Valid: true}, nil
}

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

func pgTimestamptz(t time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: t, Valid: true}
}
