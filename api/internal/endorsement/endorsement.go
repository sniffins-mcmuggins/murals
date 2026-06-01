package endorsement

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

func pgUUIDFromString(s string) (pgtype.UUID, error) {
	parsed, err := uuid.Parse(s)
	if err != nil {
		return pgtype.UUID{}, err
	}
	return pgtype.UUID{Bytes: [16]byte(parsed), Valid: true}, nil
}

type endorsementResponse struct {
	ID                  string   `json:"id"`
	Kind                string   `json:"kind"`
	EndorserID          string   `json:"endorser_id"`
	EndorserDisplayName *string  `json:"endorser_display_name,omitempty"`
	EndorserAvatarS3Key *string  `json:"endorser_avatar_s3_key,omitempty"`
	FestivalID          *string  `json:"festival_id,omitempty"`
	FestivalName        *string  `json:"festival_name,omitempty"`
	Body                *string  `json:"body,omitempty"`
	Skills              []string `json:"skills"`
	HiddenByEndorsee    bool     `json:"hidden_by_endorsee"`
	CreatedAt           string   `json:"created_at"`
}

func uuidPtrFromPgtype(u pgtype.UUID) *string {
	if !u.Valid {
		return nil
	}
	s := u.String()
	return &s
}

func toResponse(e sqlcdb.Endorsement) endorsementResponse {
	skills := e.Skills
	if skills == nil {
		skills = []string{}
	}
	return endorsementResponse{
		ID:               e.ID.String(),
		Kind:             e.Kind,
		EndorserID:       e.EndorserID.String(),
		Body:             e.Body,
		Skills:           skills,
		HiddenByEndorsee: e.HiddenByEndorsee,
		FestivalID:       uuidPtrFromPgtype(e.FestivalID),
		CreatedAt:        e.CreatedAt.Time.Format(time.RFC3339),
	}
}

func toRowResponse(e sqlcdb.ListPublicEndorsementsRow) endorsementResponse {
	skills := e.Skills
	if skills == nil {
		skills = []string{}
	}
	return endorsementResponse{
		ID:                  e.ID.String(),
		Kind:                e.Kind,
		EndorserID:          e.EndorserID.String(),
		EndorserDisplayName: e.EndorserDisplayName,
		EndorserAvatarS3Key: e.EndorserAvatarS3Key,
		FestivalID:          uuidPtrFromPgtype(e.FestivalID),
		FestivalName:        e.FestivalName,
		Body:                e.Body,
		Skills:              skills,
		HiddenByEndorsee:    e.HiddenByEndorsee,
		CreatedAt:           e.CreatedAt.Time.Format(time.RFC3339),
	}
}

func toReceivedRowResponse(e sqlcdb.ListReceivedEndorsementsRow) endorsementResponse {
	skills := e.Skills
	if skills == nil {
		skills = []string{}
	}
	return endorsementResponse{
		ID:                  e.ID.String(),
		Kind:                e.Kind,
		EndorserID:          e.EndorserID.String(),
		EndorserDisplayName: e.EndorserDisplayName,
		EndorserAvatarS3Key: e.EndorserAvatarS3Key,
		FestivalID:          uuidPtrFromPgtype(e.FestivalID),
		FestivalName:        e.FestivalName,
		Body:                e.Body,
		Skills:              skills,
		HiddenByEndorsee:    e.HiddenByEndorsee,
		CreatedAt:           e.CreatedAt.Time.Format(time.RFC3339),
	}
}

// CreateHandler handles POST /endorsements. No mailer — for tests.
func CreateHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return CreateHandlerWithMailer(pool, nil)
}

// CreateHandlerWithMailer is the production variant wired in main.go.
func CreateHandlerWithMailer(pool *pgxpool.Pool, mailer auth.EmailSender) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, err := auth.User(r.Context())
		if err != nil {
			httperr.Unauthorized(w)
			return
		}

		var req struct {
			EndorseeID string   `json:"endorsee_id"`
			Kind       string   `json:"kind"`
			FestivalID *string  `json:"festival_id"`
			Body       *string  `json:"body"`
			Skills     []string `json:"skills"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.BadRequest(w, "invalid request body")
			return
		}
		if req.Kind != "peer" && req.Kind != "organiser" {
			httperr.UnprocessableEntity(w, "kind must be peer or organiser")
			return
		}
		if req.Kind == "organiser" && req.FestivalID == nil {
			httperr.UnprocessableEntity(w, "festival_id is required for organiser endorsements")
			return
		}

		endorseeUUID, err := pgUUIDFromString(req.EndorseeID)
		if err != nil {
			httperr.BadRequest(w, "invalid endorsee_id")
			return
		}
		endorserUUID, err := pgUUIDFromString(principal.UserID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		q := sqlcdb.New(pool)

		// Endorsee must be a public artist profile.
		endorseeProfile, err := q.GetArtistProfileByID(r.Context(), endorseeUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}
		if endorseeProfile.Visibility != "public" {
			httperr.NotFound(w)
			return
		}

		// Self-endorse guard (DB CHECK is the backstop).
		if endorseeProfile.UserID.Valid && endorseeProfile.UserID.String() == principal.UserID {
			httperr.BadRequest(w, "cannot endorse yourself")
			return
		}

		// Kind-specific validation.
		var festivalUUID pgtype.UUID
		switch req.Kind {
		case "peer":
			if _, err := q.GetArtistProfileByUserID(r.Context(), endorserUUID); err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					httperr.Forbidden(w)
					return
				}
				httperr.InternalServerError(w)
				return
			}
		case "organiser":
			fUUID, err := pgUUIDFromString(*req.FestivalID)
			if err != nil {
				httperr.BadRequest(w, "invalid festival_id")
				return
			}
			fest, err := q.GetFestivalByID(r.Context(), fUUID)
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
			festivalUUID = fUUID
		}

		skills := req.Skills
		if skills == nil {
			skills = []string{}
		}

		e, err := q.CreateOrUpdateEndorsement(r.Context(), sqlcdb.CreateOrUpdateEndorsementParams{
			EndorserID: endorserUUID,
			EndorseeID: endorseeUUID,
			Kind:       req.Kind,
			FestivalID: festivalUUID,
			Body:       req.Body,
			Skills:     skills,
		})
		if err != nil {
			if isCheckViolation(err) {
				httperr.BadRequest(w, "cannot endorse yourself")
				return
			}
			httperr.InternalServerError(w)
			return
		}

		if mailer != nil {
			endorserName := principal.UserID
			if ap, err := q.GetArtistProfileByUserID(r.Context(), endorserUUID); err == nil {
				endorserName = ap.DisplayName
			}
			sendEndorseeNotification(pool, mailer, endorseeUUID, endorserName)
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(toResponse(e))
	}
}

// DeleteHandler handles DELETE /endorsements/{endorsementID}. Endorser only.
func DeleteHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, err := auth.User(r.Context())
		if err != nil {
			httperr.Unauthorized(w)
			return
		}

		idUUID, err := pgUUIDFromString(chi.URLParam(r, "endorsementID"))
		if err != nil {
			httperr.BadRequest(w, "invalid endorsementID")
			return
		}

		q := sqlcdb.New(pool)
		existing, err := q.GetEndorsementByID(r.Context(), idUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}
		if existing.EndorserID.String() != principal.UserID {
			httperr.Forbidden(w)
			return
		}

		if err := q.DeleteEndorsement(r.Context(), idUUID); err != nil {
			httperr.InternalServerError(w)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// ListPublicHandler handles GET /profiles/{profileID}/endorsements. Public.
func ListPublicHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		profileUUID, err := pgUUIDFromString(chi.URLParam(r, "profileID"))
		if err != nil {
			httperr.BadRequest(w, "invalid profileID")
			return
		}

		q := sqlcdb.New(pool)
		rows, err := q.ListPublicEndorsements(r.Context(), profileUUID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		out := make([]endorsementResponse, 0, len(rows))
		for _, row := range rows {
			out = append(out, toRowResponse(row))
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"endorsements": out})
	}
}

// SetVisibilityHandler handles PATCH /endorsements/{endorsementID}/visibility. Endorsee only.
func SetVisibilityHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, err := auth.User(r.Context())
		if err != nil {
			httperr.Unauthorized(w)
			return
		}

		idUUID, err := pgUUIDFromString(chi.URLParam(r, "endorsementID"))
		if err != nil {
			httperr.BadRequest(w, "invalid endorsementID")
			return
		}

		var req struct {
			Hidden bool `json:"hidden"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.BadRequest(w, "invalid request body")
			return
		}

		q := sqlcdb.New(pool)
		existing, err := q.GetEndorsementByID(r.Context(), idUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}

		// Verify caller is the endorsee by looking up the endorsee's profile.
		endorseeProfile, err := q.GetArtistProfileByID(r.Context(), existing.EndorseeID)
		if err != nil || !endorseeProfile.UserID.Valid || endorseeProfile.UserID.String() != principal.UserID {
			httperr.Forbidden(w)
			return
		}

		updated, err := q.SetEndorsementVisibility(r.Context(), sqlcdb.SetEndorsementVisibilityParams{
			ID:               idUUID,
			HiddenByEndorsee: req.Hidden,
		})
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(toResponse(updated))
	}
}

// ListReceivedHandler handles GET /endorsements/received. Endorsee only.
func ListReceivedHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, err := auth.User(r.Context())
		if err != nil {
			httperr.Unauthorized(w)
			return
		}

		callerUUID, err := pgUUIDFromString(principal.UserID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		q := sqlcdb.New(pool)
		profile, err := q.GetArtistProfileByUserID(r.Context(), callerUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}

		rows, err := q.ListReceivedEndorsements(r.Context(), profile.ID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		out := make([]endorsementResponse, 0, len(rows))
		for _, row := range rows {
			out = append(out, toReceivedRowResponse(row))
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"endorsements": out})
	}
}
