package artist

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

type collectionImageResponse struct {
	ID           string `json:"id"`
	CollectionID string `json:"collection_id"`
	S3Key        string `json:"s3_key"`
	CdnURL       string `json:"cdn_url"`
	DisplayOrder int32  `json:"display_order"`
	CreatedAt    string `json:"created_at"`
}

func toImageResponse(img sqlcdb.CollectionImage) collectionImageResponse {
	return collectionImageResponse{
		ID:           img.ID.String(),
		CollectionID: img.CollectionID.String(),
		S3Key:        img.S3Key,
		CdnURL:       img.CdnUrl,
		DisplayOrder: img.DisplayOrder,
		CreatedAt:    img.CreatedAt.Time.Format(time.RFC3339),
	}
}

// AttachImageHandler handles POST /collections/{collectionID}/images. Requires owner.
func AttachImageHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, err := auth.User(r.Context())
		if err != nil {
			httperr.Unauthorized(w)
			return
		}

		collectionUUID, err := pgUUIDFromString(chi.URLParam(r, "collectionID"))
		if err != nil {
			httperr.BadRequest(w, "invalid collectionID")
			return
		}

		var req struct {
			S3Key  string `json:"s3Key"`
			CdnURL string `json:"cdnUrl"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.BadRequest(w, "invalid request body")
			return
		}
		if req.S3Key == "" || req.CdnURL == "" {
			httperr.UnprocessableEntity(w, "s3Key and cdnUrl are required")
			return
		}

		userUUID, err := pgUUIDFromString(principal.UserID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		q := sqlcdb.New(pool)
		collection, err := q.GetCollectionByID(r.Context(), collectionUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}
		profile, err := q.GetArtistProfileByUserID(r.Context(), userUUID)
		if err != nil || profile.ID != collection.ArtistProfileID {
			httperr.Forbidden(w)
			return
		}

		count, err := q.CountCollectionImages(r.Context(), collection.ID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		img, err := q.AttachCollectionImage(r.Context(), sqlcdb.AttachCollectionImageParams{
			CollectionID: collection.ID,
			S3Key:        req.S3Key,
			CdnUrl:       req.CdnURL,
			DisplayOrder: int32(count),
		})
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(toImageResponse(img))
	}
}

// ReorderImagesHandler handles PUT /collections/{collectionID}/images/order. Requires owner.
// Body: {"imageIds": ["uuid1", "uuid2", ...]} — ordered list; sets display_order by position (0-indexed).
func ReorderImagesHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, err := auth.User(r.Context())
		if err != nil {
			httperr.Unauthorized(w)
			return
		}

		collectionUUID, err := pgUUIDFromString(chi.URLParam(r, "collectionID"))
		if err != nil {
			httperr.BadRequest(w, "invalid collectionID")
			return
		}

		var req struct {
			ImageIDs []string `json:"imageIds"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.BadRequest(w, "invalid request body")
			return
		}
		if len(req.ImageIDs) == 0 {
			httperr.UnprocessableEntity(w, "imageIds must be a non-empty array")
			return
		}

		userUUID, err := pgUUIDFromString(principal.UserID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		q := sqlcdb.New(pool)
		collection, err := q.GetCollectionByID(r.Context(), collectionUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}
		profile, err := q.GetArtistProfileByUserID(r.Context(), userUUID)
		if err != nil || profile.ID != collection.ArtistProfileID {
			httperr.Forbidden(w)
			return
		}

		for i, idStr := range req.ImageIDs {
			imgUUID, err := pgUUIDFromString(idStr)
			if err != nil {
				httperr.BadRequest(w, "invalid image id: "+idStr)
				return
			}
			if err := q.UpdateCollectionImageOrder(r.Context(), sqlcdb.UpdateCollectionImageOrderParams{
				ID:           imgUUID,
				DisplayOrder: int32(i),
			}); err != nil {
				httperr.InternalServerError(w)
				return
			}
		}

		images, err := q.ListCollectionImages(r.Context(), collection.ID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}
		resp := make([]collectionImageResponse, len(images))
		for i, img := range images {
			resp[i] = toImageResponse(img)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}
}

// DeleteImageHandler handles DELETE /collections/{collectionID}/images/{imageID}. Requires owner.
func DeleteImageHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, err := auth.User(r.Context())
		if err != nil {
			httperr.Unauthorized(w)
			return
		}

		collectionUUID, err := pgUUIDFromString(chi.URLParam(r, "collectionID"))
		if err != nil {
			httperr.BadRequest(w, "invalid collectionID")
			return
		}
		imageUUID, err := pgUUIDFromString(chi.URLParam(r, "imageID"))
		if err != nil {
			httperr.BadRequest(w, "invalid imageID")
			return
		}

		userUUID, err := pgUUIDFromString(principal.UserID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		q := sqlcdb.New(pool)
		collection, err := q.GetCollectionByID(r.Context(), collectionUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}
		profile, err := q.GetArtistProfileByUserID(r.Context(), userUUID)
		if err != nil || profile.ID != collection.ArtistProfileID {
			httperr.Forbidden(w)
			return
		}

		img, err := q.GetCollectionImageByID(r.Context(), imageUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}
		if img.CollectionID != collection.ID {
			httperr.NotFound(w)
			return
		}

		if err := q.DeleteCollectionImage(r.Context(), img.ID); err != nil {
			httperr.InternalServerError(w)
			return
		}

		w.WriteHeader(http.StatusNoContent)
	}
}
