// e2e/api/profile-preview.test.ts
// E15.2 — Shareable preview link (unguessable token)
// Covers: bad token → 404; valid token → 200 for draft profile; rotate → old 404 + new 200
import { describe, it, expect } from 'vitest'
import { createArtist, createProfile, uniqueSuffix } from '../fixtures/helpers.js'

const API = process.env.API_URL ?? 'http://localhost:8080'
const SUFFIX = uniqueSuffix()

function auth(token: string) {
  return { Authorization: `Bearer ${token}` }
}

async function getMyProfile(token: string) {
  const res = await fetch(`${API}/profiles/me`, { headers: auth(token) })
  return res.json() as Promise<{ preview_token: string; id: string; visibility: string }>
}

describe('E15.2 — profile preview token', () => {
  it('GET /profiles/preview/<bad-token> → 404', async () => {
    const res = await fetch(`${API}/profiles/preview/notavalidtokenXXXXXXXXXXX`)
    expect(res.status).toBe(404)
  })

  it('GET /profiles/me includes preview_token', async () => {
    const { token } = await createArtist(`${SUFFIX}-me-token`)
    await createProfile(token, { displayName: `PreviewArtist-${SUFFIX}` })
    const me = await getMyProfile(token)
    expect(typeof me.preview_token).toBe('string')
    expect(me.preview_token.length).toBeGreaterThan(20)
  })

  it('GET /profiles/preview/{token} returns draft profile without auth', async () => {
    const { token } = await createArtist(`${SUFFIX}-draft`)
    await createProfile(token, { displayName: `DraftPreview-${SUFFIX}` })
    const me = await getMyProfile(token)
    // profile is draft — direct GET should 404 for unauthed caller
    const directRes = await fetch(`${API}/profiles/${me.id}`)
    expect(directRes.status).toBe(404)
    // preview endpoint should 200
    const prevRes = await fetch(`${API}/profiles/preview/${me.preview_token}`)
    expect(prevRes.status).toBe(200)
    const prevBody = await prevRes.json()
    expect(prevBody.display_name).toBe(`DraftPreview-${SUFFIX}`)
    // preview_token must NOT appear in the public preview response
    expect(prevBody.preview_token).toBeUndefined()
  })

  it('POST /profiles/me/preview-token/rotate without token → 401', async () => {
    const res = await fetch(`${API}/profiles/me/preview-token/rotate`, { method: 'POST' })
    expect(res.status).toBe(401)
  })

  it('rotate invalidates old token and produces new one', async () => {
    const { token } = await createArtist(`${SUFFIX}-rotate`)
    await createProfile(token, { displayName: `RotateArtist-${SUFFIX}` })
    const before = await getMyProfile(token)
    const oldPreviewToken = before.preview_token

    // Rotate
    const rotRes = await fetch(`${API}/profiles/me/preview-token/rotate`, {
      method: 'POST',
      headers: auth(token),
    })
    expect(rotRes.status).toBe(200)
    const rotBody = await rotRes.json()
    const newPreviewToken = rotBody.preview_token as string
    expect(newPreviewToken).not.toBe(oldPreviewToken)

    // Old link → 404
    const oldRes = await fetch(`${API}/profiles/preview/${oldPreviewToken}`)
    expect(oldRes.status).toBe(404)

    // New link → 200
    const newRes = await fetch(`${API}/profiles/preview/${newPreviewToken}`)
    expect(newRes.status).toBe(200)
  })
})
