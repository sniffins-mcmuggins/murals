import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { createHmac } from 'node:crypto'
import { createArtist, createProfile, uniqueSuffix } from '../fixtures/helpers'

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

describe('profile visibility (E15.1)', () => {
  let db: Client
  let adminToken: string

  beforeAll(async () => {
    db = new Client({ connectionString: DB_URL })
    await db.connect()

    // Seed an admin for tests that need to publish via the API (so the gate passes).
    const adminEmail = `admin-vis-${Date.now()}@vis.test`
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
    const { id: adminUserId, session_version: sv } = rows[0]
    const now = Math.floor(Date.now() / 1000)
    adminToken = signHS256({ sub: adminUserId, is_admin: true, sv, iat: now, exp: now + 3600 }, JWT_SECRET)
  })

  afterAll(async () => {
    await db.end()
  })

  it('new profile is draft — anonymous GET returns 404', async () => {
    const suffix = uniqueSuffix()
    const { token } = await createArtist(suffix)
    const { profileId } = await createProfile(token, { displayName: `Draft ${suffix}` })

    const res = await fetch(`${API}/profiles/${profileId}`)
    expect(res.status).toBe(404)
  })

  it('owner can GET their own draft profile and sees visibility=draft', async () => {
    const suffix = uniqueSuffix() + 1
    const { token } = await createArtist(suffix)
    const { profileId } = await createProfile(token, { displayName: `Draft Owner ${suffix}` })

    const res = await fetch(`${API}/profiles/${profileId}`, { headers: auth(token) })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.id).toBe(profileId)
    expect(data.visibility).toBe('draft')
  })

  it('draft profile collections return 404 for anonymous caller', async () => {
    const suffix = uniqueSuffix() + 2
    const { token } = await createArtist(suffix)
    const { profileId } = await createProfile(token, { displayName: `Draft Coll ${suffix}` })

    const res = await fetch(`${API}/profiles/${profileId}/collections`)
    expect(res.status).toBe(404)
  })

  it('owner can GET collections on their draft profile', async () => {
    const suffix = uniqueSuffix() + 3
    const { token } = await createArtist(suffix)
    const { profileId } = await createProfile(token, { displayName: `Draft Coll Owner ${suffix}` })

    const res = await fetch(`${API}/profiles/${profileId}/collections`, { headers: auth(token) })
    expect(res.status).toBe(200)
  })

  it('non-owner authenticated user cannot see draft profile', async () => {
    const suffix = uniqueSuffix() + 4
    const { token: ownerToken } = await createArtist(suffix)
    const { profileId } = await createProfile(ownerToken, { displayName: `Draft Other ${suffix}` })

    const { token: otherToken } = await createArtist(suffix + 10000)
    const res = await fetch(`${API}/profiles/${profileId}`, { headers: auth(otherToken) })
    expect(res.status).toBe(404)
  })

  it('draft profile does not appear in GET /public/profiles', async () => {
    const suffix = uniqueSuffix() + 5
    const { token } = await createArtist(suffix)
    const { profileId } = await createProfile(token, { displayName: `Hidden ${suffix}` })

    const res = await fetch(`${API}/public/profiles`)
    const list = await res.json()
    expect(list.profiles.every((p: { id: string }) => p.id !== profileId)).toBe(true)
  })

  it('PATCH visibility to public → anonymous GET 200, appears in /public/profiles', async () => {
    const suffix = uniqueSuffix() + 6
    const { token, userId } = await createArtist(suffix)
    const { profileId } = await createProfile(token, { displayName: `Going Public ${suffix}` })

    // Confirm draft state first
    expect((await fetch(`${API}/profiles/${profileId}`)).status).toBe(404)

    // Grant access so the publish gate passes.
    const grantRes = await fetch(`${API}/admin/users/${userId}/grants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(adminToken) },
      body: JSON.stringify({ plan: 'artist_basic', duration_days: 30, note: 'visibility e2e test' }),
    })
    expect(grantRes.status).toBe(201)

    // Flip to public
    const patchRes = await fetch(`${API}/profiles/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth(token) },
      body: JSON.stringify({ visibility: 'public' }),
    })
    expect(patchRes.status).toBe(200)
    expect((await patchRes.json()).visibility).toBe('public')

    // Now accessible anonymously
    const getRes = await fetch(`${API}/profiles/${profileId}`)
    expect(getRes.status).toBe(200)
    expect((await getRes.json()).visibility).toBe('public')

    // Appears in public listing
    const listRes = await fetch(`${API}/public/profiles`)
    const list = await listRes.json()
    expect(list.profiles.some((p: { id: string }) => p.id === profileId)).toBe(true)
  })

  it('PATCH visibility with invalid value → 422', async () => {
    const suffix = uniqueSuffix() + 7
    const { token } = await createArtist(suffix)
    await createProfile(token, { displayName: `Bad Vis ${suffix}` })

    const res = await fetch(`${API}/profiles/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth(token) },
      body: JSON.stringify({ visibility: 'suspended' }),
    })
    expect(res.status).toBe(422)
  })
})
