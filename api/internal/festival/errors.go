package festival

import (
	"context"
	"errors"
	"net/http"

	"github.com/google/uuid"
	"github.com/jackc/pgerrcode"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == pgerrcode.UniqueViolation
}

func isFKViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == pgerrcode.ForeignKeyViolation
}

func pgUUIDFromString(s string) (pgtype.UUID, error) {
	parsed, err := uuid.Parse(s)
	if err != nil {
		return pgtype.UUID{}, err
	}
	return pgtype.UUID{Bytes: [16]byte(parsed), Valid: true}, nil
}

// getApplicationForFestival loads an application and verifies it belongs to the given festival's form.
// Returns 404 if the application doesn't exist or doesn't belong to this festival.
func getApplicationForFestival(ctx context.Context, q *sqlcdb.Queries, w http.ResponseWriter, festUUID, appUUID pgtype.UUID) (sqlcdb.Application, bool) {
	app, err := q.GetApplicationByID(ctx, appUUID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httperr.NotFound(w)
		} else {
			httperr.InternalServerError(w)
		}
		return sqlcdb.Application{}, false
	}
	form, err := q.GetApplicationFormByFestivalID(ctx, festUUID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httperr.NotFound(w)
		} else {
			httperr.InternalServerError(w)
		}
		return sqlcdb.Application{}, false
	}
	if app.FormID != form.ID {
		httperr.NotFound(w)
		return sqlcdb.Application{}, false
	}
	return app, true
}
