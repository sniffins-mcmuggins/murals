package auth

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"

	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

type signupRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Role     string `json:"role"`
}

// SignupHandler handles POST /auth/signup.
func SignupHandler(pool *pgxpool.Pool) http.HandlerFunc {
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

		role := sqlcdb.UserRole(req.Role)
		if role != sqlcdb.UserRoleArtist && role != sqlcdb.UserRoleOrganiser {
			role = sqlcdb.UserRoleArtist
		}

		hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), 12)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		q := sqlcdb.New(pool)
		user, err := q.CreateUser(r.Context(), sqlcdb.CreateUserParams{
			Email:        req.Email,
			PasswordHash: string(hash),
			Role:         role,
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

func isValidEmail(email string) bool {
	parts := strings.SplitN(email, "@", 2)
	return len(parts) == 2 && strings.Contains(parts[1], ".")
}
