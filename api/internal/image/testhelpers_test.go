package image_test

import (
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

const testSecret = testutil.TestSecret

// testBearerToken creates a real user row in db and returns a JWT bound to
// that user's current session_version.
func testBearerToken(t *testing.T, db *pgxpool.Pool) string {
	t.Helper()
	_, token, _ := testutil.CreateUser(t, db)
	return token
}
