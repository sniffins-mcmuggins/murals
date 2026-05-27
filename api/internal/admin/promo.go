package admin

import (
	"encoding/json"
	"errors"
	"log/slog"
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

// --- request / response types ------------------------------------------------

type createPromoCodeRequest struct {
	Code         string `json:"code"`
	Plan         string `json:"plan"`
	DurationDays int    `json:"duration_days"`
	MaxUses      *int   `json:"max_uses,omitempty"`
	ExpiresAt    string `json:"expires_at,omitempty"` // RFC3339, optional
}

type promoCodeResponse struct {
	ID           string  `json:"id"`
	Code         string  `json:"code"`
	Plan         string  `json:"plan"`
	DurationDays int32   `json:"duration_days"`
	MaxUses      *int32  `json:"max_uses,omitempty"`
	UseCount     int32   `json:"use_count"`
	ExpiresAt    *string `json:"expires_at,omitempty"`
	RevokedAt    *string `json:"revoked_at,omitempty"`
	CreatedAt    string  `json:"created_at"`
}

func toPromoResponse(pc sqlcdb.PromoCode) promoCodeResponse {
	r := promoCodeResponse{
		ID:           pc.ID.String(),
		Code:         pc.Code,
		Plan:         pc.Plan,
		DurationDays: pc.DurationDays,
		MaxUses:      pc.MaxUses,
		UseCount:     pc.UseCount,
		CreatedAt:    pc.CreatedAt.Time.Format(time.RFC3339),
	}
	if pc.ExpiresAt.Valid {
		s := pc.ExpiresAt.Time.Format(time.RFC3339)
		r.ExpiresAt = &s
	}
	if pc.RevokedAt.Valid {
		s := pc.RevokedAt.Time.Format(time.RFC3339)
		r.RevokedAt = &s
	}
	return r
}

// --- admin handlers ----------------------------------------------------------

// CreatePromoCodeHandler handles POST /admin/promo-codes.
func CreatePromoCodeHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, err := auth.User(r.Context())
		if err != nil {
			httperr.Unauthorized(w)
			return
		}

		var req createPromoCodeRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.BadRequest(w, "invalid request body")
			return
		}
		if req.Code == "" {
			httperr.BadRequest(w, "code is required")
			return
		}
		if !validPlans[req.Plan] {
			httperr.BadRequest(w, "invalid plan: must be artist_basic, artist_pro, organiser_setup, or festival_activation")
			return
		}
		if req.DurationDays <= 0 {
			httperr.BadRequest(w, "duration_days must be positive")
			return
		}

		createdByUUID, err := pgUUIDFromString(principal.UserID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		var maxUses *int32
		if req.MaxUses != nil {
			v := int32(*req.MaxUses)
			maxUses = &v
		}

		params := sqlcdb.CreatePromoCodeParams{
			Code:         req.Code,
			Plan:         req.Plan,
			DurationDays: int32(req.DurationDays),
			MaxUses:      maxUses,
			CreatedBy:    createdByUUID,
		}
		if req.ExpiresAt != "" {
			t, parseErr := time.Parse(time.RFC3339, req.ExpiresAt)
			if parseErr != nil {
				httperr.BadRequest(w, "expires_at must be RFC3339")
				return
			}
			params.ExpiresAt = pgTimestamptz(t)
		}

		q := sqlcdb.New(pool)
		pc, err := q.CreatePromoCode(r.Context(), params)
		if err != nil {
			if isUniqueViolation(err) {
				httperr.Write(w, http.StatusConflict, "Conflict", "promo code already exists")
				return
			}
			slog.Error("admin: create promo code", "err", err)
			httperr.InternalServerError(w)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(toPromoResponse(pc))
	}
}

// RevokePromoCodeHandler handles DELETE /admin/promo-codes/{codeID}.
// Idempotent: revoking an already-revoked code returns 204.
func RevokePromoCodeHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		codeIDStr := chi.URLParam(r, "codeID")
		codeUUID, err := pgUUIDFromString(codeIDStr)
		if err != nil {
			httperr.BadRequest(w, "invalid promo code id")
			return
		}

		q := sqlcdb.New(pool)
		if err := q.RevokePromoCode(r.Context(), codeUUID); err != nil {
			slog.Error("admin: revoke promo code", "err", err, "code_id", codeIDStr)
			httperr.InternalServerError(w)
			return
		}

		w.WriteHeader(http.StatusNoContent)
	}
}

// ListPromoCodesHandler handles GET /admin/promo-codes.
func ListPromoCodesHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := sqlcdb.New(pool)
		codes, err := q.ListPromoCodes(r.Context())
		if err != nil {
			slog.Error("admin: list promo codes", "err", err)
			httperr.InternalServerError(w)
			return
		}

		resp := make([]promoCodeResponse, 0, len(codes))
		for _, pc := range codes {
			resp = append(resp, toPromoResponse(pc))
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"promo_codes": resp})
	}
}

// --- user-facing handler -----------------------------------------------------

type redeemPromoRequest struct {
	Code string `json:"code"`
}

// RedeemPromoHandler handles POST /promo/redeem.
// Any authenticated user may redeem a valid promo code once.
func RedeemPromoHandler(pool *pgxpool.Pool) http.HandlerFunc {
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

		var req redeemPromoRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Code == "" {
			httperr.BadRequest(w, "code is required")
			return
		}

		q := sqlcdb.New(pool)

		// 1. Look up the code.
		pc, err := q.GetPromoCodeByCode(r.Context(), req.Code)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			slog.Error("redeem promo: lookup", "err", err, "code", req.Code)
			httperr.InternalServerError(w)
			return
		}

		// 2. Check if revoked.
		if pc.RevokedAt.Valid {
			httperr.Write(w, http.StatusGone, "Gone", "promo code has been revoked")
			return
		}

		// 3. Check if expired.
		if pc.ExpiresAt.Valid && pc.ExpiresAt.Time.Before(time.Now()) {
			httperr.Write(w, http.StatusGone, "Gone", "promo code has expired")
			return
		}

		// 4. Check max_uses (fast pre-check before the DB round-trip).
		if pc.MaxUses != nil && pc.UseCount >= *pc.MaxUses {
			httperr.Write(w, http.StatusConflict, "Conflict", "promo code has reached its usage limit")
			return
		}

		// 5. Check if this user already redeemed this code.
		alreadyRedeemed, err := q.HasRedeemedPromo(r.Context(), sqlcdb.HasRedeemedPromoParams{
			UserID:      userUUID,
			PromoCodeID: pc.ID,
		})
		if err != nil {
			slog.Error("redeem promo: check prior redemption", "err", err)
			httperr.InternalServerError(w)
			return
		}
		if alreadyRedeemed {
			httperr.Write(w, http.StatusConflict, "Conflict", "you have already redeemed this promo code")
			return
		}

		// 6. Atomically increment the use counter.
		//    IncrementPromoUseCount returns ErrNoRows when the guard condition
		//    (use_count < max_uses, not revoked, not expired) no longer holds —
		//    meaning another request won the race.
		if _, err := q.IncrementPromoUseCount(r.Context(), pc.ID); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.Write(w, http.StatusConflict, "Conflict", "promo code has reached its usage limit")
				return
			}
			slog.Error("redeem promo: increment use count", "err", err, "code_id", pc.ID.String())
			httperr.InternalServerError(w)
			return
		}

		// 7. Create the access grant.
		validUntil := time.Now().Add(time.Duration(pc.DurationDays) * 24 * time.Hour)
		grant, err := q.CreateAccessGrant(r.Context(), sqlcdb.CreateAccessGrantParams{
			UserID:      userUUID,
			Plan:        pc.Plan,
			ValidUntil:  pgTimestamptz(validUntil),
			GrantedBy:   pgtype.UUID{},
			PromoCodeID: pc.ID,
		})
		if err != nil {
			slog.Error("redeem promo: create access grant", "err", err, "code_id", pc.ID.String())
			httperr.InternalServerError(w)
			return
		}

		resp := grantResponse{
			ID:         grant.ID.String(),
			UserID:     grant.UserID.String(),
			Plan:       grant.Plan,
			ValidUntil: grant.ValidUntil.Time.Format(time.RFC3339),
			CreatedAt:  grant.CreatedAt.Time.Format(time.RFC3339),
		}
		if grant.Note != nil {
			resp.Note = *grant.Note
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}
}
