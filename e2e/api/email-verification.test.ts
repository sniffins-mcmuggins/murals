import { describe, it, expect } from 'vitest'
import { uniqueSuffix } from '../fixtures/helpers.js'
import { extractVerificationURL } from '../fixtures/mailpit.js'

const API = process.env.API_URL ?? 'http://localhost:8080'

const suffix = uniqueSuffix()
const email = `verify-${suffix}@e2e.test`
const password = 'testpass123'

let verifyToken: string // extracted from email URL

describe('email verification flow', () => {
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
