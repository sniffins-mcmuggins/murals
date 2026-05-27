// Auth edge cases (issue #113).
//
// - Idempotent signup: duplicate email returns 409 (not 500).
// - Expired JWT: tokens whose `exp` is in the past → 401. Complement to A5
//   (session_version revocation).
//
// The expired-token test signs an HS256 JWT with the dev secret directly so we
// don't have to wait for the real 7-day TTL. JWT_SECRET defaults to
// `dev-jwt-secret-change-in-prod` in `api/internal/config/config.go` and the
// docker-compose stack.
import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import { randomUUID } from 'node:crypto'
import { createArtist } from '../fixtures/helpers.js'

const API = process.env.API_URL ?? 'http://localhost:8080'
const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-jwt-secret-change-in-prod'
const SUFFIX = `gaps-auth-${Date.now()}`

function base64url(buf: Buffer | string): string {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

// signHS256 builds a JWT matching api/internal/auth/jwt.go's IssueToken format:
// HS256, payload includes sub, role, sv (session_version), iat, exp.
function signHS256(payload: Record<string, unknown>, secret: string): string {
  const header = { alg: 'HS256', typ: 'JWT' }
  const headerB64 = base64url(JSON.stringify(header))
  const payloadB64 = base64url(JSON.stringify(payload))
  const signingInput = `${headerB64}.${payloadB64}`
  const signature = base64url(
    createHmac('sha256', secret).update(signingInput).digest(),
  )
  return `${signingInput}.${signature}`
}

describe('auth edge cases', () => {
  it('duplicate signup returns 409 (no 500)', async () => {
    const email = `dup-${SUFFIX}@e2e.test`
    const password = 'testpass123'

    const first = await fetch(`${API}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, role: 'artist' }),
    })
    expect(first.status).toBe(201)

    const second = await fetch(`${API}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, role: 'artist' }),
    })
    expect(second.status).toBe(409)
  })

  it('expired JWT → 401 on a protected endpoint', async () => {
    // Real user so userID resolves — but the middleware should reject before
    // any DB lookup runs, since the token signature/exp are checked first.
    const artist = await createArtist(`${SUFFIX}-expjwt`)

    const now = Math.floor(Date.now() / 1000)
    const expiredToken = signHS256(
      {
        sub: artist.userId,
        role: 'artist',
        sv: 0,
        iat: now - 7200,
        exp: now - 3600, // expired one hour ago
      },
      JWT_SECRET,
    )

    const res = await fetch(`${API}/me`, {
      headers: { Authorization: `Bearer ${expiredToken}` },
    })
    expect(res.status).toBe(401)
  })

  it('forged JWT for a nonexistent user → 401', async () => {
    // Sanity: a well-formed but expired/bogus token must not auth.
    const now = Math.floor(Date.now() / 1000)
    const bogusToken = signHS256(
      {
        sub: randomUUID(),
        role: 'artist',
        sv: 0,
        iat: now - 60,
        exp: now - 30,
      },
      JWT_SECRET,
    )

    const res = await fetch(`${API}/me`, {
      headers: { Authorization: `Bearer ${bogusToken}` },
    })
    expect(res.status).toBe(401)
  })
})
