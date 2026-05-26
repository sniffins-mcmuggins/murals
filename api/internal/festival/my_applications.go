package festival

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

// GetMyApplicationsHandler handles GET /me/applications. Returns all applications
// submitted by the authenticated artist, ordered newest first.
func GetMyApplicationsHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, err := auth.User(r.Context())
		if err != nil {
			httperr.Unauthorized(w)
			return
		}

		if principal.Role != "artist" {
			httperr.Forbidden(w)
			return
		}

		userUUID, err := pgUUIDFromString(principal.UserID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		q := sqlcdb.New(pool)
		profile, err := q.GetArtistProfileByUserID(r.Context(), userUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				// Artist has no profile yet — return empty array rather than 404.
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode([]applicationResponse{})
				return
			}
			httperr.InternalServerError(w)
			return
		}

		apps, err := q.ListApplicationsByArtist(r.Context(), profile.ID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		resp := make([]applicationResponse, len(apps))
		for i, a := range apps {
			resp[i] = toApplicationResponse(a)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}
}
