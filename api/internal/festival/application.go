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

type formField struct {
	ID       string `json:"id"`
	Label    string `json:"label"`
	Type     string `json:"type"`
	Required bool   `json:"required"`
}

type artistSummary struct {
	DisplayName   string   `json:"display_name"`
	AvatarS3Key   *string  `json:"avatar_s3_key"`
	MediumTags    []string `json:"medium_tags"`
	LocationLabel *string  `json:"location_label"`
}

type noteResponse struct {
	ID        string `json:"id"`
	Content   string `json:"content"`
	CreatedAt string `json:"created_at"`
}

type applicationResponse struct {
	ID          string          `json:"id"`
	FormID      string          `json:"form_id"`
	ArtistID    string          `json:"artist_id"`
	Status      string          `json:"status"`
	Rank        int32           `json:"rank"`
	Shortlisted bool            `json:"shortlisted"`
	ReviewFlag  bool            `json:"review_flag"`
	Answers     json.RawMessage `json:"answers"`
	CreatedAt   string          `json:"created_at"`
	UpdatedAt   string          `json:"updated_at"`
	Artist      *artistSummary  `json:"artist,omitempty"`
	Notes       []noteResponse  `json:"notes"`
}

func toApplicationResponse(a sqlcdb.Application) applicationResponse {
	return applicationResponse{
		ID:          a.ID.String(),
		FormID:      a.FormID.String(),
		ArtistID:    a.ArtistID.String(),
		Status:      string(a.Status),
		Rank:        a.Rank,
		Shortlisted: a.Shortlisted,
		ReviewFlag:  a.ReviewFlag,
		Answers:     a.Answers,
		CreatedAt:   a.CreatedAt.Time.Format(time.RFC3339),
		UpdatedAt:   a.UpdatedAt.Time.Format(time.RFC3339),
		Notes:       []noteResponse{},
	}
}

func toEnrichedResponse( //nolint:unused // used in upcoming list handler (Task 9)
	row sqlcdb.ListApplicationsByFormWithArtistRow,
	notes []noteResponse,
) applicationResponse {
	return applicationResponse{
		ID:          row.ID.String(),
		FormID:      row.FormID.String(),
		ArtistID:    row.ArtistID.String(),
		Status:      string(row.Status),
		Rank:        row.Rank,
		Shortlisted: row.Shortlisted,
		ReviewFlag:  row.ReviewFlag,
		Answers:     row.Answers,
		CreatedAt:   row.CreatedAt.Time.Format(time.RFC3339),
		UpdatedAt:   row.UpdatedAt.Time.Format(time.RFC3339),
		Artist: &artistSummary{
			DisplayName:   row.DisplayName,
			AvatarS3Key:   row.AvatarS3Key,
			MediumTags:    row.MediumTags,
			LocationLabel: row.LocationLabel,
		},
		Notes: notes,
	}
}

func toNoteResponse(n sqlcdb.ApplicationNote) noteResponse { //nolint:unused // used in upcoming notes handler (Task 8)
	return noteResponse{
		ID:        n.ID.String(),
		Content:   n.Content,
		CreatedAt: n.CreatedAt.Time.Format(time.RFC3339),
	}
}

// SubmitApplicationHandler handles POST /festivals/{festivalID}/apply. Requires the caller to have an artist profile; returns 409 profile_required if not.
func SubmitApplicationHandler(pool *pgxpool.Pool) http.HandlerFunc {
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
		form, err := q.GetApplicationFormByFestivalID(r.Context(), festUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}

		// Check open window
		now := time.Now().UTC()
		if form.OpenAt.Valid && now.Before(form.OpenAt.Time) {
			httperr.Write(w, http.StatusUnprocessableEntity, "Unprocessable Entity", "applications not yet open")
			return
		}
		if form.CloseAt.Valid && now.After(form.CloseAt.Time) {
			httperr.Write(w, http.StatusUnprocessableEntity, "Unprocessable Entity", "applications closed")
			return
		}

		var req struct {
			Answers map[string]string `json:"answers"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.BadRequest(w, "invalid request body")
			return
		}
		if req.Answers == nil {
			req.Answers = map[string]string{}
		}

		// Validate required fields
		var fields []formField
		if err := json.Unmarshal(form.Fields, &fields); err != nil {
			httperr.InternalServerError(w)
			return
		}
		for _, f := range fields {
			if f.Required {
				if v, ok := req.Answers[f.ID]; !ok || v == "" {
					httperr.UnprocessableEntity(w, "required field missing: "+f.ID)
					return
				}
			}
		}

		// Get artist profile
		userUUID, err := pgUUIDFromString(principal.UserID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}
		profile, err := q.GetArtistProfileByUserID(r.Context(), userUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusConflict)
				_ = json.NewEncoder(w).Encode(map[string]string{
					"error":   "profile_required",
					"message": "create an artist profile to apply",
				})
				return
			}
			httperr.InternalServerError(w)
			return
		}

		answersJSON, err := json.Marshal(req.Answers)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		app, err := q.CreateApplication(r.Context(), sqlcdb.CreateApplicationParams{
			FormID:   form.ID,
			ArtistID: profile.ID,
			Answers:  answersJSON,
		})
		if err != nil {
			if isUniqueViolation(err) {
				httperr.Write(w, http.StatusConflict, "Conflict", "already applied to this festival")
				return
			}
			httperr.InternalServerError(w)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(toApplicationResponse(app))
	}
}
