// e2e/api/beta-portal.test.ts
//
// Tests for E16.2 (invite issuance + quota) and E16.3 (feedback inbox).
// The admin routes require RequireAdmin; member routes require beta.Gate
// (via the outer authenticated group, always active regardless of BETA_MODE).

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { createHmac } from 'node:crypto'

const API = process.env.API_URL ?? 'http://localhost:8080'
const DB_URL = process.env.DATABASE_URL ?? 'postgres://render:render@localhost:5432/render'
const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-jwt-secret-change-in-prod'
const SUFFIX = `portal-${Date.now()}`

function auth(t: string) {
  return { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }
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

async function seedBetaUser(db: Client, email: string): Promise<string> {
  await fetch(`${API}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'testpass123' }),
  })
  await db.query('UPDATE users SET is_beta = true WHERE email = $1', [email])
  const { rows } = await db.query<{ id: string; session_version: number }>(
    'SELECT id, session_version FROM users WHERE email = $1', [email],
  )
  const { id, session_version: sv } = rows[0]
  const now = Math.floor(Date.now() / 1000)
  return signHS256({ sub: id, sv, iat: now, exp: now + 3600 }, JWT_SECRET)
}

async function seedAdminUser(db: Client, email: string): Promise<string> {
  await fetch(`${API}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'testpass123' }),
  })
  await db.query('UPDATE users SET is_admin = true, mfa_enabled = true WHERE email = $1', [email])
  const { rows } = await db.query<{ id: string; session_version: number }>(
    'SELECT id, session_version FROM users WHERE email = $1', [email],
  )
  const { id, session_version: sv } = rows[0]
  const now = Math.floor(Date.now() / 1000)
  return signHS256({ sub: id, sv, is_admin: true, iat: now, exp: now + 3600 }, JWT_SECRET)
}

describe('E16.2 — invite issuance + quota', () => {
  let db: Client
  let adminToken: string
  let memberToken: string
  let memberToken2: string

  beforeAll(async () => {
    db = new Client({ connectionString: DB_URL })
    await db.connect()
    adminToken = await seedAdminUser(db, `admin-${SUFFIX}@e2e.test`)
    memberToken = await seedBetaUser(db, `member-${SUFFIX}@e2e.test`)
    memberToken2 = await seedBetaUser(db, `member2-${SUFFIX}@e2e.test`)
  })

  afterAll(async () => { await db.end() })

  it('GET /admin/beta/invites without token → 401', async () => {
    const res = await fetch(`${API}/admin/beta/invites`)
    expect(res.status).toBe(401)
  })

  it('POST /admin/beta/invites → 201 with code + link', async () => {
    const res = await fetch(`${API}/admin/beta/invites`, {
      method: 'POST',
      headers: auth(adminToken),
      body: JSON.stringify({ cohort: 'founding', max_uses: 5 }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as { code: string; link: string; max_uses: number }
    expect(body.code).toBeTruthy()
    expect(body.link).toContain('/signup?invite=')
    expect(body.link).toContain(body.code)
    expect(body.max_uses).toBe(5)
  })

  it('GET /admin/beta/invites returns list', async () => {
    const res = await fetch(`${API}/admin/beta/invites`, {
      headers: auth(adminToken),
    })
    expect(res.status).toBe(200)
    const list = await res.json() as unknown[]
    expect(Array.isArray(list)).toBe(true)
    expect(list.length).toBeGreaterThanOrEqual(1)
  })

  it('POST /beta/invites — member mints invite → 201', async () => {
    const res = await fetch(`${API}/beta/invites`, {
      method: 'POST',
      headers: auth(memberToken),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as { code: string; link: string }
    expect(body.code).toBeTruthy()
    expect(body.link).toContain(body.code)
  })

  it('POST /beta/invites — 4th mint past quota of 3 → 403', async () => {
    // Mint invites until quota is reached; memberToken may already have 1 above.
    // Reset by using a fresh beta user for this test.
    const email = `quota-${SUFFIX}@e2e.test`
    const token = await seedBetaUser(db, email)

    for (let i = 0; i < 3; i++) {
      const res = await fetch(`${API}/beta/invites`, {
        method: 'POST',
        headers: auth(token),
      })
      expect(res.status).toBe(201)
    }

    const fourth = await fetch(`${API}/beta/invites`, {
      method: 'POST',
      headers: auth(token),
    })
    expect(fourth.status).toBe(403)
  })

  it('GET /beta/me/invites returns own invites with quota', async () => {
    // memberToken2 has not minted any invites yet.
    await fetch(`${API}/beta/invites`, { method: 'POST', headers: auth(memberToken2) })

    const res = await fetch(`${API}/beta/me/invites`, {
      headers: auth(memberToken2),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { invites: unknown[]; remaining_quota: number }
    expect(body.invites.length).toBeGreaterThanOrEqual(1)
    expect(body.remaining_quota).toBeLessThan(3)
  })

  it('GET /beta/me/invites isolation — memberToken cannot see memberToken2 invites', async () => {
    // memberToken mints an invite.
    await fetch(`${API}/beta/invites`, { method: 'POST', headers: auth(memberToken) })

    // Fresh third member: should see only their own (zero) invites.
    const email3 = `member3-${SUFFIX}@e2e.test`
    const token3 = await seedBetaUser(db, email3)

    const res = await fetch(`${API}/beta/me/invites`, { headers: auth(token3) })
    expect(res.status).toBe(200)
    const body = await res.json() as { invites: unknown[] }
    expect(body.invites).toHaveLength(0)
  })

  it('redemption race — two concurrent signups with single-use code → exactly one wins', async () => {
    const raceCode = `RACE-${SUFFIX}`
    await db.query(
      `INSERT INTO beta_invites (code, max_uses, cohort, created_by)
       SELECT $1, 1, 'founding', id FROM users WHERE email = $2`,
      [raceCode, `admin-${SUFFIX}@e2e.test`],
    )

    const [r1, r2] = await Promise.all([
      fetch(`${API}/_test/beta/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: `race1-${SUFFIX}@e2e.test`, password: 'testpass123', invite_code: raceCode }),
      }),
      fetch(`${API}/_test/beta/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: `race2-${SUFFIX}@e2e.test`, password: 'testpass123', invite_code: raceCode }),
      }),
    ])

    const statuses = [r1.status, r2.status].sort()
    expect(statuses[0]).toBe(201) // one succeeds
    expect(statuses[1]).toBeGreaterThanOrEqual(400) // one fails (403 or 409)
  })
})

describe('E16.3 — feedback inbox', () => {
  let db: Client
  let adminToken: string
  let memberAToken: string
  let memberBToken: string

  beforeAll(async () => {
    db = new Client({ connectionString: DB_URL })
    await db.connect()
    adminToken = await seedAdminUser(db, `fbadmin-${SUFFIX}@e2e.test`)
    memberAToken = await seedBetaUser(db, `fba-${SUFFIX}@e2e.test`)
    memberBToken = await seedBetaUser(db, `fbb-${SUFFIX}@e2e.test`)
  })

  afterAll(async () => { await db.end() })

  it('POST /beta/feedback without token → 401', async () => {
    const res = await fetch(`${API}/beta/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'idea', body: 'anon test' }),
    })
    expect(res.status).toBe(401)
  })

  it('POST /beta/feedback → 201 with id + kind + body', async () => {
    const res = await fetch(`${API}/beta/feedback`, {
      method: 'POST',
      headers: auth(memberAToken),
      body: JSON.stringify({ kind: 'idea', body: 'First idea from e2e' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as { id: string; kind: string; body: string }
    expect(body.id).toBeTruthy()
    expect(body.kind).toBe('idea')
    expect(body.body).toBe('First idea from e2e')
  })

  it('POST /beta/feedback with invalid kind → 422', async () => {
    const res = await fetch(`${API}/beta/feedback`, {
      method: 'POST',
      headers: auth(memberAToken),
      body: JSON.stringify({ kind: 'spam', body: 'nope' }),
    })
    expect(res.status).toBe(422)
  })

  it('GET /beta/feedback IDOR — member B cannot see member A feedback', async () => {
    // Member A already submitted above; member B's list should be empty.
    const res = await fetch(`${API}/beta/feedback`, {
      headers: auth(memberBToken),
    })
    expect(res.status).toBe(200)
    const list = await res.json() as unknown[]
    expect(list).toHaveLength(0)
  })

  it('GET /admin/beta/feedback returns all feedback', async () => {
    // Submit from B so there are at least 2 entries total.
    await fetch(`${API}/beta/feedback`, {
      method: 'POST',
      headers: auth(memberBToken),
      body: JSON.stringify({ kind: 'bug', body: 'Bug from B' }),
    })

    const res = await fetch(`${API}/admin/beta/feedback`, {
      headers: auth(adminToken),
    })
    expect(res.status).toBe(200)
    const list = await res.json() as unknown[]
    expect(list.length).toBeGreaterThanOrEqual(2)
  })

  it('PATCH /admin/beta/feedback/{id} adds admin note', async () => {
    // Submit a feedback item.
    const submitRes = await fetch(`${API}/beta/feedback`, {
      method: 'POST',
      headers: auth(memberAToken),
      body: JSON.stringify({ kind: 'direction', body: 'Should we add maps?' }),
    })
    expect(submitRes.status).toBe(201)
    const { id } = await submitRes.json() as { id: string }

    const patchRes = await fetch(`${API}/admin/beta/feedback/${id}`, {
      method: 'PATCH',
      headers: auth(adminToken),
      body: JSON.stringify({ admin_note: 'Tracking in E17' }),
    })
    expect(patchRes.status).toBe(200)
    const updated = await patchRes.json() as { admin_note: string }
    expect(updated.admin_note).toBe('Tracking in E17')
  })
})
