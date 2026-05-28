// Admin promo code and redemption tests.
// Covers issues: #132 (unauthenticated redeem → 401), #133 (CreatePromoCode validation),
//                #130 (concurrent redemption race condition)
//
// Issue #129 (rate limit 429) is not included: the test stack configures
// LOGIN_RATE_LIMIT_PER_MIN=120, making the threshold too high to hit reliably
// without affecting other parallel test files that share the same IP bucket.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { createHmac } from 'node:crypto'

const API = process.env.API_URL ?? 'http://localhost:8080'
const DB_URL = process.env.DATABASE_URL ?? 'postgres://render:render@localhost:5432/render'
const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-jwt-secret-change-in-prod'
const SUFFIX = `admin-promo-${Date.now()}`

function auth(t: string) {
  return { Authorization: `Bearer ${t}` }
}
function json(t: string) {
  return { 'Content-Type': 'application/json', ...auth(t) }
}

function base64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function signHS256(payload: Record<string, unknown>, secret: string): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = base64url(JSON.stringify(payload))
  const sig = base64url(createHmac('sha256', secret).update(`${header}.${body}`).digest())
  return `${header}.${body}.${sig}`
}

// Signup + mint JWT without calling /auth/login, avoiding the rate-limited endpoint.
async function signupAndMint(
  db: Client,
  suffix: string | number,
): Promise<{ token: string; userId: string }> {
  const email = `promo-user-${suffix}@e2e.test`
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
  return { token, userId }
}

async function seedAdminUser(
  db: Client,
  suffix: string | number,
): Promise<{ token: string; userId: string }> {
  const email = `admin-promo-${suffix}@e2e.test`
  await fetch(`${API}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'adminpass123' }),
  })
  const { rows } = await db.query<{ id: string; session_version: number }>(
    `UPDATE users SET is_admin = true, mfa_enabled = true, mfa_secret = 'fake-totp-secret'
     WHERE email = $1 RETURNING id, session_version`,
    [email],
  )
  const { id: userId, session_version: sv } = rows[0]
  const now = Math.floor(Date.now() / 1000)
  const token = signHS256({ sub: userId, is_admin: true, sv, iat: now, exp: now + 3600 }, JWT_SECRET)
  return { token, userId }
}

describe('admin promo', () => {
  let db: Client

  beforeAll(async () => {
    db = new Client({ connectionString: DB_URL })
    await db.connect()
  })

  afterAll(async () => {
    await db.end()
  })

  // ── #132: Unauthenticated and malformed redemption ───────────────────────────
  // /promo/redeem is in the rate-limited group (not auth-required middleware).
  // The 401 comes from the handler's own auth.User() check, not from middleware.

  describe('/promo/redeem auth and input validation', () => {
    it('POST /promo/redeem without token → 401', async () => {
      const res = await fetch(`${API}/promo/redeem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'ANY-CODE' }),
      })
      expect(res.status).toBe(401)
    })

    it('POST /promo/redeem authenticated but missing code → 400', async () => {
      const { token } = await signupAndMint(db, `${SUFFIX}-redeem-nocod`)
      const res = await fetch(`${API}/promo/redeem`, {
        method: 'POST',
        headers: json(token),
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(400)
    })
  })

  // ── #133: CreatePromoCode input validation ───────────────────────────────────

  describe('POST /admin/promo-codes input validation', () => {
    let adminToken: string

    beforeAll(async () => {
      const admin = await seedAdminUser(db, `${SUFFIX}-create`)
      adminToken = admin.token
    })

    it('plan=festival_activation → 400 with descriptive message', async () => {
      const res = await fetch(`${API}/admin/promo-codes`, {
        method: 'POST',
        headers: json(adminToken),
        body: JSON.stringify({ code: `FEST-${SUFFIX}`, plan: 'festival_activation', duration_days: 90 }),
      })
      expect(res.status).toBe(400)
      expect(await res.text()).toContain('festival_activation')
    })

    it('unknown plan string → 400', async () => {
      const res = await fetch(`${API}/admin/promo-codes`, {
        method: 'POST',
        headers: json(adminToken),
        body: JSON.stringify({ code: `BOGUS-${SUFFIX}`, plan: 'free_money', duration_days: 30 }),
      })
      expect(res.status).toBe(400)
    })

    it('duration_days=0 → 400 with must be positive message', async () => {
      const res = await fetch(`${API}/admin/promo-codes`, {
        method: 'POST',
        headers: json(adminToken),
        body: JSON.stringify({ code: `NODAYS-${SUFFIX}`, plan: 'artist_pro', duration_days: 0 }),
      })
      expect(res.status).toBe(400)
      expect(await res.text()).toContain('duration_days must be positive')
    })

    it('valid code → 200/201', async () => {
      const res = await fetch(`${API}/admin/promo-codes`, {
        method: 'POST',
        headers: json(adminToken),
        body: JSON.stringify({ code: `VALID-${SUFFIX}`, plan: 'artist_pro', duration_days: 30 }),
      })
      expect([200, 201]).toContain(res.status)
    })
  })

  // ── #130: Concurrent redemption race condition ───────────────────────────────
  // Two concurrent requests against a max_uses=1 code: exactly one succeeds,
  // one gets 409. DB use_count stays at 1.

  it('concurrent redemption of max_uses=1 code: exactly one 200 and one 409', async () => {
    const code = `RACE-${SUFFIX}`

    // Seed a promo code with max_uses=1 (need a created_by user row for FK)
    const { userId: adminId } = await seedAdminUser(db, `${SUFFIX}-race-admin`)
    await db.query(
      `INSERT INTO promo_codes (code, plan, duration_days, max_uses, created_by)
       VALUES ($1, 'artist_pro', 90, 1, $2)`,
      [code, adminId],
    )

    // Two different users — created sequentially to stay under the login rate limit.
    // The race is between the /promo/redeem fetch calls, not user creation.
    const user1 = await signupAndMint(db, `${SUFFIX}-race1`)
    const user2 = await signupAndMint(db, `${SUFFIX}-race2`)

    // Fire both concurrently
    const [res1, res2] = await Promise.all([
      fetch(`${API}/promo/redeem`, {
        method: 'POST',
        headers: json(user1.token),
        body: JSON.stringify({ code }),
      }),
      fetch(`${API}/promo/redeem`, {
        method: 'POST',
        headers: json(user2.token),
        body: JSON.stringify({ code }),
      }),
    ])

    const statuses = [res1.status, res2.status].sort((a, b) => a - b)
    expect(statuses).toEqual([200, 409])

    // DB use_count must be exactly 1 (not 2)
    const { rows } = await db.query<{ use_count: number }>(
      'SELECT use_count FROM promo_codes WHERE code = $1',
      [code],
    )
    expect(rows[0].use_count).toBe(1)

    // Exactly one access_grant row created
    const { rows: grants } = await db.query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM access_grants
       WHERE promo_code_id = (SELECT id FROM promo_codes WHERE code = $1)`,
      [code],
    )
    expect(Number(grants[0].cnt)).toBe(1)
  })
})
