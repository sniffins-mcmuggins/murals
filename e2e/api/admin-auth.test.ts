// Admin auth integration tests.
// Covers issues: #124 (is_admin re-checked from DB), #125 (unauthenticated probe),
//                #126 (regular user → 403), #127 (admin without MFA → 403),
//                #128 (admin password reset session behavior)
//
// Unit tests in api/internal/admin/*_test.go inject principals via
// auth.WithUserForTest(), bypassing the middleware stack entirely. These tests
// hit the live server to confirm the actual route wiring in main.go.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { createHmac } from 'node:crypto'
import { injectResetToken, resetPassword } from '../fixtures/auth-flows.js'

const API = process.env.API_URL ?? 'http://localhost:8080'
const DB_URL = process.env.DATABASE_URL ?? 'postgres://render:render@localhost:5432/render'
const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-jwt-secret-change-in-prod'
const SUFFIX = `admin-auth-${Date.now()}`

function auth(t: string) {
  return { Authorization: `Bearer ${t}` }
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

// Signs up a user via API, promotes them to admin with MFA in the DB,
// and mints a valid JWT. Returns the token and userId.
async function seedAdminUser(
  db: Client,
  suffix: string | number,
  opts: { mfaEnabled?: boolean } = {},
): Promise<{ token: string; userId: string; email: string }> {
  const mfaEnabled = opts.mfaEnabled ?? true
  const email = `admin-${suffix}@e2e.test`
  await fetch(`${API}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'adminpass123' }),
  })
  const { rows } = await db.query<{ id: string; session_version: number }>(
    `UPDATE users SET is_admin = true, mfa_enabled = $2, mfa_secret = 'fake-totp-secret'
     WHERE email = $1 RETURNING id, session_version`,
    [email, mfaEnabled],
  )
  const { id: userId, session_version: sv } = rows[0]
  const now = Math.floor(Date.now() / 1000)
  const token = signHS256({ sub: userId, is_admin: true, sv, iat: now, exp: now + 3600 }, JWT_SECRET)
  return { token, userId, email }
}

describe('admin auth', () => {
  let db: Client

  beforeAll(async () => {
    db = new Client({ connectionString: DB_URL })
    await db.connect()
  })

  afterAll(async () => {
    await db.end()
  })

  // ── #125: RequireAdmin middleware wiring — unauthenticated probe ─────────────
  // Confirms r.Use(admin.RequireAdmin(pool)) is actually in the route group.
  // No DB seeding required — a missing r.Use() would return 200 here.

  describe('unauthenticated /admin/* → 401', () => {
    it('GET /admin/users without token → 401', async () => {
      expect((await fetch(`${API}/admin/users`)).status).toBe(401)
    })

    it('GET /admin/promo-codes without token → 401', async () => {
      expect((await fetch(`${API}/admin/promo-codes`)).status).toBe(401)
    })

    it('POST /admin/promo-codes without token → 401', async () => {
      const res = await fetch(`${API}/admin/promo-codes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'TEST', plan: 'artist_pro', duration_days: 30 }),
      })
      expect(res.status).toBe(401)
    })
  })

  // ── #126: Regular user → 403 on /admin/* ────────────────────────────────────
  // Uses signup+signHS256 (no login) — testing JWT claim rejection, not login flow.
  // A token without is_admin claim is indistinguishable from one with is_admin: false.

  describe('regular user (non-admin) /admin/* → 403', () => {
    let nonAdminToken: string

    beforeAll(async () => {
      const email = `non-admin-${SUFFIX}@e2e.test`
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
      nonAdminToken = signHS256({ sub: userId, sv, iat: now, exp: now + 3600 }, JWT_SECRET)
    })

    it('GET /admin/users with non-admin JWT → 403', async () => {
      expect((await fetch(`${API}/admin/users`, { headers: auth(nonAdminToken) })).status).toBe(403)
    })

    it('GET /admin/promo-codes with non-admin JWT → 403', async () => {
      expect((await fetch(`${API}/admin/promo-codes`, { headers: auth(nonAdminToken) })).status).toBe(403)
    })

    it('POST /admin/promo-codes with non-admin JWT → 403', async () => {
      const res = await fetch(`${API}/admin/promo-codes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth(nonAdminToken) },
        body: JSON.stringify({ code: 'SHOULD-FAIL', plan: 'artist_pro', duration_days: 30 }),
      })
      expect(res.status).toBe(403)
    })
  })

  // ── #127: Admin without MFA → 403 ───────────────────────────────────────────

  it('admin user with is_admin=true but mfa_enabled=false → 403 with MFA message', async () => {
    const { token } = await seedAdminUser(db, `${SUFFIX}-nomfa`, { mfaEnabled: false })
    const res = await fetch(`${API}/admin/users`, { headers: auth(token) })
    expect(res.status).toBe(403)
    expect(await res.text()).toContain('admin account must have MFA enrolled')
  })

  // ── #124 [Bug fix]: is_admin re-read from DB — demoted admin loses access ───
  // Without the fix, RequireAdmin checked principal.IsAdmin (from JWT claim)
  // and skipped the DB value. A demoted admin's JWT would still pass.

  it('demoted admin: JWT with is_admin=true but DB is_admin=false → 403', async () => {
    const { token, userId } = await seedAdminUser(db, `${SUFFIX}-demote`)

    // Confirm access granted before demotion
    expect((await fetch(`${API}/admin/users`, { headers: auth(token) })).status).toBe(200)

    // Demote in DB (simulates admin revocation without waiting for JWT expiry)
    await db.query('UPDATE users SET is_admin = false WHERE id = $1', [userId])

    // Old JWT still carries is_admin: true — must now be rejected
    expect((await fetch(`${API}/admin/users`, { headers: auth(token) })).status).toBe(403)
  })

  // ── #128: Admin password reset session behavior ──────────────────────────────
  // Documented behavior: admin-triggered reset fires a goroutine but does NOT
  // call IncrementSessionVersion. The target's session stays valid until the
  // user clicks the reset link. Session is only revoked on completion.

  it('admin-triggered password reset: target session valid until user completes reset', async () => {
    // signupAndMint avoids hitting the /auth/login rate limit. The synthetic token
    // carries sv=0 (from signup). After resetPassword, session_version in the DB
    // becomes 1, so the auth middleware rejects the old token (sv mismatch → 401).
    const targetEmail = `pwreset-target-${SUFFIX}@e2e.test`
    const targetPassword = 'testpass123'
    await fetch(`${API}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: targetEmail, password: targetPassword }),
    })
    const { rows: targetRows } = await db.query<{ id: string; session_version: number }>(
      'SELECT id, session_version FROM users WHERE email = $1',
      [targetEmail],
    )
    const { id: targetId, session_version: targetSv } = targetRows[0]
    const now = Math.floor(Date.now() / 1000)
    const targetToken = signHS256({ sub: targetId, sv: targetSv, iat: now, exp: now + 3600 }, JWT_SECRET)

    const { token: adminToken } = await seedAdminUser(db, `${SUFFIX}-pwreset-admin`)

    // Target's token works before anything
    expect((await fetch(`${API}/me`, { headers: auth(targetToken) })).status).toBe(200)

    // Admin triggers reset — fires goroutine, no immediate revocation
    const triggerRes = await fetch(`${API}/admin/users/${targetId}/password-reset`, {
      method: 'POST',
      headers: auth(adminToken),
    })
    expect(triggerRes.status).toBe(202)

    // Target session must still be valid (reset email sent, user hasn't clicked it)
    expect((await fetch(`${API}/me`, { headers: auth(targetToken) })).status).toBe(200)

    // User completes the reset
    const rawToken = await injectResetToken(targetEmail)
    const resetRes = await resetPassword(rawToken, 'new-password-after-admin-trigger')
    expect(resetRes.status).toBe(200)

    // Now the old token must be invalid — session_version was bumped on completion
    expect((await fetch(`${API}/me`, { headers: auth(targetToken) })).status).toBe(401)
  })
})
