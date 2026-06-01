// e2e/api/beta-invite-signup.test.ts
//
// Tests the invite-gated signup path (signupBeta) via the /_test/beta/signup probe,
// which always runs SignupHandler with BetaMode=true. This avoids restarting the
// stack with BETA_MODE=true while giving full integration coverage of the path.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'

const API = process.env.API_URL ?? 'http://localhost:8080'
const DB_URL = process.env.DATABASE_URL ?? 'postgres://render:render@localhost:5432/render'
const SUFFIX = `betainv-${Date.now()}`

describe('beta invite-gated signup (/_test/beta/signup)', () => {
  let db: Client
  let creatorId: string

  beforeAll(async () => {
    db = new Client({ connectionString: DB_URL })
    await db.connect()

    // Seed a user to act as invite creator (required by beta_invites.created_by FK).
    const creatorEmail = `creator-${SUFFIX}@e2e.test`
    await fetch(`${API}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: creatorEmail, password: 'testpass123' }),
    })
    const { rows } = await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [creatorEmail])
    creatorId = rows[0].id
  })

  afterAll(async () => {
    await db.end()
  })

  it('POST /_test/beta/signup without invite_code → 403', async () => {
    const res = await fetch(`${API}/_test/beta/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `no-code-${SUFFIX}@e2e.test`, password: 'testpass123' }),
    })
    expect(res.status).toBe(403)
  })

  it('POST /_test/beta/signup with non-existent invite code → 403', async () => {
    const res = await fetch(`${API}/_test/beta/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `bad-code-${SUFFIX}@e2e.test`, password: 'testpass123', invite_code: 'DOES-NOT-EXIST' }),
    })
    expect(res.status).toBe(403)
  })

  it('POST /_test/beta/signup with valid invite code → 201, user has is_beta=true', async () => {
    const code = `VALID-${SUFFIX}`
    await db.query(
      `INSERT INTO beta_invites (code, max_uses, cohort, created_by) VALUES ($1, 1, 'founding', $2)`,
      [code, creatorId],
    )

    const email = `beta-valid-${SUFFIX}@e2e.test`
    const res = await fetch(`${API}/_test/beta/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'testpass123', invite_code: code }),
    })
    expect(res.status).toBe(201)

    const { rows } = await db.query<{ is_beta: boolean; beta_cohort: string }>(
      'SELECT is_beta, beta_cohort FROM users WHERE email = $1',
      [email],
    )
    expect(rows[0].is_beta).toBe(true)
    expect(rows[0].beta_cohort).toBe('founding')
  })

  it('second use of a single-quota invite code → 403 (quota exhausted)', async () => {
    const code = `EXHAUST-${SUFFIX}`
    await db.query(
      `INSERT INTO beta_invites (code, max_uses, cohort, created_by) VALUES ($1, 1, 'founding', $2)`,
      [code, creatorId],
    )

    // First use succeeds.
    const first = await fetch(`${API}/_test/beta/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `exhaust1-${SUFFIX}@e2e.test`, password: 'testpass123', invite_code: code }),
    })
    expect(first.status).toBe(201)

    // Second use fails — quota exhausted.
    const second = await fetch(`${API}/_test/beta/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `exhaust2-${SUFFIX}@e2e.test`, password: 'testpass123', invite_code: code }),
    })
    expect(second.status).toBe(403)
  })
})
