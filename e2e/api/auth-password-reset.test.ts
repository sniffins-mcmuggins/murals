// E2E tests for /auth/forgot-password and /auth/reset-password (issue #108, A1–A7).
// Uses the helper seam from PR #114 (e2e/fixtures/auth-flows.ts + reset-token.ts).
//
// Tests are written as independent `it` blocks — each one signs up its own user
// keyed by `pwreset-<ts>-<n>` to avoid collisions across parallel agents and reruns.
import { describe, it, expect } from 'vitest'
import { Client } from 'pg'
import { randomUUID } from 'node:crypto'
import {
  requestPasswordReset,
  resetPassword,
  injectResetToken,
  getLatestResetTokenHash,
} from '../fixtures/auth-flows.js'
import { createArtist } from '../fixtures/helpers.js'

const API = process.env.API_URL ?? 'http://localhost:8080'
const DB_URL =
  process.env.DATABASE_URL ?? 'postgres://render:render@localhost:5432/render'

// Unique per-process prefix so reruns and parallel agents never collide.
const SUFFIX = `pwreset-${Date.now()}`

async function pollFor<T>(
  fn: () => Promise<T | null>,
  timeoutMs = 1000,
  intervalMs = 50,
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const v = await fn()
    if (v !== null && v !== undefined) return v
    if (Date.now() >= deadline) return v
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}

async function countResetRowsForEmail(email: string): Promise<number> {
  const client = new Client({ connectionString: DB_URL })
  await client.connect()
  try {
    const { rows } = await client.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM password_reset_tokens t
       JOIN users u ON u.id = t.user_id WHERE u.email = $1`,
      [email.toLowerCase().trim()],
    )
    return parseInt(rows[0]?.n ?? '0', 10)
  } finally {
    await client.end()
  }
}

describe('auth: password reset (A1–A7)', () => {
  it('A1 — forgot-password for unknown email → 202 (no enumeration leak)', async () => {
    const res = await requestPasswordReset(`nobody-${SUFFIX}-a1@e2e.test`)
    expect(res.status).toBe(202)
  })

  it('A2 — forgot-password for known email → row in password_reset_tokens', async () => {
    const artist = await createArtist(`${SUFFIX}-a2`)
    const res = await requestPasswordReset(artist.email)
    expect(res.status).toBe(202)

    // ForgotPasswordHandler dispatches the DB write to a detached goroutine.
    // Poll for up to 1s.
    const hash = await pollFor(() => getLatestResetTokenHash(artist.email), 1000)
    expect(hash).not.toBeNull()
    expect(typeof hash).toBe('string')
    expect((hash as string).length).toBe(64) // SHA-256 hex
  })

  it('A3 — inject token → reset succeeds → new password works, old password 401', async () => {
    const artist = await createArtist(`${SUFFIX}-a3`)
    const newPassword = 'new-secret-pw-123'

    const rawToken = await injectResetToken(artist.email)
    const res = await resetPassword(rawToken, newPassword)
    expect(res.status).toBe(200)

    // New password works
    const loginNew = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: artist.email, password: newPassword }),
    })
    expect(loginNew.status).toBe(200)

    // Old password fails
    const loginOld = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: artist.email, password: artist.password }),
    })
    expect(loginOld.status).toBe(401)
  })

  it('A4 — reset token is single-use: second reset with same raw token → 400', async () => {
    const artist = await createArtist(`${SUFFIX}-a4`)
    const rawToken = await injectResetToken(artist.email)

    const first = await resetPassword(rawToken, 'first-new-pw-123')
    expect(first.status).toBe(200)

    const second = await resetPassword(rawToken, 'second-new-pw-123')
    expect(second.status).toBe(400)
  })

  it('A5 — session revocation: /me with old bearer token after reset → 401', async () => {
    const artist = await createArtist(`${SUFFIX}-a5`)
    const oldToken = artist.token

    // Sanity: old token works before reset
    const meBefore = await fetch(`${API}/me`, {
      headers: { Authorization: `Bearer ${oldToken}` },
    })
    expect(meBefore.status).toBe(200)

    const rawToken = await injectResetToken(artist.email)
    const reset = await resetPassword(rawToken, 'rotated-pw-12345')
    expect(reset.status).toBe(200)

    // ResetPasswordHandler bumps users.session_version. The middleware
    // checks claims.sv against the DB value, so the old JWT should now 401.
    const meAfter = await fetch(`${API}/me`, {
      headers: { Authorization: `Bearer ${oldToken}` },
    })
    expect(meAfter.status).toBe(401)
  })

  it('A6 — reset-password with password length <8 → 422', async () => {
    const artist = await createArtist(`${SUFFIX}-a6`)
    const rawToken = await injectResetToken(artist.email)

    const res = await resetPassword(rawToken, 'short')
    expect(res.status).toBe(422)
  })

  it('A7 — OAuth-only user: forgot-password → 202 but NO password_reset_tokens row', async () => {
    const email = `oauth-${SUFFIX}-a7@e2e.test`
    const client = new Client({ connectionString: DB_URL })
    await client.connect()
    try {
      // Seed an OAuth-only user — password_hash NULL.
      // oauth_subject must be unique within (provider, subject); use a uuid.
      await client.query(
        `INSERT INTO users (email, oauth_provider, oauth_subject)
         VALUES ($1, 'google', $2)`,
        [email, `e2e-${randomUUID()}`],
      )
    } finally {
      await client.end()
    }

    const res = await requestPasswordReset(email)
    expect(res.status).toBe(202)

    // The goroutine in forgotPasswordWork bails on user.PasswordHash == nil
    // BEFORE inserting. Poll for ~500ms to let any erroneous insert appear.
    const deadline = Date.now() + 500
    while (Date.now() < deadline) {
      const n = await countResetRowsForEmail(email)
      expect(n).toBe(0)
      await new Promise((r) => setTimeout(r, 75))
    }
  })
})
