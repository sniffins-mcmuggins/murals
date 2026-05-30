package analytics

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

// AnalyticsResponse is the JSON body returned by GET /profiles/me/analytics.
type AnalyticsResponse struct {
	ProfileViews int64 `json:"profile_views"`
	QRScans      int64 `json:"qr_scans"`
	LinkClicks   int64 `json:"link_clicks"`
	// WindowDays is the number of days covered by this report.
	// Free tier: 90 days. Pro tier: 730 days (2 years).
	WindowDays int `json:"window_days"`
}

const (
	freeWindowDays = 90
	proWindowDays  = 730
)

// hasPro returns true when the user has an active artist_pro subscription or
// a matching access grant. Mirrors the billing.RequirePlan check without
// blocking — we use it to choose a window size, not to gate access.
func hasPro(ctx context.Context, pool *pgxpool.Pool, userUUID pgtype.UUID) (bool, error) {
	q := sqlcdb.New(pool)
	sub, err := q.GetActiveSubscription(ctx, sqlcdb.GetActiveSubscriptionParams{
		UserID:     userUUID,
		FestivalID: pgtype.UUID{},
	})
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return false, err
	}
	if err == nil {
		order := map[string]int{"artist_basic": 1, "artist_pro": 2}
		if order[sub.Plan] >= order["artist_pro"] {
			return true, nil
		}
	}
	// No qualifying subscription — check grants.
	return q.HasActiveGrant(ctx, sqlcdb.HasActiveGrantParams{
		UserID:     userUUID,
		Plan:       "artist_pro",
		FestivalID: pgtype.UUID{},
	})
}

// pgUUIDFromString parses a UUID string into a pgtype.UUID. Duplicated from
// the artist package to keep this package self-contained.
func pgUUIDFromString(s string) (pgtype.UUID, error) {
	var id pgtype.UUID
	if err := id.Scan(s); err != nil {
		return pgtype.UUID{}, err
	}
	return id, nil
}

// LinkClickHandler handles POST /profiles/{profileID}/link-click. Public — no auth.
// Records a link_click event for the given profile and returns 204 immediately.
func LinkClickHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		profileID := chi.URLParam(r, "profileID")
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if err := RecordEvent(ctx, pool, EventLinkClick, profileID); err != nil {
				slog.Error("link-click: record failed", "err", err)
			}
		}()
		w.WriteHeader(http.StatusNoContent)
	}
}

// MyAnalyticsHandler handles GET /profiles/me/analytics. Requires auth.
// Returns aggregated event counts for the authenticated artist's profile.
// Window: 90 days (free) or 730 days (pro).
func MyAnalyticsHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, err := auth.User(r.Context())
		if err != nil {
			httperr.Unauthorized(w)
			return
		}
		userUUID, err := pgUUIDFromString(principal.UserID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		q := sqlcdb.New(pool)
		profile, err := q.GetArtistProfileByUserID(r.Context(), userUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}

		windowDays := freeWindowDays
		isPro, err := hasPro(r.Context(), pool, userUUID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}
		if isPro {
			windowDays = proWindowDays
		}

		since := time.Now().AddDate(0, 0, -windowDays)
		counts, err := GetCounts(r.Context(), pool, profile.ID.String(), since)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(AnalyticsResponse{
			ProfileViews: counts[EventProfileView],
			QRScans:      counts[EventQRScan],
			LinkClicks:   counts[EventLinkClick],
			WindowDays:   windowDays,
		})
	}
}
