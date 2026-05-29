package festival

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

type formResponse struct {
	ID              string          `json:"id"`
	FestivalID      string          `json:"festival_id"`
	Fields          json.RawMessage `json:"fields"`
	OpenAt          *string         `json:"open_at,omitempty"`
	CloseAt         *string         `json:"close_at,omitempty"`
	MaxApplications *int32          `json:"max_applications,omitempty"`
	AnonymousReview bool            `json:"anonymous_review"`
	CreatedAt       string          `json:"created_at"`
	UpdatedAt       string          `json:"updated_at"`
}

func toFormResponse(f sqlcdb.ApplicationForm) formResponse {
	resp := formResponse{
		ID:              f.ID.String(),
		FestivalID:      f.FestivalID.String(),
		Fields:          f.Fields,
		MaxApplications: f.MaxApplications,
		AnonymousReview: f.AnonymousReview,
		CreatedAt:       f.CreatedAt.Time.Format(time.RFC3339),
		UpdatedAt:       f.UpdatedAt.Time.Format(time.RFC3339),
	}
	if f.OpenAt.Valid {
		s := f.OpenAt.Time.Format(time.RFC3339)
		resp.OpenAt = &s
	}
	if f.CloseAt.Valid {
		s := f.CloseAt.Time.Format(time.RFC3339)
		resp.CloseAt = &s
	}
	return resp
}

type publicFormResponse struct {
	ID              string          `json:"id"`
	FestivalID      string          `json:"festival_id"`
	Fields          json.RawMessage `json:"fields"`
	OpenAt          *string         `json:"open_at,omitempty"`
	CloseAt         *string         `json:"close_at,omitempty"`
	MaxApplications *int32          `json:"max_applications,omitempty"`
	CreatedAt       string          `json:"created_at"`
	UpdatedAt       string          `json:"updated_at"`
}

func toPublicFormResponse(f sqlcdb.ApplicationForm) publicFormResponse {
	resp := publicFormResponse{
		ID:              f.ID.String(),
		FestivalID:      f.FestivalID.String(),
		Fields:          f.Fields,
		MaxApplications: f.MaxApplications,
		CreatedAt:       f.CreatedAt.Time.Format(time.RFC3339),
		UpdatedAt:       f.UpdatedAt.Time.Format(time.RFC3339),
	}
	if f.OpenAt.Valid {
		s := f.OpenAt.Time.Format(time.RFC3339)
		resp.OpenAt = &s
	}
	if f.CloseAt.Valid {
		s := f.CloseAt.Time.Format(time.RFC3339)
		resp.CloseAt = &s
	}
	return resp
}

// UpsertFormHandler handles PUT /festivals/{festivalID}/form. Requires auth + festival ownership.
func UpsertFormHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, err := auth.User(r.Context())
		if err != nil {
			httperr.Unauthorized(w)
			return
		}

		festUUID, err := pgUUIDFromString(chi.URLParam(r, "festivalID"))
		if err != nil {
			httperr.BadRequest(w, "invalid festivalID")
			return
		}

		q := sqlcdb.New(pool)
		fest, err := q.GetFestivalByID(r.Context(), festUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}
		if fest.OrganiserID.String() != principal.UserID {
			httperr.Forbidden(w)
			return
		}

		var req struct {
			Fields json.RawMessage `json:"fields"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.BadRequest(w, "invalid request body")
			return
		}
		if req.Fields == nil {
			req.Fields = json.RawMessage(`[]`)
		}

		form, err := q.UpsertApplicationForm(r.Context(), sqlcdb.UpsertApplicationFormParams{
			FestivalID: festUUID,
			Fields:     req.Fields,
		})
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(toFormResponse(form))
	}
}

// GetFormHandler handles GET /festivals/{festivalID}/form. Public.
// Authenticated festival owners receive the full response including anonymous_review;
// all other callers receive the public response which omits that field.
func GetFormHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		festUUID, err := pgUUIDFromString(chi.URLParam(r, "festivalID"))
		if err != nil {
			httperr.BadRequest(w, "invalid festivalID")
			return
		}

		q := sqlcdb.New(pool)
		form, err := q.GetApplicationFormByFestivalID(r.Context(), festUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}

		w.Header().Set("Content-Type", "application/json")

		// If the caller is the festival organiser, include owner-only fields.
		if principal, authErr := auth.User(r.Context()); authErr == nil {
			fest, festErr := q.GetFestivalByID(r.Context(), festUUID)
			if festErr == nil && fest.OrganiserID.String() == principal.UserID {
				_ = json.NewEncoder(w).Encode(toFormResponse(form))
				return
			}
		}

		_ = json.NewEncoder(w).Encode(toPublicFormResponse(form))
	}
}

// PatchFormHandler handles PATCH /festivals/{festivalID}/form. Owner only.
// Currently accepts only anonymous_review; extend the request struct for future toggles.
func PatchFormHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, err := auth.User(r.Context())
		if err != nil {
			httperr.Unauthorized(w)
			return
		}

		festUUID, err := pgUUIDFromString(chi.URLParam(r, "festivalID"))
		if err != nil {
			httperr.BadRequest(w, "invalid festivalID")
			return
		}

		q := sqlcdb.New(pool)
		fest, err := q.GetFestivalByID(r.Context(), festUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}
		if fest.OrganiserID.String() != principal.UserID {
			httperr.Forbidden(w)
			return
		}

		var req struct {
			AnonymousReview *bool `json:"anonymous_review"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.BadRequest(w, "invalid request body")
			return
		}

		if req.AnonymousReview == nil {
			// Nothing to update — return current state.
			form, err := q.GetApplicationFormByFestivalID(r.Context(), festUUID)
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					httperr.NotFound(w)
					return
				}
				httperr.InternalServerError(w)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(toFormResponse(form))
			return
		}

		form, err := q.PatchFormAnonymousReview(r.Context(), sqlcdb.PatchFormAnonymousReviewParams{
			FestivalID:      festUUID,
			AnonymousReview: *req.AnonymousReview,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(toFormResponse(form))
	}
}
