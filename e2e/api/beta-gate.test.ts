// e2e/api/beta-gate.test.ts
//
// Tests for E16.1 beta gate.
// The /_test/beta/gated probe is always wired with BetaMode: true so we can
// verify gate behaviour without restarting the stack with BETA_MODE=true.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { createHmac } from 'node:crypto'

const API = process.env.API_URL ?? 'http://localhost:8080'
const DB_URL = process.env.DATABASE_URL ?? 'postgres://render:render@localhost:5432/render'
const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-jwt-secret-change-in-prod'
const SUFFIX = `beta-${Date.now()}`

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

async function seedUser(db: Client, email: string, opts: { isBeta?: boolean } = {}) {
  await fetch(`${API}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'testpass123' }),
  })
  if (opts.isBeta) {
    await db.query('UPDATE users SET is_beta = true WHERE email = $1', [email])
  }
  const { rows } = await db.query<{ id: string; session_version: number }>(
    'SELECT id, session_version FROM users WHERE email = $1',
    [email],
  )
  const { id, session_version: sv } = rows[0]
  const now = Math.floor(Date.now() / 1000)
  return signHS256({ sub: id, sv, iat: now, exp: now + 3600 }, JWT_SECRET)
}

describe('beta gate', () => {
  let db: Client

  beforeAll(async () => {
    db = new Client({ connectionString: DB_URL })
    await db.connect()
  })

  afterAll(async () => {
    await db.end()
  })

  // ── Wiring canary ────────────────────────────────────────────────────────
  it('GET /_test/beta/gated without token → 401', async () => {
    const res = await fetch(`${API}/_test/beta/gated`)
    expect(res.status).toBe(401)
  })

  it('GET /_test/beta/gated with non-beta user token → 403', async () => {
    const token = await seedUser(db, `nonbeta-${SUFFIX}@e2e.test`)
    const res = await fetch(`${API}/_test/beta/gated`, { headers: auth(token) })
    expect(res.status).toBe(403)
  })

  it('GET /_test/beta/gated with beta user token → 200', async () => {
    const token = await seedUser(db, `betauser-${SUFFIX}@e2e.test`, { isBeta: true })
    const res = await fetch(`${API}/_test/beta/gated`, { headers: auth(token) })
    expect(res.status).toBe(200)
  })

  // ── Public allowlist stays open ──────────────────────────────────────────
  it('GET /public/beta-status without token → 200 with beta_mode field', async () => {
    const res = await fetch(`${API}/public/beta-status`)
    expect(res.status).toBe(200)
    const body = await res.json() as { beta_mode: boolean }
    expect(typeof body.beta_mode).toBe('boolean')
  })

  it('GET /healthz without token → 200 (never gated)', async () => {
    const res = await fetch(`${API}/healthz`)
    expect(res.status).toBe(200)
  })

  // ── Waitlist ─────────────────────────────────────────────────────────────
  it('POST /waitlist with email → 204', async () => {
    const res = await fetch(`${API}/waitlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `waitlist-${SUFFIX}@e2e.test` }),
    })
    expect(res.status).toBe(204)
  })

  it('POST /waitlist same email twice → 204 (idempotent)', async () => {
    const email = `waitlist-idempotent-${SUFFIX}@e2e.test`
    for (let i = 0; i < 2; i++) {
      const res = await fetch(`${API}/waitlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      expect(res.status).toBe(204)
    }
  })

  // ── Schema canary ────────────────────────────────────────────────────────
  it('schema canary: is_beta + beta_cohort readable after direct seed', async () => {
    const email = `schema-canary-${SUFFIX}@e2e.test`
    await fetch(`${API}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'testpass123' }),
    })
    await db.query(
      `UPDATE users SET is_beta = true, beta_cohort = 'founding' WHERE email = $1`,
      [email],
    )

    const { rows } = await db.query<{ is_beta: boolean; beta_cohort: string | null }>(
      'SELECT is_beta, beta_cohort FROM users WHERE email = $1',
      [email],
    )
    expect(rows[0].is_beta).toBe(true)
    expect(rows[0].beta_cohort).toBe('founding')
  })
})
