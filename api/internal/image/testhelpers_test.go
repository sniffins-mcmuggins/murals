package image_test

import (
	"context"
	"fmt"
	"sync/atomic"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

const testSecret = "test-secret-key"

// testUserSeq makes each call to testBearerToken create a uniquely-emailed
// user — needed because the DB persists across tests in the same package.
var testUserSeq atomic.Uint64

// testBearerToken creates a real user row in db and returns a JWT bound to
// that user's current session_version. The auth middleware reads the user
// row to validate sv, so tokens must reference real users.
func testBearerToken(t *testing.T, db *pgxpool.Pool) string {
	t.Helper()
	q := sqlcdb.New(db)
	pwHash := "x"
	email := fmt.Sprintf("image-test-%d@example.com", testUserSeq.Add(1))
	user, err := q.CreateUser(context.Background(), sqlcdb.CreateUserParams{
		Email:        email,
		PasswordHash: &pwHash,
	})
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	token, err := auth.IssueToken(user.ID.String(), user.IsAdmin, user.SessionVersion, testSecret)
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}
	return token
}
