package festival

import (
	"encoding/json"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

// MyReviewingHandler handles GET /me/reviewing — festivals the caller reviews.
func MyReviewingHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, err := auth.User(r.Context())
		if err != nil {
			httperr.Unauthorized(w)
			return
		}
		uid, err := pgUUIDFromString(principal.UserID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}
		q := sqlcdb.New(pool)
		rows, err := q.ListFestivalsForReviewer(r.Context(), uid)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}
		type item struct {
			ID     string `json:"id"`
			Name   string `json:"name"`
			Slug   string `json:"slug"`
			Status string `json:"status"`
		}
		out := make([]item, len(rows))
		for i, row := range rows {
			out[i] = item{ID: row.ID.String(), Name: row.Name, Slug: row.Slug, Status: string(row.Status)}
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(out)
	}
}
