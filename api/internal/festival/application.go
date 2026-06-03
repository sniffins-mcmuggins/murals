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
	ID        string  `json:"id"`
	Content   string  `json:"content"`
	AuthorID  *string `json:"author_id"`
	CreatedAt string  `json:"created_at"`
}

type criterionScore struct {
	CriterionID string   `json:"criterion_id"`
	Label       string   `json:"label"`
	Min         int      `json:"min"`
	Max         int      `json:"max"`
	AvgScore    *float64 `json:"avg_score"`
	ScoreCount  int      `json:"score_count"`
	MyScore     *int32   `json:"my_score"`
}

type applicationResponse struct {
	ID              string           `json:"id"`
	FormID          string           `json:"form_id"`
	ArtistID        string           `json:"artist_id"`
	Status          string           `json:"status"`
	Rank            int32            `json:"rank"`
	Shortlisted     bool             `json:"shortlisted"`
	ReviewFlag      bool             `json:"review_flag"`
	StagedDecision  *string          `json:"staged_decision"`
	Answers         json.RawMessage  `json:"answers"`
	CreatedAt       string           `json:"created_at"`
	UpdatedAt       string           `json:"updated_at"`
	AvgScore        *float64         `json:"avg_score"`
	ScoreCount      int32            `json:"score_count"`
	MyScore         *int32           `json:"my_score"`
	Artist          *artistSummary   `json:"artist,omitempty"`
	Notes           []noteResponse   `json:"notes"`
	IdentityHidden  bool             `json:"identity_hidden"`
	CriterionScores []criterionScore `json:"criterion_scores"`
}

func toApplicationResponse(a sqlcdb.Application) applicationResponse {
	return applicationResponse{
		ID:              a.ID.String(),
		FormID:          a.FormID.String(),
		ArtistID:        a.ArtistID.String(),
		Status:          string(a.Status),
		Rank:            a.Rank,
		Shortlisted:     a.Shortlisted,
		ReviewFlag:      a.ReviewFlag,
		StagedDecision:  a.StagedDecision,
		Answers:         a.Answers,
		CreatedAt:       a.CreatedAt.Time.Format(time.RFC3339),
		UpdatedAt:       a.UpdatedAt.Time.Format(time.RFC3339),
		Notes:           []noteResponse{},
		CriterionScores: []criterionScore{},
	}
}

func toEnrichedResponse(
	row sqlcdb.ListApplicationsByFormWithArtistRow,
) applicationResponse {
	mediumTags := row.MediumTags
	if mediumTags == nil {
		mediumTags = []string{}
	}
	return applicationResponse{
		ID:             row.ID.String(),
		FormID:         row.FormID.String(),
		ArtistID:       row.ArtistID.String(),
		Status:         string(row.Status),
		Rank:           row.Rank,
		Shortlisted:    row.Shortlisted,
		ReviewFlag:     row.ReviewFlag,
		StagedDecision: row.StagedDecision,
		Answers:        row.Answers,
		CreatedAt:      row.CreatedAt.Time.Format(time.RFC3339),
		UpdatedAt:      row.UpdatedAt.Time.Format(time.RFC3339),
		Artist: &artistSummary{
			DisplayName:   row.DisplayName,
			AvatarS3Key:   row.AvatarS3Key,
			MediumTags:    mediumTags,
			LocationLabel: row.LocationLabel,
		},
		Notes:           []noteResponse{},
		CriterionScores: []criterionScore{},
	}
}

func toEnrichedReviewerRow(row sqlcdb.ListApplicationsByFormWithArtistExcludingReviewerRow) applicationResponse {
	mediumTags := row.MediumTags
	if mediumTags == nil {
		mediumTags = []string{}
	}
	return applicationResponse{
		ID:             row.ID.String(),
		FormID:         row.FormID.String(),
		ArtistID:       row.ArtistID.String(),
		Status:         string(row.Status),
		Rank:           row.Rank,
		Shortlisted:    row.Shortlisted,
		ReviewFlag:     row.ReviewFlag,
		StagedDecision: row.StagedDecision,
		Answers:        row.Answers,
		CreatedAt:      row.CreatedAt.Time.Format(time.RFC3339),
		UpdatedAt:      row.UpdatedAt.Time.Format(time.RFC3339),
		Artist: &artistSummary{
			DisplayName:   row.DisplayName,
			AvatarS3Key:   row.AvatarS3Key,
			MediumTags:    mediumTags,
			LocationLabel: row.LocationLabel,
		},
		Notes:           []noteResponse{},
		CriterionScores: []criterionScore{},
	}
}

// shouldAnonymise returns true when the caller is a reviewer,
// the form has anonymous_review enabled, and they haven't scored this application yet.
// Owner view is never anonymised; reveal happens automatically once my_score is set.
func shouldAnonymise(isReviewer, anonymousReview bool, myScore *int32) bool {
	return isReviewer && anonymousReview && myScore == nil
}

func toNoteResponse(n sqlcdb.ApplicationNote) noteResponse {
	var author *string
	if n.AuthorID.Valid {
		s := n.AuthorID.String()
		author = &s
	}
	return noteResponse{
		ID:        n.ID.String(),
		Content:   n.Content,
		AuthorID:  author,
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
