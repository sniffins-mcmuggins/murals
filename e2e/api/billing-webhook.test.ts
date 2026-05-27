// Stripe webhook side-effect tests (B7–B14).
//
// These tests hit POST /billing/webhook with signed payloads (no Stripe network)
// and assert the resulting DB state directly via the `pg` client. Each test
// generates fresh Stripe IDs (sub_test_*, cs_test_*) so reruns don't collide.
//
// Plan-resolution note: in the local stack the STRIPE_*_PRICE_ID env vars are
// empty, so the billing.Prices struct is all empty strings and
// PlanFromPriceID(...) always returns "unknown" for any non-empty price_id. B7
// asserts on that "unknown" mapping — when prices get wired in CI/prod, this
// test will fail loudly and prompt an update. The contract being locked in here
// is "plan is derived from price_id via the resolver", not the specific mapping.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { randomUUID } from 'node:crypto'
import { postWebhook, signStripePayload } from '../fixtures/stripe-webhook.js'
import { createArtist } from '../fixtures/helpers.js'

const API = process.env.API_URL ?? 'http://localhost:8080'
const DB_URL =
  process.env.DATABASE_URL ?? 'postgres://render:render@localhost:5432/render'

// Numeric suffix base — each test adds a small offset so emails are unique
// across tests in this file and across reruns. createArtist expects a number
// because it defaults to Date.now().
const SUFFIX_BASE = Date.now()

// ─── Event factories ──────────────────────────────────────────────────────────
//
// Mirror the shapes the Go handler unmarshals — see api/internal/billing/webhook.go
// and its unit tests for the canonical examples.

interface SubscriptionEventOpts {
  eventId?: string
  subscriptionId: string
  status?: string
  priceId?: string
  userId?: string
  festivalId?: string
  currentPeriodEnd?: number
}

function subscriptionEvent(
  type: 'customer.subscription.created' | 'customer.subscription.updated' | 'customer.subscription.deleted',
  opts: SubscriptionEventOpts,
): Record<string, unknown> {
  const metadata: Record<string, string> = {}
  if (opts.userId) metadata.user_id = opts.userId
  if (opts.festivalId) metadata.festival_id = opts.festivalId
  return {
    id: opts.eventId ?? `evt_${randomUUID()}`,
    type,
    data: {
      object: {
        id: opts.subscriptionId,
        status: opts.status ?? 'active',
        items: {
          data: [
            {
              id: `si_${randomUUID()}`,
              price: { id: opts.priceId ?? `price_test_${randomUUID()}` },
              current_period_end: opts.currentPeriodEnd ?? 0,
            },
          ],
        },
        metadata,
      },
    },
  }
}

function invoicePaymentFailedEvent(opts: {
  subscriptionId: string
  eventId?: string
}): Record<string, unknown> {
  return {
    id: opts.eventId ?? `evt_${randomUUID()}`,
    type: 'invoice.payment_failed',
    data: {
      object: {
        id: `in_${randomUUID()}`,
        parent: {
          subscription_details: {
            subscription: { id: opts.subscriptionId },
          },
        },
      },
    },
  }
}

function checkoutCompletedEvent(opts: {
  sessionId: string
  paymentIntentId?: string
  eventId?: string
  chargeType?: 'setup_fee' | 'festival_activation'
  userId?: string
  festivalId?: string
}): Record<string, unknown> {
  const metadata: Record<string, string> = {}
  if (opts.chargeType) metadata.charge_type = opts.chargeType
  if (opts.userId) metadata.user_id = opts.userId
  if (opts.festivalId) metadata.festival_id = opts.festivalId
  return {
    id: opts.eventId ?? `evt_${randomUUID()}`,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: opts.sessionId,
        payment_intent: opts.paymentIntentId
          ? { id: opts.paymentIntentId }
          : null,
        metadata,
      },
    },
  }
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

let db: Client

async function countSubsByUser(userId: string): Promise<number> {
  const { rows } = await db.query<{ c: string }>(
    'SELECT COUNT(*)::text AS c FROM subscriptions WHERE user_id = $1',
    [userId],
  )
  return parseInt(rows[0].c, 10)
}

async function getSubByStripeId(stripeSubId: string): Promise<
  | {
      user_id: string
      status: string
      plan: string
      stripe_price_id: string
      billing_interval: string
    }
  | null
> {
  const { rows } = await db.query<{
    user_id: string
    status: string
    plan: string
    stripe_price_id: string
    billing_interval: string
  }>(
    `SELECT user_id, status, plan, stripe_price_id, billing_interval
     FROM subscriptions WHERE stripe_subscription_id = $1`,
    [stripeSubId],
  )
  return rows[0] ?? null
}

async function countSubsByStripeId(stripeSubId: string): Promise<number> {
  const { rows } = await db.query<{ c: string }>(
    'SELECT COUNT(*)::text AS c FROM subscriptions WHERE stripe_subscription_id = $1',
    [stripeSubId],
  )
  return parseInt(rows[0].c, 10)
}

async function getOrgPaymentStatus(sessionId: string): Promise<string | null> {
  const { rows } = await db.query<{ status: string }>(
    'SELECT status FROM organiser_payments WHERE stripe_checkout_session_id = $1',
    [sessionId],
  )
  return rows[0]?.status ?? null
}

async function seedPendingOrgPayment(opts: {
  userId: string
  sessionId: string
  chargeType?: string
  amountPence?: number
}): Promise<void> {
  await db.query(
    `INSERT INTO organiser_payments
       (user_id, stripe_checkout_session_id, charge_type, amount_pence, status)
     VALUES ($1, $2, $3, $4, 'pending')`,
    [
      opts.userId,
      opts.sessionId,
      opts.chargeType ?? 'setup_fee',
      opts.amountPence ?? 3500,
    ],
  )
}

async function seedPaidOrgPayment(opts: {
  userId: string
  sessionId: string
  paymentIntentId: string
  chargeType?: string
  amountPence?: number
}): Promise<void> {
  await db.query(
    `INSERT INTO organiser_payments
       (user_id, stripe_checkout_session_id, stripe_payment_intent_id,
        charge_type, amount_pence, status, paid_at)
     VALUES ($1, $2, $3, $4, $5, 'paid', now())`,
    [
      opts.userId,
      opts.sessionId,
      opts.paymentIntentId,
      opts.chargeType ?? 'setup_fee',
      opts.amountPence ?? 3500,
    ],
  )
}

async function seedActiveSubscription(opts: {
  userId: string
  stripeSubId: string
  priceId?: string
}): Promise<void> {
  await db.query(
    `INSERT INTO subscriptions
       (user_id, stripe_subscription_id, stripe_price_id, plan, billing_interval, status)
     VALUES ($1, $2, $3, 'unknown', 'month', 'active')`,
    [opts.userId, opts.stripeSubId, opts.priceId ?? `price_seed_${randomUUID()}`],
  )
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

beforeAll(async () => {
  db = new Client({ connectionString: DB_URL })
  await db.connect()
})

afterAll(async () => {
  await db.end()
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('billing webhook side-effects', () => {
  it('B7 — customer.subscription.created with metadata.user_id upserts a subscription row', async () => {
    const artist = await createArtist(SUFFIX_BASE + 7)
    const subId = `sub_test_${randomUUID()}`
    const priceId = `price_test_${randomUUID()}`

    const res = await postWebhook(
      subscriptionEvent('customer.subscription.created', {
        subscriptionId: subId,
        userId: artist.userId,
        priceId,
        status: 'active',
      }),
    )
    expect(res.status).toBe(200)

    const row = await getSubByStripeId(subId)
    expect(row).not.toBeNull()
    expect(row!.user_id).toBe(artist.userId)
    expect(row!.status).toBe('active')
    expect(row!.stripe_price_id).toBe(priceId)
    // STRIPE_*_PRICE_ID env vars are empty in this stack, so the resolver
    // returns "unknown" — we are asserting the mapping is invoked, not its
    // result. When prices are wired, this assertion should be updated.
    expect(row!.plan).toBe('unknown')
  })

  it('B8 — same customer.subscription.created twice upserts (no duplicate row)', async () => {
    const artist = await createArtist(SUFFIX_BASE + 8)
    const subId = `sub_test_${randomUUID()}`
    const priceId = `price_test_${randomUUID()}`
    const event = subscriptionEvent('customer.subscription.created', {
      subscriptionId: subId,
      userId: artist.userId,
      priceId,
    })

    const res1 = await postWebhook(event)
    expect(res1.status).toBe(200)
    const res2 = await postWebhook(event)
    expect(res2.status).toBe(200)

    expect(await countSubsByStripeId(subId)).toBe(1)
  })

  it('B9 — customer.subscription.deleted flips an existing row to canceled', async () => {
    const artist = await createArtist(SUFFIX_BASE + 9)
    const subId = `sub_test_${randomUUID()}`
    await seedActiveSubscription({ userId: artist.userId, stripeSubId: subId })

    const res = await postWebhook(
      subscriptionEvent('customer.subscription.deleted', {
        subscriptionId: subId,
        userId: artist.userId,
        status: 'canceled',
      }),
    )
    expect(res.status).toBe(200)

    const row = await getSubByStripeId(subId)
    expect(row).not.toBeNull()
    expect(row!.status).toBe('canceled')
  })

  it('B10 — invoice.payment_failed (with subscription ref) flips status to past_due', async () => {
    const artist = await createArtist(SUFFIX_BASE + 10)
    const subId = `sub_test_${randomUUID()}`
    await seedActiveSubscription({ userId: artist.userId, stripeSubId: subId })

    const res = await postWebhook(invoicePaymentFailedEvent({ subscriptionId: subId }))
    expect(res.status).toBe(200)

    const row = await getSubByStripeId(subId)
    expect(row).not.toBeNull()
    expect(row!.status).toBe('past_due')
  })

  it('B11 — checkout.session.completed flips pending organiser_payments to paid', async () => {
    const artist = await createArtist(SUFFIX_BASE + 11)
    const sessionId = `cs_test_${randomUUID()}`
    const paymentIntentId = `pi_test_${randomUUID()}`
    await seedPendingOrgPayment({
      userId: artist.userId,
      sessionId,
      chargeType: 'setup_fee',
    })

    const res = await postWebhook(
      checkoutCompletedEvent({
        sessionId,
        paymentIntentId,
        chargeType: 'setup_fee',
        userId: artist.userId,
      }),
    )
    expect(res.status).toBe(200)

    expect(await getOrgPaymentStatus(sessionId)).toBe('paid')
  })

  it('B12 — retried checkout.session.completed for an already-paid row does NOT create a duplicate subscription', async () => {
    // This is the idempotency canary for the MarkOrgPaymentPaidIfPending fix
    // landed mid-PR-#102. A festival_activation checkout that has already
    // been processed must not trigger startAnnualFestivalSubscription again.
    const artist = await createArtist(SUFFIX_BASE + 12)
    const sessionId = `cs_test_${randomUUID()}`
    const paymentIntentId = `pi_test_${randomUUID()}`
    await seedPaidOrgPayment({
      userId: artist.userId,
      sessionId,
      paymentIntentId,
      chargeType: 'festival_activation',
    })

    const before = await countSubsByUser(artist.userId)

    const res = await postWebhook(
      checkoutCompletedEvent({
        sessionId,
        paymentIntentId,
        chargeType: 'festival_activation',
        userId: artist.userId,
      }),
    )
    expect(res.status).toBe(200)

    const after = await countSubsByUser(artist.userId)
    expect(after).toBe(before)
    // And the org payment row is still 'paid' (no regression to pending).
    expect(await getOrgPaymentStatus(sessionId)).toBe('paid')
  })

  it('B13 — bad Stripe-Signature returns 400 and writes nothing', async () => {
    const artist = await createArtist(SUFFIX_BASE + 13)
    const subId = `sub_test_${randomUUID()}`
    const before = await countSubsByUser(artist.userId)

    const event = subscriptionEvent('customer.subscription.created', {
      subscriptionId: subId,
      userId: artist.userId,
    })
    const body = JSON.stringify(event)
    const res = await fetch(`${API}/billing/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': signStripePayload(body, 'wrong-secret'),
      },
      body,
    })
    expect(res.status).toBe(400)

    expect(await getSubByStripeId(subId)).toBeNull()
    expect(await countSubsByUser(artist.userId)).toBe(before)
  })

  it('B14 — customer.subscription.created missing metadata.user_id returns 200 but writes no row', async () => {
    // Stripe must not be told to retry; the data is bad, not the endpoint.
    const subId = `sub_test_${randomUUID()}`
    const event = subscriptionEvent('customer.subscription.created', {
      subscriptionId: subId,
      // userId intentionally omitted
    })

    const res = await postWebhook(event)
    expect(res.status).toBe(200)

    expect(await getSubByStripeId(subId)).toBeNull()
  })
})
