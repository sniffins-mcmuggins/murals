package auth

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"

	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type loginResponse struct {
	Token string       `json:"token"`
	User  userResponse `json:"user"`
}

// LoginHandler handles POST /auth/login.
func LoginHandler(pool *pgxpool.Pool, jwtSecret string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req loginRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.BadRequest(w, "invalid request body")
			return
		}

		q := sqlcdb.New(pool)
		// Normalize email to match signup-time storage (lowercased + trimmed).
		email := strings.ToLower(strings.TrimSpace(req.Email))
		user, err := q.GetUserByEmail(r.Context(), email)
		if err != nil {
			if err == pgx.ErrNoRows {
				httperr.Write(w, http.StatusUnauthorized, "Unauthorized", "invalid credentials")
				return
			}
			httperr.InternalServerError(w)
			return
		}

		if user.PasswordHash == nil {
			httperr.Write(w, http.StatusUnauthorized, "Unauthorized", "invalid credentials")
			return
		}
		if err := bcrypt.CompareHashAndPassword([]byte(*user.PasswordHash), []byte(req.Password)); err != nil {
			httperr.Write(w, http.StatusUnauthorized, "Unauthorized", "invalid credentials")
			return
		}

		if !user.EmailVerified {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			_ = json.NewEncoder(w).Encode(map[string]string{
				"code":    "email_not_verified",
				"message": "Check your inbox to verify your email.",
			})
			return
		}

		// MFA-gated branch: don't issue a session token yet. Return a short-lived
		// mfa_pending token the client must exchange via POST /auth/mfa/verify.
		if user.MfaEnabled {
			mfaToken, err := IssueMFAPendingToken(user.ID.String(), jwtSecret)
			if err != nil {
				httperr.InternalServerError(w)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"mfa_required": true,
				"mfa_token":    mfaToken,
			})
			return
		}

		token, err := IssueToken(user.ID.String(), user.IsAdmin, user.SessionVersion, jwtSecret)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		http.SetCookie(w, &http.Cookie{
			Name:     "session",
			Value:    token,
			HttpOnly: true,
			SameSite: http.SameSiteLaxMode,
			Path:     "/",
			MaxAge:   int(tokenTTL.Seconds()),
		})

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(loginResponse{
			Token: token,
			User:  toUserResponse(user),
		})
	}
}
