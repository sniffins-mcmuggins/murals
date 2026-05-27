package billing_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/sniffins-mcmuggins/render/api/internal/billing"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

func TestRequirePlan_NoSubscription_Returns403(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	middleware := billing.RequirePlan(db, "artist_pro")

	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	handler := middleware(next)

	// Request with no auth (no principal in context)
	r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	assert.Equal(t, http.StatusForbidden, w.Code)
}
