package artist

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/billing"
	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

// PublishHandler handles POST /profiles/me/publish.
// Flips the caller's profile from draft to public, gated on entitlement.
// Idempotent: already-public profiles return 200 immediately.
func PublishHandler(pool *pgxpool.Pool) http.HandlerFunc {
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
		existing, err := q.GetArtistProfileByUserID(r.Context(), userUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}

		if existing.Visibility == "public" {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(toProfileResponse(existing, false))
			return
		}

		canPub, err := billing.CanPublish(r.Context(), pool, userUUID)
		if err != nil {
			slog.Error("publish: check entitlement", "err", err, "user_id", principal.UserID)
			httperr.InternalServerError(w)
			return
		}
		if !canPub {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusPaymentRequired)
			_ = json.NewEncoder(w).Encode(map[string]string{
				"code":    "payment_required",
				"message": "An active artist subscription or comp grant is required to publish.",
			})
			return
		}

		updated, err := q.SetArtistProfileVisibility(r.Context(), sqlcdb.SetArtistProfileVisibilityParams{
			UserID:     userUUID,
			Visibility: "public",
		})
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		if err := publishSnapshotTx(r.Context(), pool, updated); err != nil {
			slog.Error("publish: seed initial snapshot", "err", err, "profile_id", updated.ID.String())
			httperr.InternalServerError(w)
			return
		}
		updated, err = q.GetArtistProfileByUserID(r.Context(), userUUID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(toProfileResponse(updated, false))
	}
}

// UnpublishHandler handles POST /profiles/me/unpublish.
// Flips the caller's profile from public to draft. Always allowed.
// Idempotent: already-draft profiles return 200 immediately.
func UnpublishHandler(pool *pgxpool.Pool) http.HandlerFunc {
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
		existing, err := q.GetArtistProfileByUserID(r.Context(), userUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}

		if existing.Visibility == "draft" {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(toProfileResponse(existing, false))
			return
		}

		updated, err := q.SetArtistProfileVisibility(r.Context(), sqlcdb.SetArtistProfileVisibilityParams{
			UserID:     userUUID,
			Visibility: "draft",
		})
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(toProfileResponse(updated, false))
	}
}
