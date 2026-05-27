package billing_test

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/sniffins-mcmuggins/render/api/internal/billing"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
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

// TestMarkOrgPaymentPaidIfPending_IsIdempotent locks in the fix for the
// duplicate-annual-subscription bug: the second call from a Stripe webhook
// retry must NOT report a successful transition, so callers can skip
// downstream side effects on retries.
func TestMarkOrgPaymentPaidIfPending_IsIdempotent(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	q := sqlcdb.New(db)
	ctx := context.Background()

	user, err := q.CreateUser(ctx, sqlcdb.CreateUserParams{
		Email:        "org-" + uuid.NewString() + "@test",
		PasswordHash: ptr("x"),
		Role:         sqlcdb.UserRoleOrganiser,
	})
	require.NoError(t, err)

	sessionID := "cs_test_" + uuid.NewString()
	piID := "pi_test_" + uuid.NewString()
	_, err = q.CreateOrgPayment(ctx, sqlcdb.CreateOrgPaymentParams{
		UserID:                  user.ID,
		FestivalID:              pgtype.UUID{},
		StripeCheckoutSessionID: &sessionID,
		ChargeType:              "setup_fee",
		AmountPence:             3500,
	})
	require.NoError(t, err)

	first, err := q.MarkOrgPaymentPaidIfPending(ctx, sqlcdb.MarkOrgPaymentPaidIfPendingParams{
		StripeCheckoutSessionID: &sessionID,
		StripePaymentIntentID:   &piID,
	})
	require.NoError(t, err, "first transition should succeed")
	assert.Equal(t, "paid", first.Status)

	piID2 := "pi_test_" + uuid.NewString()
	_, err = q.MarkOrgPaymentPaidIfPending(ctx, sqlcdb.MarkOrgPaymentPaidIfPendingParams{
		StripeCheckoutSessionID: &sessionID,
		StripePaymentIntentID:   &piID2,
	})
	assert.True(t, errors.Is(err, pgx.ErrNoRows),
		"second call (webhook retry) must return ErrNoRows so caller skips side effects, got %v", err)

	// And the payment_intent_id must not have been overwritten by the retry.
	current, err := q.GetOrgPaymentBySession(ctx, &sessionID)
	require.NoError(t, err)
	require.NotNil(t, current.StripePaymentIntentID)
	assert.Equal(t, piID, *current.StripePaymentIntentID, "payment_intent_id must remain the first one")
}

// TestWebhookHandler_SubscriptionMissingUserMeta verifies the
// handleSubscriptionUpsert path rejects events with missing user_id metadata
// (which would otherwise produce a NOT NULL violation). The webhook still
// returns 200 (so Stripe stops retrying), and no subscription row is created.
func TestWebhookHandler_SubscriptionMissingUserMeta(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	handler := billing.WebhookHandler(db, nil, testWebhookSecret, billing.Prices{})

	// Subscription event with no metadata.user_id.
	body := []byte(`{
        "id":"evt_test",
        "type":"customer.subscription.created",
        "data":{"object":{
            "id":"sub_test",
            "status":"active",
            "items":{"data":[{"id":"si_test","price":{"id":"price_test"},"current_period_end":0}]},
            "metadata":{}
        }}
    }`)
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/billing/webhook",
		bytes.NewReader(body))
	r.Header.Set("Stripe-Signature", stripeSignature(body, testWebhookSecret))
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)

	assert.Equal(t, http.StatusOK, w.Code, "must 200 so Stripe stops retrying — the data is bad, not the endpoint")

	q := sqlcdb.New(db)
	subID := "sub_test"
	_, err := q.GetSubscriptionByStripeID(t.Context(), &subID)
	assert.True(t, errors.Is(err, pgx.ErrNoRows), "no subscription row must be created when user_id metadata is missing")
}
