package billing_test

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"

	"github.com/sniffins-mcmuggins/render/api/internal/billing"
	"github.com/sniffins-mcmuggins/render/api/internal/testutil"
)

const testWebhookSecret = "whsec_test"

func stripeSignature(payload []byte, secret string) string {
	ts := fmt.Sprintf("%d", time.Now().Unix())
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(ts + "." + string(payload)))
	sig := hex.EncodeToString(mac.Sum(nil))
	return fmt.Sprintf("t=%s,v1=%s", ts, sig)
}

func TestWebhookHandler_InvalidSignature(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	prices := billing.Prices{}
	handler := billing.WebhookHandler(db, nil, "wrong-secret", prices)

	body := []byte(`{"type":"customer.subscription.created"}`)
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/billing/webhook",
		bytes.NewReader(body))
	r.Header.Set("Stripe-Signature", stripeSignature(body, testWebhookSecret))
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestWebhookHandler_ValidSignature_UnknownEvent(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	prices := billing.Prices{}
	handler := billing.WebhookHandler(db, nil, testWebhookSecret, prices)

	body := []byte(`{"type":"payment_intent.created","data":{"object":{}}}`)
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/billing/webhook",
		bytes.NewReader(body))
	r.Header.Set("Stripe-Signature", stripeSignature(body, testWebhookSecret))
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	assert.Equal(t, http.StatusOK, w.Code, "unknown events must 200 OK to prevent Stripe retries")
}
