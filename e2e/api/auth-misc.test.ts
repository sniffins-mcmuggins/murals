// Auth edge cases + email-verification flow (merged).
//
// Two small, independent auth-domain suites combined into one file to drop a
// Vitest worker startup:
//   - auth edge cases: duplicate signup → 409, expired/forged JWT → 401.
//   - email verification flow: the full signup → verify → login lifecycle.
//
// The expired-token test signs an HS256 JWT with the dev secret directly so we
// don't have to wait for the real 7-day TTL. JWT_SECRET defaults to
// `dev-jwt-secret-change-in-prod` in `api/internal/config/config.go` and the
// docker-compose stack.
import { describe, it, expect } from 'vitest'
import { createHmac, randomUUID } from 'node:crypto'
import { createArtist, uniqueSuffix } from '../fixtures/helpers.js'
import { extractVerificationURL } from '../fixtures/mailpit.js'

const API = process.env.API_URL ?? 'http://localhost:8080'
const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-jwt-secret-change-in-prod'

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
  const SUFFIX = `gaps-auth-${Date.now()}`

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

describe('email verification flow', () => {
  const suffix = uniqueSuffix()
  const email = `verify-${suffix}@e2e.test`
  const password = 'testpass123'
  let verifyToken: string // extracted from email URL

  it('1. signup returns 201 with email_verified: false and no token', async () => {
    const res = await fetch(`${API}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.user.email_verified).toBe(false)
    expect(body.token).toBeUndefined()
  })

  it('2. login before verification returns 403 email_not_verified', async () => {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe('email_not_verified')
  })

  it('3. Mailpit has the verification email', async () => {
    const url = await extractVerificationURL(email)
    expect(url).toContain('/verify-email?token=')
    // Extract raw token for subsequent tests
    verifyToken = new URL(url).searchParams.get('token') ?? ''
    expect(verifyToken).not.toBe('')
  })

  it('4. valid token returns 200 with JWT', async () => {
    const res = await fetch(`${API}/auth/verify-email?token=${verifyToken}`, {
      credentials: 'include',
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(typeof body.token).toBe('string')
    expect(body.token.length).toBeGreaterThan(20)
  })

  it('5. token is single-use — second use returns 400', async () => {
    const res = await fetch(`${API}/auth/verify-email?token=${verifyToken}`)
    expect(res.status).toBe(400)
  })

  it('6. garbage token returns 400', async () => {
    const res = await fetch(`${API}/auth/verify-email?token=notavalidtokenhex`)
    expect(res.status).toBe(400)
  })

  it('7. resend-verification with known email returns 202', async () => {
    // Create a fresh unverified account for this test so the resend has an unverified user
    const s = uniqueSuffix()
    const freshEmail = `resend-${s}@e2e.test`
    await fetch(`${API}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: freshEmail, password }),
    })
    const res = await fetch(`${API}/auth/resend-verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: freshEmail }),
    })
    expect(res.status).toBe(202)
  })

  it('8. resend-verification with unknown email returns 202 (timing-safe)', async () => {
    const res = await fetch(`${API}/auth/resend-verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@example.com' }),
    })
    expect(res.status).toBe(202)
  })

  it('9. login after verification succeeds', async () => {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(typeof body.token).toBe('string')
  })
})
