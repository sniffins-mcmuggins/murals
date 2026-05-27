// E2E tests for TOTP MFA (A9–A15 in the auth/billing test spec).
//
// Each test creates its own user (unique suffix prefix `mfa-`) so we can run
// alongside other agents writing tests to the same DB. The handlers under
// test are TOTPEnrollHandler, TOTPConfirmHandler, TOTPVerifyHandler in
// api/internal/auth/totp.go plus the scope guard in middleware.go.
import { describe, it, expect } from 'vitest'
import { Client } from 'pg'
import { createArtist } from '../fixtures/helpers.js'
import {
  enrollMFA,
  confirmMFA,
  verifyMFA,
  totpCode,
} from '../fixtures/auth-flows.js'

const API = process.env.API_URL ?? 'http://localhost:8080'
const DB_URL =
  process.env.DATABASE_URL ?? 'postgres://render:render@localhost:5432/render'

async function mfaEnabled(userId: string): Promise<boolean> {
  const client = new Client({ connectionString: DB_URL })
  await client.connect()
  try {
    const { rows } = await client.query<{ mfa_enabled: boolean }>(
      'SELECT mfa_enabled FROM users WHERE id = $1',
      [userId],
    )
    if (rows.length === 0) throw new Error(`user ${userId} not found`)
    return rows[0].mfa_enabled
  } finally {
    await client.end()
  }
}

// totpCode is deterministic against the system clock. If a confirm/verify call
// happens within ~1s of a 30s window boundary we can race the server and get a
// 401 from a code that was valid the instant we generated it but expired by the
// time the server validated it. Retry once with a slightly future timestamp.
async function codeWithRetry(
  secret: string,
  attempt: (code: string) => Promise<Response>,
): Promise<Response> {
  const first = await attempt(totpCode(secret))
  if (first.status !== 401) return first
  return attempt(totpCode(secret, new Date(Date.now() + 1500)))
}

describe('TOTP MFA flow', () => {
  it('A9 — enroll → confirm with valid code → mfa_enabled=true in DB', async () => {
    const artist = await createArtist(Date.now())
    expect(await mfaEnabled(artist.userId)).toBe(false)

    const { secret } = await enrollMFA(artist.token)
    expect(typeof secret).toBe('string')
    expect(secret.length).toBeGreaterThan(10)
    // Enrolment alone must NOT flip mfa_enabled — only confirm should.
    expect(await mfaEnabled(artist.userId)).toBe(false)

    const confirm = await codeWithRetry(secret, (code) =>
      confirmMFA(artist.token, code),
    )
    expect(confirm.status).toBe(200)
    expect(await mfaEnabled(artist.userId)).toBe(true)
  })

  it('A10 — confirm with wrong code → 401, mfa_enabled stays false', async () => {
    const artist = await createArtist(Date.now())
    await enrollMFA(artist.token)

    const confirm = await confirmMFA(artist.token, '000000')
    expect(confirm.status).toBe(401)
    expect(await mfaEnabled(artist.userId)).toBe(false)
  })

  it('A11 — login as MFA-enabled user → mfa_required + mfa_token; /me with mfa_token → 401 (scope guard)', async () => {
    const artist = await createArtist(Date.now())
    const { secret } = await enrollMFA(artist.token)
    const confirm = await codeWithRetry(secret, (code) =>
      confirmMFA(artist.token, code),
    )
    expect(confirm.status).toBe(200)

    const login = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: artist.email, password: artist.password }),
    })
    expect(login.status).toBe(200)
    const body = (await login.json()) as {
      mfa_required?: boolean
      mfa_token?: string
      token?: string
    }
    expect(body.mfa_required).toBe(true)
    expect(typeof body.mfa_token).toBe('string')
    expect(body.mfa_token!.length).toBeGreaterThan(0)
    // The MFA branch must NOT issue a session token.
    expect(body.token).toBeUndefined()

    // Canary: an mfa_pending JWT must NOT authorise any non-/auth/mfa/verify
    // endpoint. If this regresses, a stolen mfa_pending token is equivalent to
    // a full session.
    const me = await fetch(`${API}/me`, {
      headers: { Authorization: `Bearer ${body.mfa_token}` },
    })
    expect(
      me.status,
      'mfa_pending token must not authorise /me — scope guard regression',
    ).toBe(401)
  })

  it('A12 — verify with valid code → session token works on /me', async () => {
    const artist = await createArtist(Date.now())
    const { secret } = await enrollMFA(artist.token)
    const confirm = await codeWithRetry(secret, (code) =>
      confirmMFA(artist.token, code),
    )
    expect(confirm.status).toBe(200)

    const login = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: artist.email, password: artist.password }),
    })
    const { mfa_token } = (await login.json()) as { mfa_token: string }

    const verify = await codeWithRetry(secret, (code) =>
      verifyMFA(mfa_token, code),
    )
    expect(verify.status).toBe(200)
    const { token: sessionToken } = (await verify.json()) as { token: string }
    expect(typeof sessionToken).toBe('string')
    expect(sessionToken.length).toBeGreaterThan(0)

    const me = await fetch(`${API}/me`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    })
    expect(me.status).toBe(200)
    const meBody = (await me.json()) as { id: string; email: string }
    expect(meBody.id).toBe(artist.userId)
  })

  it('A13 — verify with invalid code → 401', async () => {
    const artist = await createArtist(Date.now())
    const { secret } = await enrollMFA(artist.token)
    const confirm = await codeWithRetry(secret, (code) =>
      confirmMFA(artist.token, code),
    )
    expect(confirm.status).toBe(200)

    const login = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: artist.email, password: artist.password }),
    })
    const { mfa_token } = (await login.json()) as { mfa_token: string }

    const verify = await verifyMFA(mfa_token, '000000')
    expect(verify.status).toBe(401)
  })

  it('A14 — re-enroll while MFA enabled: no current_code → 401; valid current_code → 200 with new secret', async () => {
    const artist = await createArtist(Date.now())
    const first = await enrollMFA(artist.token)
    const originalSecret = first.secret
    const confirm = await codeWithRetry(originalSecret, (code) =>
      confirmMFA(artist.token, code),
    )
    expect(confirm.status).toBe(200)

    // No current_code on an already-enabled account → 401.
    const bareRes = await fetch(`${API}/auth/mfa/enroll`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${artist.token}`,
      },
      body: '{}',
    })
    expect(bareRes.status).toBe(401)

    // With a valid current_code → 200 and a new secret different from the
    // original. Use the retry pattern in case we straddle a 30s boundary.
    let reenrol: Response
    let code = totpCode(originalSecret)
    reenrol = await fetch(`${API}/auth/mfa/enroll`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${artist.token}`,
      },
      body: JSON.stringify({ current_code: code }),
    })
    if (reenrol.status === 401) {
      code = totpCode(originalSecret, new Date(Date.now() + 1500))
      reenrol = await fetch(`${API}/auth/mfa/enroll`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${artist.token}`,
        },
        body: JSON.stringify({ current_code: code }),
      })
    }
    expect(reenrol.status).toBe(200)
    const { secret: newSecret } = (await reenrol.json()) as { secret: string }
    expect(typeof newSecret).toBe('string')
    expect(newSecret).not.toBe(originalSecret)
  })
})
