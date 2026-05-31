// e2e/api/publish-gate.test.ts
// E15.5 — Publish gate: subscription or comp grant required to go public.
// Covers: no entitlement → 402; admin grant → publish 200; expired grant → 402; public→draft → 200.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { createHmac } from 'node:crypto'

const API = process.env.API_URL ?? 'http://localhost:8080'
const DB_URL = process.env.DATABASE_URL ?? 'postgres://render:render@localhost:5432/render'
const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-jwt-secret-change-in-prod'
const SUFFIX = `pubgate-${Date.now()}`

function auth(token: string) {
  return { Authorization: `Bearer ${token}` }
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

async function seedAdminUser(db: Client, suffix: string): Promise<{ token: string; userId: string }> {
  const email = `admin-${suffix}@pubgate.test`
  await fetch(`${API}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'adminpass123' }),
  })
  const { rows } = await db.query<{ id: string; session_version: number }>(
    `UPDATE users SET is_admin = true, mfa_enabled = true, mfa_secret = 'fake-totp'
     WHERE email = $1 RETURNING id, session_version`,
    [email],
  )
  const { id: userId, session_version: sv } = rows[0]
  const now = Math.floor(Date.now() / 1000)
  const token = signHS256({ sub: userId, is_admin: true, sv, iat: now, exp: now + 3600 }, JWT_SECRET)
  return { token, userId }
}

async function signupAndLogin(email: string, password = 'testpass123') {
  await fetch(`${API}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const { token } = await res.json()
  return token as string
}

async function createProfile(token: string, displayName: string) {
  await fetch(`${API}/profiles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth(token) },
    body: JSON.stringify({ displayName }),
  })
}

async function tryPublish(token: string) {
  return fetch(`${API}/profiles/me`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...auth(token) },
    body: JSON.stringify({ visibility: 'public' }),
  })
}

describe('E15.5 — publish gate', () => {
  let db: Client
  let adminToken: string
  let adminUserId: string

  beforeAll(async () => {
    db = new Client({ connectionString: DB_URL })
    await db.connect()
    const admin = await seedAdminUser(db, SUFFIX)
    adminToken = admin.token
    adminUserId = admin.userId
  })

  afterAll(async () => {
    await db.end()
  })

  it('POST /admin/users/{id}/grants without token → 401', async () => {
    const res = await fetch(`${API}/admin/users/00000000-0000-0000-0000-000000000000/grants`, {
      method: 'POST',
    })
    expect(res.status).toBe(401)
  })

  it('PATCH visibility=public with no subscription or grant → 402', async () => {
    const token = await signupAndLogin(`noent-${SUFFIX}@pubgate.test`)
    await createProfile(token, `NoEnt-${SUFFIX}`)
    const res = await tryPublish(token)
    expect(res.status).toBe(402)
    const body = await res.json()
    expect(body.code).toBe('payment_required')
  })

  it('admin grants artist_basic → artist can publish', async () => {
    const token = await signupAndLogin(`withgrant-${SUFFIX}@pubgate.test`)
    await createProfile(token, `WithGrant-${SUFFIX}`)
    const { rows } = await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [
      `withgrant-${SUFFIX}@pubgate.test`,
    ])
    const artistUserId = rows[0].id

    const grantRes = await fetch(`${API}/admin/users/${artistUserId}/grants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(adminToken) },
      body: JSON.stringify({ plan: 'artist_basic', duration_days: 30, note: 'e2e test comp' }),
    })
    expect(grantRes.status).toBe(201)

    const pubRes = await tryPublish(token)
    expect(pubRes.status).toBe(200)
    const pubBody = await pubRes.json()
    expect(pubBody.visibility).toBe('public')
  })

  it('expired grant → 402', async () => {
    const token = await signupAndLogin(`expgrant-${SUFFIX}@pubgate.test`)
    await createProfile(token, `ExpGrant-${SUFFIX}`)
    const { rows: uRows } = await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [
      `expgrant-${SUFFIX}@pubgate.test`,
    ])
    const artistUserId = uRows[0].id

    await db.query(
      `INSERT INTO access_grants (user_id, plan, valid_until, granted_by, note)
       VALUES ($1, 'artist_basic', now() - interval '1 day', $2, 'expired e2e test')`,
      [artistUserId, adminUserId],
    )

    const pubRes = await tryPublish(token)
    expect(pubRes.status).toBe(402)
    const body = await pubRes.json()
    expect(body.code).toBe('payment_required')
  })

  it('already-public artist can set visibility=draft without a grant', async () => {
    const token = await signupAndLogin(`gopublic-${SUFFIX}@pubgate.test`)
    await createProfile(token, `GoPublic-${SUFFIX}`)
    const { rows: uRows } = await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [
      `gopublic-${SUFFIX}@pubgate.test`,
    ])
    const artistUserId = uRows[0].id
    // Set public via DB, bypassing the gate — simulates an existing public artist
    await db.query(`UPDATE artist_profiles SET visibility = 'public' WHERE user_id = $1`, [artistUserId])

    const draftRes = await fetch(`${API}/profiles/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth(token) },
      body: JSON.stringify({ visibility: 'draft' }),
    })
    expect(draftRes.status).toBe(200)
    const body = await draftRes.json()
    expect(body.visibility).toBe('draft')
  })
})
