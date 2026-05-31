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

func clampFocal(v float32) float32 {
	if v < 0 {
		return 0
	}
	if v > 100 {
		return 100
	}
	return v
}

type collectionResponse struct {
	ID              string  `json:"id"`
	ArtistProfileID string  `json:"artist_profile_id"`
	Name            string  `json:"name"`
	Description     string  `json:"description"`
	CoverS3Key      *string `json:"cover_s3_key,omitempty"`
	Status          string  `json:"status"`
	DisplayOrder    int32   `json:"display_order"`
	CoverFocalX     float32 `json:"cover_focal_x"`
	CoverFocalY     float32 `json:"cover_focal_y"`
	CreatedAt       string  `json:"created_at"`
	UpdatedAt       string  `json:"updated_at"`
}

func toCollectionResponse(c sqlcdb.Collection) collectionResponse {
	return collectionResponse{
		ID:              c.ID.String(),
		ArtistProfileID: c.ArtistProfileID.String(),
		Name:            c.Name,
		Description:     c.Description,
		CoverS3Key:      c.CoverS3Key,
		Status:          string(c.Status),
		DisplayOrder:    c.DisplayOrder,
		CoverFocalX:     c.CoverFocalX,
		CoverFocalY:     c.CoverFocalY,
		CreatedAt:       c.CreatedAt.Time.Format(time.RFC3339),
		UpdatedAt:       c.UpdatedAt.Time.Format(time.RFC3339),
	}
}

// CreateCollectionHandler handles POST /collections. Requires auth + existing artist profile.
func CreateCollectionHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, err := auth.User(r.Context())
		if err != nil {
			httperr.Unauthorized(w)
			return
		}

		var req struct {
			Name        string `json:"name"`
			Description string `json:"description"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.BadRequest(w, "invalid request body")
			return
		}
		if req.Name == "" {
			httperr.UnprocessableEntity(w, "name is required")
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

		collection, err := q.CreateCollection(r.Context(), sqlcdb.CreateCollectionParams{
			ArtistProfileID: profile.ID,
			Name:            req.Name,
			Description:     req.Description,
		})
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(toCollectionResponse(collection))
	}
}

// GetCollectionHandler handles GET /collections/{collectionID}. Public.
func GetCollectionHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		collectionUUID, err := pgUUIDFromString(chi.URLParam(r, "collectionID"))
		if err != nil {
			httperr.BadRequest(w, "invalid collectionID")
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

		// Visibility gate: collection is only visible if the parent profile is public
		// or the caller is the owner.
		profile, err := q.GetArtistProfileByID(r.Context(), collection.ArtistProfileID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}
		if profile.Visibility != "public" {
			principal, authErr := auth.User(r.Context())
			if authErr != nil || principal.UserID != profile.UserID.String() {
				httperr.NotFound(w)
				return
			}
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(toCollectionResponse(collection))
	}
}

// ListCollectionsHandler handles GET /profiles/{profileID}/collections. Public.
// Draft profiles return 404 for non-owners, matching GetProfileHandler behaviour.
func ListCollectionsHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		profileUUID, err := pgUUIDFromString(chi.URLParam(r, "profileID"))
		if err != nil {
			httperr.BadRequest(w, "invalid profileID")
			return
		}
		q := sqlcdb.New(pool)

		// Visibility gate: look up the profile first, 404 draft for non-owners.
		profile, err := q.GetArtistProfileByID(r.Context(), profileUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}
		if profile.Visibility != "public" {
			principal, authErr := auth.User(r.Context())
			if authErr != nil || principal.UserID != profile.UserID.String() {
				httperr.NotFound(w)
				return
			}
		}

		collections, err := q.ListCollectionsByProfileID(r.Context(), profileUUID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}
		resp := make([]collectionResponse, len(collections))
		for i, c := range collections {
			resp[i] = toCollectionResponse(c)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}
}

// UpdateCollectionHandler handles PATCH /collections/{collectionID}. Requires owner.
func UpdateCollectionHandler(pool *pgxpool.Pool) http.HandlerFunc {
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
			Name        string   `json:"name"`
			Description string   `json:"description"`
			CoverS3Key  *string  `json:"coverS3Key"`
			Status      string   `json:"status"`
			CoverFocalX *float32 `json:"coverFocalX"`
			CoverFocalY *float32 `json:"coverFocalY"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.BadRequest(w, "invalid request body")
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

		// Ownership check
		profile, err := q.GetArtistProfileByUserID(r.Context(), userUUID)
		if err != nil || profile.ID != collection.ArtistProfileID {
			httperr.Forbidden(w)
			return
		}

		// Merge: use existing values for any field not supplied
		name := collection.Name
		if req.Name != "" {
			name = req.Name
		}
		description := collection.Description
		if req.Description != "" {
			description = req.Description
		}
		coverS3Key := collection.CoverS3Key
		if req.CoverS3Key != nil {
			coverS3Key = req.CoverS3Key
		}
		status := collection.Status
		if req.Status != "" {
			status = sqlcdb.CollectionStatus(req.Status)
		}
		coverFocalX := collection.CoverFocalX
		if req.CoverFocalX != nil {
			coverFocalX = clampFocal(*req.CoverFocalX)
		}
		coverFocalY := collection.CoverFocalY
		if req.CoverFocalY != nil {
			coverFocalY = clampFocal(*req.CoverFocalY)
		}

		updated, err := q.UpdateCollection(r.Context(), sqlcdb.UpdateCollectionParams{
			ID:          collection.ID,
			Name:        name,
			Description: description,
			CoverS3Key:  coverS3Key,
			Status:      status,
			CoverFocalX: coverFocalX,
			CoverFocalY: coverFocalY,
		})
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(toCollectionResponse(updated))
	}
}

// ReorderCollectionsHandler handles PUT /collections/order. Requires auth + owner.
// Body: {"collectionIds": ["uuid1", "uuid2", ...]} — ordered list; sets display_order by position (0-indexed).
func ReorderCollectionsHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, err := auth.User(r.Context())
		if err != nil {
			httperr.Unauthorized(w)
			return
		}

		var req struct {
			CollectionIDs []string `json:"collectionIds"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.BadRequest(w, "invalid request body")
			return
		}
		if len(req.CollectionIDs) == 0 {
			httperr.UnprocessableEntity(w, "collectionIds must be a non-empty array")
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
			httperr.Forbidden(w)
			return
		}

		existing, err := q.ListCollectionsByProfileID(r.Context(), profile.ID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}
		validIDs := make(map[string]bool, len(existing))
		for _, c := range existing {
			validIDs[c.ID.String()] = true
		}
		for _, id := range req.CollectionIDs {
			if !validIDs[id] {
				httperr.UnprocessableEntity(w, "collection not found: "+id)
				return
			}
		}

		tx, err := pool.BeginTx(r.Context(), pgx.TxOptions{})
		if err != nil {
			httperr.InternalServerError(w)
			return
		}
		defer func() { _ = tx.Rollback(r.Context()) }()
		tq := sqlcdb.New(tx)

		for i, idStr := range req.CollectionIDs {
			collUUID, err := pgUUIDFromString(idStr)
			if err != nil {
				httperr.BadRequest(w, "invalid collection id: "+idStr)
				return
			}
			if err := tq.UpdateCollectionOrder(r.Context(), sqlcdb.UpdateCollectionOrderParams{
				ID:           collUUID,
				DisplayOrder: int32(i),
			}); err != nil {
				httperr.InternalServerError(w)
				return
			}
		}

		if err := tx.Commit(r.Context()); err != nil {
			httperr.InternalServerError(w)
			return
		}

		w.WriteHeader(http.StatusNoContent)
	}
}

// DeleteCollectionHandler handles DELETE /collections/{collectionID}. Requires owner.
func DeleteCollectionHandler(pool *pgxpool.Pool) http.HandlerFunc {
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

		if err := q.DeleteCollection(r.Context(), collection.ID); err != nil {
			httperr.InternalServerError(w)
			return
		}

		w.WriteHeader(http.StatusNoContent)
	}
}
