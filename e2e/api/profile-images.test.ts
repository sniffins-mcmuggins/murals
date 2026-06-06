// Profile media + sharing surfaces: headline/avatar images, the QR code, and the
// shareable preview token. (QR + preview were merged in from their own files —
// all three are small, profile-scoped, and share the createArtist/createProfile
// fixtures.)
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { createArtist, createProfile, uniqueSuffix } from '../fixtures/helpers'
import { forcePublish } from '../fixtures/db-helpers'

const API = process.env.API_URL ?? 'http://localhost:8080'
const DB_URL = process.env.DATABASE_URL ?? 'postgres://render:render@localhost:5432/render'
const auth = (token: string) => ({ Authorization: `Bearer ${token}` })
const json = (res: Response) => res.json()

// PNG magic number: \x89 P N G \r \n \x1a \n
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

async function getMyProfile(token: string) {
  const res = await fetch(`${API}/profiles/me`, { headers: auth(token) })
  return res.json() as Promise<{ preview_token: string; id: string; visibility: string }>
}

describe('profile images', () => {
  let db: Client

  beforeAll(async () => {
    db = new Client({ connectionString: DB_URL })
    await db.connect()
  })

  afterAll(async () => {
    await db.end()
  })

  it('PATCH /profiles/me without token → 401', async () => {
    const res = await fetch(`${API}/profiles/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ avatarS3Key: 'https://cdn.example.com/avatar.jpg' }),
    })
    expect(res.status).toBe(401)
  })

  it('profile response includes headline_image_urls array (empty by default)', async () => {
    const suffix = uniqueSuffix()
    const { token, userId } = await createArtist(suffix)
    const { profileId } = await createProfile(token, { displayName: `Image Artist ${suffix}` })
    // Bypass publish gate — this test is about image fields, not the publish gate.
    await forcePublish(db, userId)

    const res = await fetch(`${API}/profiles/${profileId}`)
    expect(res.status).toBe(200)
    const data = await json(res)
    expect(Array.isArray(data.headline_image_urls)).toBe(true)
    expect(data.headline_image_urls).toHaveLength(0)
  })

  it('set avatar and headline images via PATCH, appear on public profile', async () => {
    const suffix = uniqueSuffix() + 1
    const { token, userId } = await createArtist(suffix)
    const { profileId } = await createProfile(token, { displayName: `Hero Artist ${suffix}` })
    // Bypass publish gate — this test is about image fields, not the publish gate.
    await forcePublish(db, userId)

    const patchRes = await fetch(`${API}/profiles/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth(token) },
      body: JSON.stringify({
        avatarS3Key: 'https://cdn.example.com/avatar.jpg',
        headlineImageUrls: [
          'https://cdn.example.com/hero1.jpg',
          'https://cdn.example.com/hero2.jpg',
        ],
      }),
    })
    expect(patchRes.status).toBe(200)
    const updated = await json(patchRes)
    expect(updated.avatar_s3_key).toBe('https://cdn.example.com/avatar.jpg')
    expect(updated.headline_image_urls).toEqual([
      'https://cdn.example.com/hero1.jpg',
      'https://cdn.example.com/hero2.jpg',
    ])

    const publicRes = await fetch(`${API}/profiles/${profileId}`)
    const pub = await json(publicRes)
    expect(pub.avatar_s3_key).toBe('https://cdn.example.com/avatar.jpg')
    expect(pub.headline_image_urls).toEqual([
      'https://cdn.example.com/hero1.jpg',
      'https://cdn.example.com/hero2.jpg',
    ])
  })

  it('update headline images replaces the array', async () => {
    const suffix = uniqueSuffix() + 2
    const { token } = await createArtist(suffix)
    await createProfile(token, { displayName: `Replace Artist ${suffix}` })

    await fetch(`${API}/profiles/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth(token) },
      body: JSON.stringify({ headlineImageUrls: ['https://cdn.example.com/old.jpg'] }),
    })

    const res = await fetch(`${API}/profiles/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth(token) },
      body: JSON.stringify({
        headlineImageUrls: [
          'https://cdn.example.com/new1.jpg',
          'https://cdn.example.com/new2.jpg',
          'https://cdn.example.com/new3.jpg',
        ],
      }),
    })
    expect(res.status).toBe(200)
    const data = await json(res)
    expect(data.headline_image_urls).toHaveLength(3)
    expect(data.headline_image_urls[0]).toBe('https://cdn.example.com/new1.jpg')
  })

  it('PATCH without headlineImageUrls preserves existing images', async () => {
    const suffix = uniqueSuffix() + 3
    const { token } = await createArtist(suffix)
    await createProfile(token, { displayName: `Preserve Image Artist ${suffix}` })

    await fetch(`${API}/profiles/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth(token) },
      body: JSON.stringify({ headlineImageUrls: ['https://cdn.example.com/keep.jpg'] }),
    })

    const res = await fetch(`${API}/profiles/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth(token) },
      body: JSON.stringify({ bio: 'Updated bio only' }),
    })
    expect(res.status).toBe(200)
    const data = await json(res)
    expect(data.headline_image_urls).toContain('https://cdn.example.com/keep.jpg')
    expect(data.bio).toBe('Updated bio only')
  })
})

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

// E15.2 — Shareable preview link (unguessable token).
// Covers: bad token → 404; valid token → 200 for draft profile; rotate → old 404 + new 200.
describe('E15.2 — profile preview token', () => {
  const SUFFIX = uniqueSuffix()

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
