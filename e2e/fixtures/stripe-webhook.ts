// Port of stripeSignature from api/internal/billing/webhook_test.go.
// Stripe verifies Stripe-Signature as `t=<unix_ts>,v1=<hex_hmac_sha256>`,
// where the HMAC is over `<ts>.<payload>` using the shared secret.
import { createHmac } from 'node:crypto'

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? 'whsec_test'
const API = process.env.API_URL ?? 'http://localhost:8080'

export function signStripePayload(payload: string, secret = WEBHOOK_SECRET): string {
  const ts = Math.floor(Date.now() / 1000)
  const mac = createHmac('sha256', secret).update(`${ts}.${payload}`).digest('hex')
  return `t=${ts},v1=${mac}`
}

export async function postWebhook(event: object): Promise<Response> {
  const body = JSON.stringify(event)
  return fetch(`${API}/billing/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Stripe-Signature': signStripePayload(body),
    },
    body,
  })
}
