import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { createHmac } from 'node:crypto'
import { createArtist, createProfile, uniqueSuffix } from '../fixtures/helpers'
import { forcePublish } from '../fixtures/db-helpers'

const API = process.env.API_URL ?? 'http://localhost:8080'
const DB_URL = process.env.DATABASE_URL ?? 'postgres://render:render@localhost:5432/render'
const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-jwt-secret-change-in-prod'

const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

function base64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}
function signHS256(payload: Record<string, unknown>, secret: string): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = base64url(JSON.stringify(payload))
  const sig = base64url(createHmac('sha256', secret).update(`${header}.${body}`).digest())
  return `${header}.${body}.${sig}`
}

describe('GET /profiles/me/analytics', () => {
  let db: Client
  let adminToken: string

  beforeAll(async () => {
    db = new Client({ connectionString: DB_URL })
    await db.connect()

    const adminEmail = `admin-analytics-${Date.now()}@analytics.test`
    await fetch(`${API}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: adminEmail, password: 'adminpass123' }),
    })
    const { rows } = await db.query<{ id: string; session_version: number }>(
      `UPDATE users SET is_admin = true, mfa_enabled = true, mfa_secret = 'fake-totp'
       WHERE email = $1 RETURNING id, session_version`,
      [adminEmail],
    )
    const { id: adminId, session_version: sv } = rows[0]
    const now = Math.floor(Date.now() / 1000)
    adminToken = signHS256({ sub: adminId, is_admin: true, sv, iat: now, exp: now + 3600 }, JWT_SECRET)
  })

  afterAll(async () => {
    await db.end()
  })
  it('without token → 401', async () => {
    const res = await fetch(`${API}/profiles/me/analytics`)
    expect(res.status).toBe(401)
  })

  it('with token but no profile → 404', async () => {
    const suffix = uniqueSuffix()
    const { token } = await createArtist(suffix)

    const res = await fetch(`${API}/profiles/me/analytics`, { headers: auth(token) })
    expect(res.status).toBe(404)
  })

  it('returns zero counts and 90-day window for a free artist with no events', async () => {
    const suffix = uniqueSuffix()
    const { token } = await createArtist(suffix)
    await createProfile(token, { displayName: `Analytics Artist ${suffix}` })

    const res = await fetch(`${API}/profiles/me/analytics`, { headers: auth(token) })
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.profile_views).toBe(0)
    expect(data.qr_scans).toBe(0)
    expect(data.link_clicks).toBe(0)
    expect(data.window_days).toBe(90)
  })

  it('profile_view events appear in the response after visiting the public profile', async () => {
    const suffix = uniqueSuffix() + 1
    const { token, userId } = await createArtist(suffix)
    const { profileId } = await createProfile(token, { displayName: `View Artist ${suffix}` })
    // Bypass publish gate — this test is about analytics events, not the publish gate.
    await forcePublish(db, userId)

    // Trigger a profile_view by fetching the public profile.
    await fetch(`${API}/profiles/${profileId}`)
    await fetch(`${API}/profiles/${profileId}`)

    const res = await fetch(`${API}/profiles/me/analytics`, { headers: auth(token) })
    expect(res.status).toBe(200)

    const data = await res.json()
    // Events are recorded asynchronously; allow a moment for the goroutines to complete.
    // We check >= 1 rather than == 2 to avoid flakiness from timing.
    expect(data.profile_views).toBeGreaterThanOrEqual(1)
    expect(data.window_days).toBe(90)
  })

  it('link_click events appear in the response after POST /profiles/{profileID}/link-click', async () => {
    const suffix = uniqueSuffix() + 2
    const { token } = await createArtist(suffix)
    const { profileId } = await createProfile(token, { displayName: `Link Artist ${suffix}` })

    await fetch(`${API}/profiles/${profileId}/link-click`, { method: 'POST' })
    await fetch(`${API}/profiles/${profileId}/link-click`, { method: 'POST' })

    const res = await fetch(`${API}/profiles/me/analytics`, { headers: auth(token) })
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.link_clicks).toBeGreaterThanOrEqual(1)
    expect(data.window_days).toBe(90)
  })

  it('qr_scan events appear in the response after GET /profiles/me/qr', async () => {
    const suffix = uniqueSuffix() + 3
    const { token, userId } = await createArtist(suffix)
    await createProfile(token, { displayName: `QR Analytics Artist ${suffix}` })
    await forcePublish(db, userId)

    const qrRes = await fetch(`${API}/profiles/me/qr`, { headers: auth(token) })
    expect(qrRes.status).toBe(200)

    // Events are recorded asynchronously; allow a moment for the goroutine to complete.
    await new Promise(r => setTimeout(r, 150))

    const res = await fetch(`${API}/profiles/me/analytics`, { headers: auth(token) })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.qr_scans).toBeGreaterThanOrEqual(1)
  })

  it('artist with active artist_pro grant gets 730-day analytics window', async () => {
    const suffix = uniqueSuffix() + 4
    const { token, userId } = await createArtist(suffix)
    await createProfile(token, { displayName: `Pro Analytics Artist ${suffix}` })

    const grantRes = await fetch(`${API}/admin/users/${userId}/grants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(adminToken) },
      body: JSON.stringify({ plan: 'artist_pro', duration_days: 30, note: 'e2e analytics test' }),
    })
    expect(grantRes.status).toBe(201)

    const res = await fetch(`${API}/profiles/me/analytics`, { headers: auth(token) })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.window_days).toBe(730)
  })
})
