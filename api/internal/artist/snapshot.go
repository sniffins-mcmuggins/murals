package artist

import (
	"context"
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

// profileSnapshot is the frozen public read-model stored in profile_snapshots.
// Built from the same builders used for live rendering so the shape cannot drift.
type profileSnapshot struct {
	Profile     profileResponse      `json:"profile"`
	Collections []collectionSnapshot `json:"collections"`
}

type collectionSnapshot struct {
	collectionResponse
	Images []imageSnapshot `json:"images"`
}

type imageSnapshot struct {
	ID           string `json:"id"`
	S3Key        string `json:"s3_key"`
	CdnURL       string `json:"cdn_url"`
	DisplayOrder int32  `json:"display_order"`
}

// isOwner reports whether the request principal owns this profile.
func isOwner(r *http.Request, profile sqlcdb.ArtistProfile) bool {
	principal, err := auth.User(r.Context())
	if err != nil {
		return false
	}
	return profile.UserID.Valid && principal.UserID == profile.UserID.String()
}

// buildProfileSnapshot assembles the public read-model for a profile from the
// live tables. public=true so the serializer drops owner-only fields.
func buildProfileSnapshot(ctx context.Context, q *sqlcdb.Queries, profile sqlcdb.ArtistProfile) (profileSnapshot, error) {
	snap := profileSnapshot{Profile: toProfileResponse(profile, true)}

	collections, err := q.ListCollectionsByProfileID(ctx, profile.ID)
	if err != nil {
		return profileSnapshot{}, err
	}
	for _, c := range collections {
		cs := collectionSnapshot{collectionResponse: toCollectionResponse(c)}
		images, err := q.ListCollectionImages(ctx, c.ID)
		if err != nil {
			return profileSnapshot{}, err
		}
		for _, im := range images {
			cs.Images = append(cs.Images, imageSnapshot{
				ID:           im.ID.String(),
				S3Key:        im.S3Key,
				CdnURL:       im.CdnUrl,
				DisplayOrder: im.DisplayOrder,
			})
		}
		snap.Collections = append(snap.Collections, cs)
	}
	return snap, nil
}

// publishSnapshotTx builds the snapshot and upserts it + clears the dirty flag
// in one transaction. Shared by PublishChangesHandler and the first Go-Public.
func publishSnapshotTx(ctx context.Context, pool *pgxpool.Pool, profile sqlcdb.ArtistProfile) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := sqlcdb.New(tx)

	snap, err := buildProfileSnapshot(ctx, qtx, profile)
	if err != nil {
		return err
	}
	raw, err := json.Marshal(snap)
	if err != nil {
		return err
	}
	if err := qtx.UpsertProfileSnapshot(ctx, sqlcdb.UpsertProfileSnapshotParams{
		ArtistProfileID: profile.ID,
		Snapshot:        raw,
	}); err != nil {
		return err
	}
	if err := qtx.ClearProfileChanges(ctx, profile.ID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// PublishChangesHandler handles POST /profiles/me/publish-changes.
// Serializes the caller's live draft into profile_snapshots atomically and
// clears has_unpublished_changes. Gated on billing entitlement, same as publish.
func PublishChangesHandler(pool *pgxpool.Pool) http.HandlerFunc {
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

		canPub, err := billing.CanPublish(r.Context(), pool, userUUID)
		if err != nil {
			slog.Error("publish-changes: check entitlement", "err", err, "user_id", principal.UserID)
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

		if err := publishSnapshotTx(r.Context(), pool, profile); err != nil {
			slog.Error("publish-changes: write snapshot", "err", err, "profile_id", profile.ID.String())
			httperr.InternalServerError(w)
			return
		}

		updated, err := q.GetArtistProfileByUserID(r.Context(), userUUID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(toProfileResponse(updated, false))
	}
}
