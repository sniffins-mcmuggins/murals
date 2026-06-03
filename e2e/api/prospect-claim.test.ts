// e2e/api/prospect-claim.test.ts
// E15.4 — Pre-registered prospect profiles + claim-on-signup.
// Covers: admin creates prospect, preview access, IDOR isolation, claim flow,
// double-claim race, partial-index invariants.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { createHmac } from 'node:crypto'

const API = process.env.API_URL ?? 'http://localhost:8080'
const DB_URL = process.env.DATABASE_URL ?? 'postgres://render:render@localhost:5432/render'
const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-jwt-secret-change-in-prod'
const SUFFIX = `prospect-${Date.now()}`

function auth(token: string) { return { Authorization: `Bearer ${token}` } }

function base64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}
function signHS256(payload: Record<string, unknown>, secret: string): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = base64url(JSON.stringify(payload))
  const sig = base64url(createHmac('sha256', secret).update(`${header}.${body}`).digest())
  return `${header}.${body}.${sig}`
}

async function seedAdmin(db: Client, suffix: string): Promise<{ token: string; userId: string }> {
  const email = `admin-${suffix}@prospect.test`
  await fetch(`${API}/auth/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
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
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const verifyRes = await fetch(`${API}/_test/verify-email`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  if (!verifyRes.ok) throw new Error(`Verify failed: ${verifyRes.status}`)
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const { token } = await res.json()
  return token as string
}

describe('E15.4 — prospect profiles + claim-on-signup', () => {
  let db: Client
  let adminToken: string
  let prospectSeed: { display_name: string; bio: string }

  beforeAll(async () => {
    db = new Client({ connectionString: DB_URL })
    await db.connect()
    const admin = await seedAdmin(db, SUFFIX)
    adminToken = admin.token
    prospectSeed = { display_name: `Street Artist ${SUFFIX}`, bio: 'I paint walls.' }
  })

  afterAll(async () => { await db.end() })

  // ── Auth probe ──────────────────────────────────────────────────────────────

  it('POST /admin/prospects without token → 401', async () => {
    const res = await fetch(`${API}/admin/prospects`, { method: 'POST' })
    expect(res.status).toBe(401)
  })

  it('POST /admin/prospects as non-admin → 403', async () => {
    const token = await signupAndLogin(`nonAdmin-${SUFFIX}@prospect.test`)
    const res = await fetch(`${API}/admin/prospects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(token) },
      body: JSON.stringify(prospectSeed),
    })
    expect(res.status).toBe(403)
  })

  // ── Create prospect ─────────────────────────────────────────────────────────

  let profileId: string
  let claimToken: string
  let previewUrl: string

  it('admin creates prospect → 201 with claim_token and preview_url', async () => {
    const res = await fetch(`${API}/admin/prospects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(adminToken) },
      body: JSON.stringify({ ...prospectSeed, images: [] }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.profile_id).toBeTruthy()
    expect(body.claim_token).toBeTruthy()
    expect(body.preview_url).toMatch(/\/profiles\/preview\//)
    profileId = body.profile_id
    claimToken = body.claim_token
    previewUrl = body.preview_url
  })

  it('admin creates same prospect again → 201 with same profile_id (idempotent)', async () => {
    const res = await fetch(`${API}/admin/prospects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(adminToken) },
      body: JSON.stringify({ ...prospectSeed, images: [] }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.profile_id).toBe(profileId)
  })

  // ── Isolation: unclaimed profile is invisible ───────────────────────────────

  it('GET /profiles/{id} for unclaimed prospect → 404 (anonymous)', async () => {
    const res = await fetch(`${API}/profiles/${profileId}`)
    expect(res.status).toBe(404)
  })

  it('GET /profiles/{id} for unclaimed prospect → 404 (random auth user)', async () => {
    const token = await signupAndLogin(`randuser-${SUFFIX}@prospect.test`)
    const res = await fetch(`${API}/profiles/${profileId}`, { headers: auth(token) })
    expect(res.status).toBe(404)
  })

  it('unclaimed profile not in GET /public/profiles', async () => {
    const res = await fetch(`${API}/public/profiles`)
    expect(res.ok).toBe(true)
    const body = await res.json()
    const ids = (body.profiles as { id: string }[]).map(p => p.id)
    expect(ids).not.toContain(profileId)
  })

  // ── Preview token grants access ─────────────────────────────────────────────

  it('GET /profiles/preview/{token} → 200 with profile data', async () => {
    const token = previewUrl.replace('/profiles/preview/', '')
    const res = await fetch(`${API}/profiles/preview/${token}`)
    expect(res.ok).toBe(true)
    const body = await res.json()
    expect(body.display_name).toBe(prospectSeed.display_name)
  })

  // ── IDOR: user A cannot access user B's prospect collections ───────────────

  it('GET /profiles/{id}/collections for unclaimed prospect → 404', async () => {
    const token = await signupAndLogin(`idor-${SUFFIX}@prospect.test`)
    const res = await fetch(`${API}/profiles/${profileId}/collections`, { headers: auth(token) })
    expect(res.status).toBe(404)
  })

  // ── Claim at signup ─────────────────────────────────────────────────────────

  let claimerToken: string

  it('signup with claim_token → 201 with claimed_profile_id', async () => {
    const email = `claimer-${SUFFIX}@prospect.test`
    const res = await fetch(`${API}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'testpass123', claim_token: claimToken }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.claimed_profile_id ?? body.user?.claimed_profile_id).toBeTruthy()

    const verifyClaimRes = await fetch(`${API}/_test/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    if (!verifyClaimRes.ok) throw new Error(`Verify claimer failed: ${verifyClaimRes.status}`)
    const loginRes = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'testpass123' }),
    })
    const { token } = await loginRes.json()
    claimerToken = token
  })

  it('after claim: owner can GET /profiles/me and see the profile', async () => {
    const res = await fetch(`${API}/profiles/me`, { headers: auth(claimerToken) })
    expect(res.ok).toBe(true)
    const body = await res.json()
    expect(body.id).toBe(profileId)
    expect(body.display_name).toBe(prospectSeed.display_name)
  })

  it('after claim: profile visible at GET /profiles/{id} to owner', async () => {
    const res = await fetch(`${API}/profiles/${profileId}`, { headers: auth(claimerToken) })
    expect(res.ok).toBe(true)
  })

  // ── Race-safe double claim ──────────────────────────────────────────────────

  it('two concurrent claim attempts → exactly one 201, one 409', async () => {
    const prospectRes = await fetch(`${API}/admin/prospects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(adminToken) },
      body: JSON.stringify({ display_name: `Race Prospect ${SUFFIX}`, bio: '', images: [] }),
    })
    const { claim_token: raceToken } = await prospectRes.json()

    const email1 = `racer1-${SUFFIX}@prospect.test`
    const email2 = `racer2-${SUFFIX}@prospect.test`

    const [r1, r2] = await Promise.all([
      fetch(`${API}/auth/signup`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email1, password: 'testpass123', claim_token: raceToken }),
      }),
      fetch(`${API}/auth/signup`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email2, password: 'testpass123', claim_token: raceToken }),
      }),
    ])

    const statuses = [r1.status, r2.status].sort()
    expect(statuses).toEqual([201, 409])
  })

  it('re-claim already-claimed token → 409 with already_claimed', async () => {
    const email = `reclaimer-${SUFFIX}@prospect.test`
    const res = await fetch(`${API}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'testpass123', claim_token: claimToken }),
    })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('already_claimed')
  })

  // ── Partial index: two NULL-user prospects coexist ──────────────────────────

  it('two unclaimed prospects can coexist (partial index allows multiple NULLs)', async () => {
    const r1 = await fetch(`${API}/admin/prospects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(adminToken) },
      body: JSON.stringify({ display_name: `Coexist A ${SUFFIX}`, bio: '', images: [] }),
    })
    const r2 = await fetch(`${API}/admin/prospects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(adminToken) },
      body: JSON.stringify({ display_name: `Coexist B ${SUFFIX}`, bio: '', images: [] }),
    })
    expect(r1.status).toBe(201)
    expect(r2.status).toBe(201)
    const b1 = await r1.json()
    const b2 = await r2.json()
    expect(b1.profile_id).not.toBe(b2.profile_id)
  })
})
