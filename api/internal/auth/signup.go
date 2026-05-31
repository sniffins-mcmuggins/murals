package auth

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"

	"github.com/sniffins-mcmuggins/render/api/internal/config"
	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

type signupRequest struct {
	Email      string `json:"email"`
	Password   string `json:"password"`
	InviteCode string `json:"invite_code"`
}

// SignupHandler handles POST /auth/signup.
// Under BETA_MODE a valid invite_code is required; redemption and user
// creation happen in a single DB transaction.
func SignupHandler(pool *pgxpool.Pool, cfg config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req signupRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.BadRequest(w, "invalid request body")
			return
		}

		req.Email = strings.ToLower(strings.TrimSpace(req.Email))
		if !isValidEmail(req.Email) {
			httperr.UnprocessableEntity(w, "invalid email format")
			return
		}
		if len(req.Password) < 8 {
			httperr.UnprocessableEntity(w, "password must be at least 8 characters")
			return
		}

		if cfg.BetaMode {
			signupBeta(w, r, pool, req)
			return
		}

		hash, err := bcryptPassword(req.Password)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}
		q := sqlcdb.New(pool)
		user, err := q.CreateUser(r.Context(), sqlcdb.CreateUserParams{
			Email:        req.Email,
			PasswordHash: &hash,
		})
		if err != nil {
			if isUniqueViolation(err) {
				httperr.Write(w, http.StatusConflict, "Conflict", "email already registered")
				return
			}
			httperr.InternalServerError(w)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(toUserResponse(user))
	}
}

func signupBeta(w http.ResponseWriter, r *http.Request, pool *pgxpool.Pool, req signupRequest) {
	if req.InviteCode == "" {
		httperr.Write(w, http.StatusForbidden, "Forbidden", "invite code required during beta")
		return
	}

	hash, err := bcryptPassword(req.Password)
	if err != nil {
		httperr.InternalServerError(w)
		return
	}

	tx, err := pool.Begin(r.Context())
	if err != nil {
		httperr.InternalServerError(w)
		return
	}
	defer tx.Rollback(r.Context()) //nolint:errcheck

	q := sqlcdb.New(tx)

	invite, err := q.RedeemBetaInvite(r.Context(), req.InviteCode)
	if err != nil {
		if err == pgx.ErrNoRows {
			httperr.Write(w, http.StatusForbidden, "Forbidden", "invalid or exhausted invite code")
			return
		}
		httperr.InternalServerError(w)
		return
	}

	user, err := q.CreateBetaUser(r.Context(), sqlcdb.CreateBetaUserParams{
		Email:        req.Email,
		PasswordHash: &hash,
		BetaCohort:   &invite.Cohort,
		InvitedBy:    invite.CreatedBy,
		InvitedVia:   invite.ID,
	})
	if err != nil {
		if isUniqueViolation(err) {
			httperr.Write(w, http.StatusConflict, "Conflict", "email already registered")
			return
		}
		httperr.InternalServerError(w)
		return
	}

	if err := tx.Commit(r.Context()); err != nil {
		httperr.InternalServerError(w)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(toUserResponse(user))
}

func bcryptPassword(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	if err != nil {
		return "", err
	}
	return string(hash), nil
}

func isValidEmail(email string) bool {
	parts := strings.SplitN(email, "@", 2)
	return len(parts) == 2 && strings.Contains(parts[1], ".")
}
