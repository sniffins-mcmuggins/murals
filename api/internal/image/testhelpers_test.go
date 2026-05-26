package image_test

import (
	"testing"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
)

const testSecret = "test-secret-key"

func testBearerToken(t *testing.T) string {
	t.Helper()
	token, err := auth.IssueToken("test-user-id", "artist", testSecret)
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}
	return token
}
