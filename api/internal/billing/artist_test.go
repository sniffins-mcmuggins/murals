package billing_test

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/sniffins-mcmuggins/render/api/internal/billing"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

func TestArtistCheckout_Unauthenticated(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	sc := billing.NewStripeClient("sk_test_stub")
	handler := billing.ArtistCheckoutHandler(db, sc, billing.Prices{}, "http://localhost:3000")

	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/billing/artist/checkout",
		bytes.NewBufferString(`{"price_id":"price_basic_annual"}`))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}
