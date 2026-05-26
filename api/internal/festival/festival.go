package festival

import (
	"encoding/json"
	"errors"
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

type festivalResponse struct {
	ID            string  `json:"id"`
	OrganiserID   string  `json:"organiser_id"`
	Name          string  `json:"name"`
	Slug          string  `json:"slug"`
	Description   string  `json:"description"`
	LocationLabel string  `json:"location_label"`
	StartDate     *string `json:"start_date,omitempty"`
	EndDate       *string `json:"end_date,omitempty"`
	Status        string  `json:"status"`
	CreatedAt     string  `json:"created_at"`
	UpdatedAt     string  `json:"updated_at"`
}

func toFestivalResponse(f sqlcdb.Festival) festivalResponse {
	resp := festivalResponse{
		ID:            f.ID.String(),
		OrganiserID:   f.OrganiserID.String(),
		Name:          f.Name,
		Slug:          f.Slug,
		Description:   f.Description,
		LocationLabel: f.LocationLabel,
		Status:        string(f.Status),
		CreatedAt:     f.CreatedAt.Time.Format(time.RFC3339),
		UpdatedAt:     f.UpdatedAt.Time.Format(time.RFC3339),
	}
	if f.StartDate.Valid {
		s := f.StartDate.Time.Format("2006-01-02")
		resp.StartDate = &s
	}
	if f.EndDate.Valid {
		s := f.EndDate.Time.Format("2006-01-02")
		resp.EndDate = &s
	}
	return resp
}

// parseDateParam parses an optional ISO-8601 date string into a pgtype.Date.
// Returns a zero pgtype.Date (Valid=false) if the string is empty.
func parseDateParam(s string) (pgtype.Date, error) {
	if s == "" {
		return pgtype.Date{}, nil
	}
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		return pgtype.Date{}, err
	}
	return pgtype.Date{Time: t, Valid: true}, nil
}

// CreateHandler handles POST /festivals. Requires organiser role.
func CreateHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, err := auth.User(r.Context())
		if err != nil {
			httperr.Unauthorized(w)
			return
		}
		if principal.Role != "organiser" {
			httperr.Forbidden(w)
			return
		}

		var req struct {
			Name          string `json:"name"`
			Slug          string `json:"slug"`
			Description   string `json:"description"`
			LocationLabel string `json:"locationLabel"`
			StartDate     string `json:"startDate"`
			EndDate       string `json:"endDate"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.BadRequest(w, "invalid request body")
			return
		}
		if req.Name == "" || req.Slug == "" {
			httperr.UnprocessableEntity(w, "name and slug are required")
			return
		}

		organiserUUID, err := pgUUIDFromString(principal.UserID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		startDate, err := parseDateParam(req.StartDate)
		if err != nil {
			httperr.BadRequest(w, "invalid startDate: use YYYY-MM-DD format")
			return
		}
		endDate, err := parseDateParam(req.EndDate)
		if err != nil {
			httperr.BadRequest(w, "invalid endDate: use YYYY-MM-DD format")
			return
		}

		q := sqlcdb.New(pool)
		params := sqlcdb.CreateFestivalParams{
			OrganiserID:   organiserUUID,
			Name:          req.Name,
			Slug:          req.Slug,
			Description:   req.Description,
			LocationLabel: req.LocationLabel,
			StartDate:     startDate,
			EndDate:       endDate,
			Status:        sqlcdb.FestivalStatusDraft,
		}
		fest, err := q.CreateFestival(r.Context(), params)
		if err != nil {
			if isUniqueViolation(err) {
				httperr.Write(w, http.StatusConflict, "Conflict", "slug already in use")
				return
			}
			httperr.InternalServerError(w)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(toFestivalResponse(fest))
	}
}

// GetHandler handles GET /festivals/{festivalID}. Public for live festivals; organiser can see own draft.
func GetHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
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

		if fest.Status != sqlcdb.FestivalStatusLive {
			principal, authErr := auth.User(r.Context())
			if authErr != nil || fest.OrganiserID.String() != principal.UserID {
				httperr.NotFound(w)
				return
			}
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(toFestivalResponse(fest))
	}
}

// ListHandler handles GET /festivals. Requires auth; returns festivals owned by the caller.
func ListHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, err := auth.User(r.Context())
		if err != nil {
			httperr.Unauthorized(w)
			return
		}

		organiserUUID, err := pgUUIDFromString(principal.UserID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		q := sqlcdb.New(pool)
		festivals, err := q.ListFestivalsByOrganiser(r.Context(), organiserUUID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		resp := make([]festivalResponse, len(festivals))
		for i, f := range festivals {
			resp[i] = toFestivalResponse(f)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}
}

// UpdateHandler handles PATCH /festivals/{festivalID}. Requires auth + ownership.
func UpdateHandler(pool *pgxpool.Pool) http.HandlerFunc {
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
		existing, err := q.GetFestivalByID(r.Context(), festUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}
		if existing.OrganiserID.String() != principal.UserID {
			httperr.Forbidden(w)
			return
		}

		var req struct {
			Name          string `json:"name"`
			Slug          string `json:"slug"`
			Description   string `json:"description"`
			LocationLabel string `json:"locationLabel"`
			Status        string `json:"status"`
			StartDate     string `json:"startDate"`
			EndDate       string `json:"endDate"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.BadRequest(w, "invalid request body")
			return
		}

		name := existing.Name
		if req.Name != "" {
			name = req.Name
		}
		slug := existing.Slug
		if req.Slug != "" {
			slug = req.Slug
		}
		description := existing.Description
		if req.Description != "" {
			description = req.Description
		}
		locationLabel := existing.LocationLabel
		if req.LocationLabel != "" {
			locationLabel = req.LocationLabel
		}
		startDate := existing.StartDate
		if req.StartDate != "" {
			parsed, err := parseDateParam(req.StartDate)
			if err != nil {
				httperr.UnprocessableEntity(w, "invalid startDate: use YYYY-MM-DD")
				return
			}
			startDate = parsed
		}
		endDate := existing.EndDate
		if req.EndDate != "" {
			parsed, err := parseDateParam(req.EndDate)
			if err != nil {
				httperr.UnprocessableEntity(w, "invalid endDate: use YYYY-MM-DD")
				return
			}
			endDate = parsed
		}
		status := existing.Status
		if req.Status != "" {
			switch req.Status {
			case "draft", "open", "live", "archived":
				status = sqlcdb.FestivalStatus(req.Status)
			default:
				httperr.UnprocessableEntity(w, "invalid status: must be draft, open, live, or archived")
				return
			}
		}

		updated, err := q.UpdateFestival(r.Context(), sqlcdb.UpdateFestivalParams{
			ID:            festUUID,
			Name:          name,
			Slug:          slug,
			Description:   description,
			LocationLabel: locationLabel,
			StartDate:     startDate,
			EndDate:       endDate,
			Status:        status,
		})
		if err != nil {
			if isUniqueViolation(err) {
				httperr.Write(w, http.StatusConflict, "Conflict", "slug already in use")
				return
			}
			httperr.InternalServerError(w)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(toFestivalResponse(updated))
	}
}

// ListPublicHandler handles GET /public/festivals. No auth required.
// Returns festivals filtered by status (default: live).
func ListPublicHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		statusParam := r.URL.Query().Get("status")
		if statusParam == "" {
			statusParam = "live"
		}
		status := sqlcdb.FestivalStatus(statusParam)
		switch status {
		case sqlcdb.FestivalStatusLive, sqlcdb.FestivalStatusOpen, sqlcdb.FestivalStatusArchived:
		default:
			httperr.BadRequest(w, "status must be live, open, or archived")
			return
		}

		q := sqlcdb.New(pool)
		festivals, err := q.ListPublicFestivals(r.Context(), status)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		resp := make([]festivalResponse, len(festivals))
		for i, f := range festivals {
			resp[i] = toFestivalResponse(f)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}
}

// DeleteHandler handles DELETE /festivals/{festivalID}. Requires auth + ownership. Soft-deletes.
func DeleteHandler(pool *pgxpool.Pool) http.HandlerFunc {
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
		existing, err := q.GetFestivalByID(r.Context(), festUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}
		if existing.OrganiserID.String() != principal.UserID {
			httperr.Forbidden(w)
			return
		}

		if err := q.SoftDeleteFestival(r.Context(), festUUID); err != nil {
			httperr.InternalServerError(w)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
