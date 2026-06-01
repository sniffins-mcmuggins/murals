package auth

import (
	"errors"
	"time"

	"github.com/jackc/pgerrcode"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

// userResponse is the JSON shape returned for a user in all auth endpoints.
type userResponse struct {
	ID        string `json:"id"`
	Email     string `json:"email"`
	IsAdmin   bool   `json:"is_admin"`
	IsBeta    bool   `json:"is_beta"`
	CreatedAt string `json:"created_at"`
}

func toUserResponse(u sqlcdb.User) userResponse {
	return userResponse{
		ID:        u.ID.String(),
		Email:     u.Email,
		IsAdmin:   u.IsAdmin,
		IsBeta:    u.IsBeta,
		CreatedAt: u.CreatedAt.Time.Format(time.RFC3339),
	}
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == pgerrcode.UniqueViolation
}
