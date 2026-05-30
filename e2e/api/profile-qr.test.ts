import { describe, it, expect } from 'vitest'
import { createArtist, createProfile } from '../fixtures/helpers'

const API = process.env.API_URL ?? 'http://localhost:8080'

const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

// PNG magic number: \x89 P N G \r \n \x1a \n
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

describe('profile QR code', () => {
  // Middleware-level auth probe — confirms the route is behind auth, per
  // .claude/rules/api-handler-checklist.md. The only test that catches a
  // dropped/missing auth gate on this route.
  it('GET /profiles/me/qr without token → 401', async () => {
    const res = await fetch(`${API}/profiles/me/qr`)
    expect(res.status).toBe(401)
  })

  it('GET /profiles/me/qr with token but no profile → 404', async () => {
    const suffix = Date.now()
    const { token } = await createArtist(suffix)

    const res = await fetch(`${API}/profiles/me/qr`, { headers: auth(token) })
    expect(res.status).toBe(404)
  })

  it('returns a branded PNG for an artist with a profile', async () => {
    const suffix = Date.now()
    const { token } = await createArtist(suffix)
    await createProfile(token, { displayName: `QR Artist ${suffix}` })

    const res = await fetch(`${API}/profiles/me/qr`, { headers: auth(token) })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')

    const bytes = new Uint8Array(await res.arrayBuffer())
    // Verify it's a real PNG (magic number) of non-trivial size.
    expect(Array.from(bytes.slice(0, 8))).toEqual(PNG_MAGIC)
    expect(bytes.length).toBeGreaterThan(1000)
  })
})
