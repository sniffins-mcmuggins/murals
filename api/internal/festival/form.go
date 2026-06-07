package festival

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

// reviewCriterion is a single scoring dimension stored in application_forms.review_criteria.
type reviewCriterion struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Min   int    `json:"min"`
	Max   int    `json:"max"`
}

// criterionInput is what the organiser sends when creating/updating criteria.
// ID is optional: if non-empty the caller is preserving a known ID; if empty
// the API generates one from the label.
type criterionInput struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Min   int    `json:"min"`
	Max   int    `json:"max"`
}

var nonAlphanumRe = regexp.MustCompile(`[^a-z0-9]+`)

// allowedPrefillKeys mirrors the PrefillKey allowlist in web/src/lib/prefill.ts.
// A form field may optionally bind to one of these profile attributes so the
// apply form pre-fills it from the artist's profile (E28 M2). Keep in sync.
var allowedPrefillKeys = map[string]bool{
	"display_name": true, "bio": true, "location": true, "website": true,
	"social.instagram": true, "social.twitter": true, "social.facebook": true,
	"social.youtube": true, "social.tiktok": true, "social.linkedin": true,
	"social.pinterest": true, "support_url": true,
	"portfolio_url": true, "portfolio_collection": true,
}

func slugifyCriterion(label string) string {
	s := strings.ToLower(strings.TrimSpace(label))
	s = nonAlphanumRe.ReplaceAllString(s, "-")
	return strings.Trim(s, "-")
}

// parseCriteria unmarshals review_criteria JSON from the DB model.
// Returns nil slice (not error) when the column is the empty-array default.
func parseCriteria(raw json.RawMessage) ([]reviewCriterion, error) {
	if len(raw) == 0 || string(raw) == "[]" || string(raw) == "null" {
		return nil, nil
	}
	var out []reviewCriterion
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// buildCriteria validates and assigns stable IDs to a submitted criteria list.
func buildCriteria(inputs []criterionInput) ([]reviewCriterion, error) {
	if len(inputs) > 10 {
		return nil, fmt.Errorf("max 10 criteria allowed")
	}
	result := make([]reviewCriterion, len(inputs))
	slugCount := map[string]int{} // how many times each base slug has been generated
	seen := map[string]struct{}{} // every ID assigned so far (generated + caller-supplied)
	for i, inp := range inputs {
		label := strings.TrimSpace(inp.Label)
		if label == "" {
			return nil, fmt.Errorf("criterion label must not be empty")
		}
		if len(label) > 80 {
			return nil, fmt.Errorf("criterion label too long (max 80 chars)")
		}
		minV, maxV := inp.Min, inp.Max
		if minV < 1 {
			minV = 1
		}
		if maxV < minV || maxV > 10 {
			return nil, fmt.Errorf("criterion max must be between min and 10")
		}

		var id string
		if inp.ID != "" {
			// Preserve a caller-supplied ID (keeps existing scores valid).
			id = inp.ID
		} else {
			base := slugifyCriterion(label)
			if base == "" {
				base = fmt.Sprintf("criterion-%d", i+1)
			}
			slugCount[base]++
			if slugCount[base] == 1 {
				id = base
			} else {
				id = fmt.Sprintf("%s-%d", base, slugCount[base])
			}
		}

		if _, dup := seen[id]; dup {
			return nil, fmt.Errorf("duplicate criterion id %q", id)
		}
		seen[id] = struct{}{}
		result[i] = reviewCriterion{ID: id, Label: label, Min: minV, Max: maxV}
	}
	return result, nil
}

type formResponse struct {
	ID              string          `json:"id"`
	FestivalID      string          `json:"festival_id"`
	Fields          json.RawMessage `json:"fields"`
	OpenAt          *string         `json:"open_at,omitempty"`
	CloseAt         *string         `json:"close_at,omitempty"`
	MaxApplications *int32          `json:"max_applications,omitempty"`
	ReviewCriteria  json.RawMessage `json:"review_criteria"`
	CreatedAt       string          `json:"created_at"`
	UpdatedAt       string          `json:"updated_at"`
}

func toFormResponse(f sqlcdb.ApplicationForm) formResponse {
	criteria := f.ReviewCriteria
	if len(criteria) == 0 {
		criteria = json.RawMessage(`[]`)
	}
	resp := formResponse{
		ID:              f.ID.String(),
		FestivalID:      f.FestivalID.String(),
		Fields:          f.Fields,
		MaxApplications: f.MaxApplications,
		ReviewCriteria:  criteria,
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

		// Validate field definitions before persisting. Unmarshal into generic maps
		// so every caller-supplied key (e.g. options, required) is preserved, and a
		// missing id can be backfilled rather than rejected (keeps older callers and
		// seed data working while guaranteeing every persisted field has an id).
		var defs []map[string]any
		if err := json.Unmarshal(req.Fields, &defs); err != nil {
			httperr.BadRequest(w, "invalid fields")
			return
		}
		validType := map[string]bool{
			"text": true, "textarea": true, "long_text": true,
			"select": true, "url": true, "embed": true,
		}
		for _, d := range defs {
			label, _ := d["label"].(string)
			typ, _ := d["type"].(string)
			if strings.TrimSpace(label) == "" || !validType[typ] {
				httperr.UnprocessableEntity(w, "invalid field definition")
				return
			}
			if typ == "select" {
				opts, _ := d["options"].([]any)
				if len(opts) == 0 {
					httperr.UnprocessableEntity(w, "select field needs at least one option")
					return
				}
			}
			if pf, ok := d["prefill"].(string); ok && strings.TrimSpace(pf) != "" {
				if !allowedPrefillKeys[pf] {
					httperr.UnprocessableEntity(w, "invalid prefill key: "+pf)
					return
				}
			}
			if id, _ := d["id"].(string); strings.TrimSpace(id) == "" {
				d["id"] = uuid.New().String()
			}
		}
		normalised, err := json.Marshal(defs)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		form, err := q.UpsertApplicationForm(r.Context(), sqlcdb.UpsertApplicationFormParams{
			FestivalID: festUUID,
			Fields:     normalised,
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
// Authenticated festival owners and reviewers receive the full response including review_criteria;
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

		// Owners and invited reviewers see panel-internal fields (review_criteria).
		// The public/artists get the stripped response.
		if principal, authErr := auth.User(r.Context()); authErr == nil {
			role, roleErr := resolveFestivalAccess(r.Context(), q, festUUID, principal.UserID)
			if roleErr == nil && role != roleNone {
				_ = json.NewEncoder(w).Encode(toFormResponse(form))
				return
			}
		}

		_ = json.NewEncoder(w).Encode(toPublicFormResponse(form))
	}
}

// PatchFormHandler handles PATCH /festivals/{festivalID}/form. Owner only.
// Accepts { review_criteria }; unspecified fields are left unchanged.
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
			ReviewCriteria *[]criterionInput `json:"review_criteria"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.BadRequest(w, "invalid request body")
			return
		}

		// Start from current state so unspecified fields are preserved.
		form, err := q.GetApplicationFormByFestivalID(r.Context(), festUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}

		if req.ReviewCriteria != nil {
			criteria, buildErr := buildCriteria(*req.ReviewCriteria)
			if buildErr != nil {
				httperr.UnprocessableEntity(w, buildErr.Error())
				return
			}
			criteriaJSON, marshalErr := json.Marshal(criteria)
			if marshalErr != nil {
				httperr.InternalServerError(w)
				return
			}
			form, err = q.PatchFormCriteria(r.Context(), sqlcdb.PatchFormCriteriaParams{
				FestivalID:     festUUID,
				ReviewCriteria: criteriaJSON,
			})
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					httperr.NotFound(w)
					return
				}
				httperr.InternalServerError(w)
				return
			}
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(toFormResponse(form))
	}
}
