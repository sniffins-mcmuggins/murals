package festival

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

type mapPin struct {
	ArtistID string  `json:"artist_id"`
	Name     string  `json:"name"`
	Lat      float64 `json:"lat"`
	Lng      float64 `json:"lng"`
	W3W      *string `json:"w3w,omitempty"`
}

type mapResponse struct {
	Pins []mapPin `json:"pins"`
}

// GetMapDataHandler handles GET /festivals/slug/{slug}/map. Public. Festival must be live.
func GetMapDataHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		slug := chi.URLParam(r, "slug")

		q := sqlcdb.New(pool)
		fest, err := q.GetFestivalBySlug(r.Context(), slug)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}

		if fest.Status != sqlcdb.FestivalStatusLive {
			httperr.NotFound(w)
			return
		}

		rows, err := q.GetFestivalMapPins(r.Context(), fest.ID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		pins := make([]mapPin, 0, len(rows))
		for _, row := range rows {
			lat, _ := row.PinLat.Float64Value()
			lng, _ := row.PinLng.Float64Value()
			pin := mapPin{
				ArtistID: row.ArtistID.String(),
				Name:     row.DisplayName,
				Lat:      lat.Float64,
				Lng:      lng.Float64,
				W3W:      row.W3w,
			}
			pins = append(pins, pin)
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(mapResponse{Pins: pins})
	}
}
