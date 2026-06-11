package beta

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

const memberInviteQuota = 3

var base62Chars = []byte("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz")

func randomBase62(n int) (string, error) {
	b := make([]byte, n)
	for i := range b {
		idx, err := rand.Int(rand.Reader, big.NewInt(int64(len(base62Chars))))
		if err != nil {
			return "", err
		}
		b[i] = base62Chars[idx.Int64()]
	}
	return string(b), nil
}

type adminCreateInviteRequest struct {
	Cohort    string `json:"cohort"`
	MaxUses   int32  `json:"max_uses"`
	ExpiresAt string `json:"expires_at,omitempty"`
}

type inviteResponse struct {
	ID        string `json:"id"`
	Code      string `json:"code"`
	Link      string `json:"link"`
	MaxUses   int32  `json:"max_uses"`
	UsedCount int32  `json:"used_count"`
	Cohort    string `json:"cohort"`
	CreatedAt string `json:"created_at"`
}

func inviteToResponse(inv sqlcdb.BetaInvite, webBase string) inviteResponse {
	return inviteResponse{
		ID:        inv.ID.String(),
		Code:      inv.Code,
		Link:      fmt.Sprintf("%s/signup?invite=%s", webBase, inv.Code),
		MaxUses:   inv.MaxUses,
		UsedCount: inv.UsedCount,
		Cohort:    inv.Cohort,
		CreatedAt: inv.CreatedAt.Time.UTC().Format("2006-01-02T15:04:05Z"),
	}
}

// AdminCreateInviteHandler handles POST /admin/beta/invites.
// Creates an invite code with the given cohort, max_uses (default 3), and optional expiry.
func AdminCreateInviteHandler(pool *pgxpool.Pool, webBase string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, err := auth.User(r.Context())
		if err != nil {
			httperr.Unauthorized(w)
			return
		}

		creatorUUID, err := pgUUIDFromString(principal.UserID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		var req adminCreateInviteRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.BadRequest(w, "invalid request body")
			return
		}

		cohort := req.Cohort
		if cohort == "" {
			cohort = "founding"
		}
		maxUses := req.MaxUses
		if maxUses <= 0 {
			maxUses = 3
		}

		code, err := randomBase62(16)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		q := sqlcdb.New(pool)
		inv, err := q.CreateBetaInvite(r.Context(), sqlcdb.CreateBetaInviteParams{
			Code:      code,
			CreatedBy: creatorUUID,
			MaxUses:   maxUses,
			Cohort:    cohort,
		})
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(inviteToResponse(inv, webBase))
	}
}

// AdminListInvitesHandler handles GET /admin/beta/invites.
func AdminListInvitesHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, err := auth.User(r.Context()); err != nil {
			httperr.Unauthorized(w)
			return
		}

		q := sqlcdb.New(pool)
		invites, err := q.ListBetaInvites(r.Context())
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		type listItem struct {
			ID        string `json:"id"`
			Code      string `json:"code"`
			MaxUses   int32  `json:"max_uses"`
			UsedCount int32  `json:"used_count"`
			Cohort    string `json:"cohort"`
			CreatedAt string `json:"created_at"`
		}
		resp := make([]listItem, 0, len(invites))
		for _, inv := range invites {
			resp = append(resp, listItem{
				ID:        inv.ID.String(),
				Code:      inv.Code,
				MaxUses:   inv.MaxUses,
				UsedCount: inv.UsedCount,
				Cohort:    inv.Cohort,
				CreatedAt: inv.CreatedAt.Time.UTC().Format("2006-01-02T15:04:05Z"),
			})
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}
}

// MintInviteHandler handles POST /beta/invites.
// Beta members can mint single-use personal invites up to memberInviteQuota per member.
func MintInviteHandler(pool *pgxpool.Pool, webBase string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, err := auth.User(r.Context())
		if err != nil {
			httperr.Unauthorized(w)
			return
		}

		creatorUUID, err := pgUUIDFromString(principal.UserID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		q := sqlcdb.New(pool)
		count, err := q.CountBetaInvitesByCreator(r.Context(), creatorUUID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}
		if count >= memberInviteQuota {
			httperr.Write(w, http.StatusForbidden, "Forbidden", "invite quota exhausted")
			return
		}

		code, err := randomBase62(16)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		inv, err := q.CreateBetaInvite(r.Context(), sqlcdb.CreateBetaInviteParams{
			Code:      code,
			CreatedBy: creatorUUID,
			MaxUses:   1,
			Cohort:    "founding",
		})
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(inviteToResponse(inv, webBase))
	}
}

type myInvitesResponse struct {
	Invites        []inviteResponse `json:"invites"`
	RemainingQuota int              `json:"remaining_quota"`
}

// GetMyInvitesHandler handles GET /beta/me/invites.
//
// Returns the member's own invite codes + remaining quota only. It deliberately
// does NOT return the list of people who joined via those codes: that would be
// other users' email addresses (PII) the inviter has no need to hold, and
// `used_count` per invite already conveys how many joined. Keeping this response
// PII-free aligns with the platform's aggregated-only / GDPR-clean stance.
func GetMyInvitesHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, err := auth.User(r.Context())
		if err != nil {
			httperr.Unauthorized(w)
			return
		}

		creatorUUID, err := pgUUIDFromString(principal.UserID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		q := sqlcdb.New(pool)

		invites, err := q.ListBetaInvitesByCreator(r.Context(), creatorUUID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		inviteItems := make([]inviteResponse, 0, len(invites))
		for _, inv := range invites {
			inviteItems = append(inviteItems, inviteResponse{
				ID:        inv.ID.String(),
				Code:      inv.Code,
				MaxUses:   inv.MaxUses,
				UsedCount: inv.UsedCount,
				Cohort:    inv.Cohort,
				CreatedAt: inv.CreatedAt.Time.UTC().Format("2006-01-02T15:04:05Z"),
			})
		}

		remaining := memberInviteQuota - len(inviteItems)
		if remaining < 0 {
			remaining = 0
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(myInvitesResponse{
			Invites:        inviteItems,
			RemainingQuota: remaining,
		})
	}
}
