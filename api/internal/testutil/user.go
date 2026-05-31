package testutil

import (
	"context"
	"fmt"
	"sync/atomic"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

// TestSecret is the JWT signing key shared by all test helpers.
// Tests that wire up auth.Middleware should pass this constant.
const TestSecret = "test-secret-key"

var userSeq atomic.Int64

// CreateUser inserts a user row in pool with a unique generated email and
// returns a valid JWT for that user signed with TestSecret. Tests that need
// to authenticate requests should use this instead of rolling their own
// user-creation helpers.
func CreateUser(t *testing.T, pool *pgxpool.Pool) (userID, token, email string) {
	t.Helper()
	email = fmt.Sprintf("t-%d@t.local", userSeq.Add(1))
	hash, err := bcrypt.GenerateFromPassword([]byte("hunter2hunter"), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("CreateUser: bcrypt: %v", err)
	}
	hashStr := string(hash)
	q := sqlcdb.New(pool)
	user, err := q.CreateUser(context.Background(), sqlcdb.CreateUserParams{
		Email:        email,
		PasswordHash: &hashStr,
	})
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	userID = user.ID.String()
	token, err = auth.IssueToken(userID, user.IsAdmin, user.SessionVersion, TestSecret)
	if err != nil {
		t.Fatalf("CreateUser: issue token: %v", err)
	}
	return userID, token, email
}
