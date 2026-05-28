// Stripe billing guards (issue #110 / spec Part 2 — Guards). No Stripe network
// calls, no webhook plumbing — these tests only assert the API-level guards
// in api/internal/billing/{artist,organiser,festival,portal,middleware}.go.
//
// B6 RequirePlan: there is no real Pro-only endpoint yet (api/cmd/api/main.go
// previously had a comment to that effect). Wiring RequirePlan onto a real
// endpoint would be a product decision. The smaller, reversible alternative is
// a tiny test-only probe route — see /_test/billing/pro-only in main.go. The
// route is a one-line handler returning 200; it exposes no functionality, but
// lets us exercise the middleware's no-sub/basic/pro decision tree from the
// routing layer (which the Go unit tests in middleware_test.go don't cover).
// When a real Pro-only endpoint lands, retarget B6 at it and delete the probe.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { createHmac } from 'node:crypto'
import { createArtist, createOrganiser, createFestival } from '../fixtures/helpers.js'

const API = process.env.API_URL ?? 'http://localhost:8080'
const DB_URL = process.env.DATABASE_URL ?? 'postgres://render:render@localhost:5432/render'
const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-jwt-secret-change-in-prod'

function base64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}
function signHS256(payload: Record<string, unknown>, secret: string): string {
  const h = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const p = base64url(JSON.stringify(payload))
  const sig = base64url(createHmac('sha256', secret).update(`${h}.${p}`).digest())
  return `${h}.${p}.${sig}`
}

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` }
}

async function bodyText(res: Response): Promise<string> {
  return await res.text()
}

describe('billing guards (B1-B6)', () => {
  // Numeric suffix base (matches createArtist/createOrganiser signature). Each
  // test offsets from this to keep emails unique.
  const suffix = Date.now()
  let db: Client

  beforeAll(async () => {
    db = new Client({ connectionString: DB_URL })
    await db.connect()
  })

  afterAll(async () => {
    await db.end()
  })

  it('B1: POST /billing/artist/checkout unauthenticated → 401', async () => {
    const res = await fetch(`${API}/billing/artist/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ price_id: 'price_anything' }),
    })
    expect(res.status).toBe(401)
  })

  it('B2: POST /billing/artist/checkout with bogus price_id → 400 (invalid price_id)', async () => {
    const artist = await createArtist(suffix + 2)
    const res = await fetch(`${API}/billing/artist/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(artist.token) },
      body: JSON.stringify({ price_id: 'price_definitely_not_real_' + suffix }),
    })
    expect(res.status).toBe(400)
    const body = await bodyText(res)
    expect(body).toContain('invalid price_id')
  })

  // B3 retired: the previous "role=artist gets 403 from setup-checkout" gate
  // no longer exists. Any authenticated user can pay the organiser setup fee
  // (whether they ever organise is decided by what they do next, not at signup).
  // See spec docs/superpowers/specs/2026-05-27-unified-user-registration-design.md.

  it('B4: POST /billing/festival/{id}/activate-checkout without setup paid → 402 (organiser setup fee not paid)', async () => {
    const organiser = await createOrganiser(suffix + 4)
    const { festivalId } = await createFestival(organiser.token, {
      name: 'Billing Guards Festival',
      slug: `bg-festival-${suffix}-b4`,
      description: 'fixture',
    })
    // Intentionally do NOT insert organiser_payments — the guard must reject.
    const res = await fetch(`${API}/billing/festival/${festivalId}/activate-checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(organiser.token) },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(402)
    const body = await bodyText(res)
    expect(body).toContain('organiser setup fee not paid')
  })

  it('B5: POST /billing/portal for user with no stripe_customer_id → 404 (no billing account found)', async () => {
    const artist = await createArtist(suffix + 5)
    const res = await fetch(`${API}/billing/portal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(artist.token) },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(404)
    const body = await bodyText(res)
    expect(body).toContain('no billing account found')
  })

  describe('B6: RequirePlan("artist_pro") via /_test/billing/pro-only', () => {
    it('no subscription row → 403', async () => {
      const artist = await createArtist(suffix + 6)
      const res = await fetch(`${API}/_test/billing/pro-only`, {
        method: 'GET',
        headers: authHeader(artist.token),
      })
      expect(res.status).toBe(403)
      const body = await bodyText(res)
      // The middleware returns {code:"upgrade_required", message:"..."}.
      expect(body).toContain('upgrade_required')
    })

    it('subscriptions.plan = artist_basic + status = active → 403', async () => {
      const artist = await createArtist(suffix + 7)
      // Seed an active basic subscription directly. RequirePlan compares plan
      // ordinals; artist_basic < artist_pro, so this must still 403.
      await db.query(
        `INSERT INTO subscriptions (
           user_id, stripe_subscription_id, stripe_price_id, plan,
           billing_interval, status, current_period_end
         ) VALUES ($1, $2, 'price_test_basic', 'artist_basic', 'month', 'active', NOW() + interval '30 days')`,
        [artist.userId, `sub_test_${suffix}_b6_basic`],
      )
      const res = await fetch(`${API}/_test/billing/pro-only`, {
        method: 'GET',
        headers: authHeader(artist.token),
      })
      expect(res.status).toBe(403)
      const body = await bodyText(res)
      expect(body).toContain('upgrade_required')
    })

    it('subscriptions.plan = artist_pro + status = active → 200', async () => {
      const artist = await createArtist(suffix + 8)
      await db.query(
        `INSERT INTO subscriptions (
           user_id, stripe_subscription_id, stripe_price_id, plan,
           billing_interval, status, current_period_end
         ) VALUES ($1, $2, 'price_test_pro', 'artist_pro', 'month', 'active', NOW() + interval '30 days')`,
        [artist.userId, `sub_test_${suffix}_b6_pro`],
      )
      const res = await fetch(`${API}/_test/billing/pro-only`, {
        method: 'GET',
        headers: authHeader(artist.token),
      })
      expect(res.status).toBe(200)
    })
  })

  // ── B7: access_grant as RequirePlan fallback (issue #131) ───────────────────
  // RequirePlan falls back to HasActiveGrant when there is no subscription row
  // (or the subscription's plan is insufficient). PR #122 wired this path but
  // it has never been tested at the integration layer.

  // B7 uses signup+signHS256 (no /auth/login) to stay under the rate limit.
  describe('B7: RequirePlan passes with active access_grant (no subscription)', () => {
    async function signupAndMint(sfx: string): Promise<{ userId: string; token: string }> {
      const email = `bg7-${sfx}@e2e.test`
      await fetch(`${API}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'testpass123' }),
      })
      const { rows } = await db.query<{ id: string; session_version: number }>(
        'SELECT id, session_version FROM users WHERE email = $1',
        [email],
      )
      const { id: userId, session_version: sv } = rows[0]
      const now = Math.floor(Date.now() / 1000)
      const token = signHS256({ sub: userId, sv, iat: now, exp: now + 3600 }, JWT_SECRET)
      return { userId, token }
    }

    it('active artist_pro grant → /_test/billing/pro-only returns 200', async () => {
      const { userId, token } = await signupAndMint(`${suffix}-b7active`)
      await db.query(
        `INSERT INTO access_grants (user_id, plan, valid_until, granted_by)
         VALUES ($1, 'artist_pro', NOW() + interval '30 days', $1)`,
        [userId],
      )
      expect((await fetch(`${API}/_test/billing/pro-only`, { headers: authHeader(token) })).status).toBe(200)
    })

    it('expired artist_pro grant → 403 upgrade_required', async () => {
      const { userId, token } = await signupAndMint(`${suffix}-b7expired`)
      await db.query(
        `INSERT INTO access_grants (user_id, plan, valid_until, granted_by)
         VALUES ($1, 'artist_pro', NOW() - interval '1 day', $1)`,
        [userId],
      )
      const res = await fetch(`${API}/_test/billing/pro-only`, { headers: authHeader(token) })
      expect(res.status).toBe(403)
      expect(await bodyText(res)).toContain('upgrade_required')
    })

    it('artist_basic grant → 403 when artist_pro is required', async () => {
      const { userId, token } = await signupAndMint(`${suffix}-b7basic`)
      await db.query(
        `INSERT INTO access_grants (user_id, plan, valid_until, granted_by)
         VALUES ($1, 'artist_basic', NOW() + interval '30 days', $1)`,
        [userId],
      )
      expect((await fetch(`${API}/_test/billing/pro-only`, { headers: authHeader(token) })).status).toBe(403)
    })
  })
})
