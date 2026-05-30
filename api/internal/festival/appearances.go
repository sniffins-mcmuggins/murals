package festival

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

// appearanceResponse is one festival an artist is publicly appearing at.
// map_slug is non-nil only when the festival is live (the public map renders
// for live festivals only — see GetMapDataHandler).
type appearanceResponse struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	Slug      string  `json:"slug"`
	StartDate *string `json:"start_date"`
	EndDate   *string `json:"end_date"`
	Status    string  `json:"status"`
	MapSlug   *string `json:"map_slug"`
}

// ListArtistFestivalsHandler handles GET /profiles/{profileID}/festivals. Public — no auth required.
// Returns the publicly-visible festivals where this artist is accepted and/or has an
// assigned spot, for the "Appearances" section on the public artist profile.
func ListArtistFestivalsHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		profileUUID, err := pgUUIDFromString(chi.URLParam(r, "profileID"))
		if err != nil {
			httperr.BadRequest(w, "invalid profileID")
			return
		}

		q := sqlcdb.New(pool)
		rows, err := q.ListPublicFestivalsForArtist(r.Context(), profileUUID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		// Always serialise as a JSON array, never null.
		out := make([]appearanceResponse, 0, len(rows))
		for _, row := range rows {
			item := appearanceResponse{
				ID:     row.ID.String(),
				Name:   row.Name,
				Slug:   row.Slug,
				Status: string(row.Status),
			}
			if row.StartDate.Valid {
				s := row.StartDate.Time.Format("2006-01-02")
				item.StartDate = &s
			}
			if row.EndDate.Valid {
				e := row.EndDate.Time.Format("2006-01-02")
				item.EndDate = &e
			}
			// The public map only renders for live festivals, so only expose a
			// usable map link in that case.
			if row.Status == sqlcdb.FestivalStatusLive {
				slug := row.Slug
				item.MapSlug = &slug
			}
			out = append(out, item)
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(out)
	}
}
