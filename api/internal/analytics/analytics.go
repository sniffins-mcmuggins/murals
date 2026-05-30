package analytics

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// EventType enumerates the analytics events we track. All are aggregated per
// profile — no individual user identifiers are stored (GDPR-clean).
type EventType string

const (
	EventProfileView EventType = "profile_view"
	EventQRScan      EventType = "qr_scan"
	EventLinkClick   EventType = "link_click"
)

var validEvents = map[EventType]struct{}{
	EventProfileView: {},
	EventQRScan:      {},
	EventLinkClick:   {},
}

// RecordEvent inserts one analytics event row. profileID is a UUID string.
// Returns an error if the event type is not a recognised value so callers
// get a loud failure rather than a silent DB constraint violation.
func RecordEvent(ctx context.Context, db *pgxpool.Pool, et EventType, profileID string) error {
	if _, ok := validEvents[et]; !ok {
		return fmt.Errorf("analytics: unknown event type %q", et)
	}
	_, err := db.Exec(ctx,
		`INSERT INTO analytics_events (event_type, profile_id) VALUES ($1, $2)`,
		string(et), profileID,
	)
	return err
}

// Counts maps each event type to its total count in the time window.
type Counts map[EventType]int64

// GetCounts returns aggregated event counts for a profile since the given time.
// Every known EventType is always present in the result (zero if no events).
func GetCounts(ctx context.Context, db *pgxpool.Pool, profileID string, since time.Time) (Counts, error) {
	rows, err := db.Query(ctx,
		`SELECT event_type, COUNT(*) AS n
		 FROM analytics_events
		 WHERE profile_id = $1 AND occurred_at >= $2
		 GROUP BY event_type`,
		profileID, since,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	counts := Counts{
		EventProfileView: 0,
		EventQRScan:      0,
		EventLinkClick:   0,
	}
	for rows.Next() {
		var et string
		var n int64
		if err := rows.Scan(&et, &n); err != nil {
			return nil, err
		}
		counts[EventType(et)] = n
	}
	return counts, rows.Err()
}
