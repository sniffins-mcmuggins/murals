import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { createHmac } from 'node:crypto'
import { s3Put } from '../fixtures/helpers.js'

const API = process.env.API_URL ?? 'http://localhost:8080'
const DB_URL = process.env.DATABASE_URL ?? 'postgres://render:render@localhost:5432/render'
const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-jwt-secret-change-in-prod'

function auth(token: string) {
  return { Authorization: `Bearer ${token}` }
}

async function json(res: Response) {
  const text = await res.text()
  try { return JSON.parse(text) } catch { return text }
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

describe('golden path', () => {
  const suffix = Date.now()
  let artistToken: string
  let profileId: string
  let collectionId: string
  let s3Key: string
  let organiserToken: string
  let festivalId: string
  let festivalSlug: string
  let applicationId: string
  let artistId: string
  let db: Client
  let adminToken: string

  beforeAll(async () => {
    db = new Client({ connectionString: DB_URL })
    await db.connect()

    // Seed an admin user for the publish-gate grant in step 20.5
    const adminEmail = `admin-gp-${suffix}@golden.test`
    await fetch(`${API}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: adminEmail, password: 'adminpass123' }),
    })
    const { rows } = await db.query<{ id: string; session_version: number }>(
      `UPDATE users SET is_admin = true, mfa_enabled = true, mfa_secret = 'fake-totp'
       WHERE email = $1 RETURNING id, session_version`,
      [adminEmail],
    )
    const { id: adminUserId, session_version: sv } = rows[0]
    const now = Math.floor(Date.now() / 1000)
    adminToken = signHS256({ sub: adminUserId, is_admin: true, sv, iat: now, exp: now + 3600 }, JWT_SECRET)
  })

  afterAll(async () => {
    await db.end()
  })

  it('1. artist signup + login', async () => {
    const email = `artist-${suffix}@golden.test`
    const signupRes = await fetch(`${API}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'testpass123' }),
    })
    expect(signupRes.status).toBe(201)

    const verifyRes = await fetch(`${API}/_test/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    expect(verifyRes.status).toBe(200)

    const loginRes = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'testpass123' }),
    })
    expect(loginRes.status).toBe(200)
    const { token } = await loginRes.json()
    artistToken = token
    expect(typeof artistToken).toBe('string')
  })

  it('2. create artist profile', async () => {
    const res = await fetch(`${API}/profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(artistToken) },
      body: JSON.stringify({ displayName: 'Golden Path Artist' }),
    })
    expect(res.status).toBe(201)
    const data = await json(res)
    profileId = data.id
    expect(typeof profileId).toBe('string')
  })

  it('3. create collection', async () => {
    const res = await fetch(`${API}/collections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(artistToken) },
      body: JSON.stringify({ name: 'Murals 2027', description: 'Test collection' }),
    })
    expect(res.status).toBe(201)
    const data = await json(res)
    collectionId = data.id
    expect(typeof collectionId).toBe('string')
  })

  it('4–7. presign → PUT MinIO → confirm → attach image', async () => {
    // Presign
    const presignRes = await fetch(`${API}/images/presign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(artistToken) },
      body: JSON.stringify({ contentType: 'image/jpeg' }),
    })
    expect(presignRes.status).toBe(200)
    const { uploadUrl, s3Key: key } = await presignRes.json()
    s3Key = key

    // PUT minimal JPEG to MinIO
    const minimalJpeg = Buffer.from(
      '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw' +
      '8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAARCAABAAED' +
      'ASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAA' +
      'AAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwD' +
      'AQACEQMRAD8AJQAB/9k=',
      'base64',
    )
    const putRes = await s3Put(uploadUrl as string, minimalJpeg, 'image/jpeg')
    expect(putRes.ok).toBe(true)

    // Confirm
    const confirmRes = await fetch(`${API}/images/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(artistToken) },
      body: JSON.stringify({ s3Key }),
    })
    expect(confirmRes.status).toBe(200)
    const { cdnUrl } = await confirmRes.json()
    expect(typeof cdnUrl).toBe('string')

    // Attach to collection
    const attachRes = await fetch(`${API}/collections/${collectionId}/images`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(artistToken) },
      body: JSON.stringify({ s3Key, cdnUrl }),
    })
    expect(attachRes.status).toBe(201)
  })

  it('8. owner collection GET shows image (profile still draft — public needs publish first)', async () => {
    // E29: collection images on a draft profile return 404 for anonymous callers.
    // Owner reads are served from live tables so the owner can see unpublished work.
    const res = await fetch(`${API}/collections/${collectionId}/images`, {
      headers: { Authorization: `Bearer ${artistToken}` },
    })
    expect(res.status).toBe(200)
    const images = await res.json()
    expect(Array.isArray(images)).toBe(true)
    expect(images.length).toBeGreaterThan(0)
    expect(images[0].s3_key).toBe(s3Key)
  })

  it('9. organiser signup + login', async () => {
    const email = `organiser-${suffix}@golden.test`
    const signupRes = await fetch(`${API}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'testpass123' }),
    })
    expect(signupRes.status).toBe(201)

    const verifyRes = await fetch(`${API}/_test/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    expect(verifyRes.status).toBe(200)

    const loginRes = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'testpass123' }),
    })
    expect(loginRes.status).toBe(200)
    const { token } = await loginRes.json()
    organiserToken = token
  })

  it('10. create festival', async () => {
    const res = await fetch(`${API}/festivals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(organiserToken) },
      body: JSON.stringify({ name: 'Golden Path Fest', slug: `golden-${suffix}`, description: 'E2E festival' }),
    })
    expect(res.status).toBe(201)
    const data = await json(res)
    festivalId = data.id
    festivalSlug = data.slug
    expect(typeof festivalId).toBe('string')
  })

  it('11. upsert application form', async () => {
    const res = await fetch(`${API}/festivals/${festivalId}/form`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...auth(organiserToken) },
      body: JSON.stringify({ fields: [{ id: 'artist-statement', type: 'text', label: 'Artist statement', required: true }] }),
    })
    expect(res.status).toBe(200)
  })

  it('12. open festival', async () => {
    const res = await fetch(`${API}/festivals/${festivalId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth(organiserToken) },
      body: JSON.stringify({ status: 'open' }),
    })
    expect(res.status).toBe(200)
    const data = await json(res)
    expect(data.status).toBe('open')
  })

  it('13. artist submits application', async () => {
    const res = await fetch(`${API}/festivals/${festivalId}/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(artistToken) },
      body: JSON.stringify({ answers: { 'artist-statement': 'I paint large-scale murals' } }),
    })
    expect(res.status).toBe(201)
    const data = await json(res)
    applicationId = data.id
    expect(typeof applicationId).toBe('string')
  })

  it('14. organiser sees 1 pending application', async () => {
    const res = await fetch(`${API}/festivals/${festivalId}/applications`, {
      headers: auth(organiserToken),
    })
    expect(res.status).toBe(200)
    const apps = await res.json()
    expect(Array.isArray(apps)).toBe(true)
    expect(apps.length).toBe(1)
    expect(apps[0].decision).toBe('undecided')
    expect(apps[0].released_at).toBeNull()
  })

  it('15. organiser accepts application (decision + release)', async () => {
    const patch = await fetch(
      `${API}/festivals/${festivalId}/applications/${applicationId}`,
      {
        method: 'PATCH',
        headers: { ...auth(organiserToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ shortlisted: false, review_flag: false, decision: 'accept' }),
      },
    )
    expect(patch.status).toBe(200)
    expect((await json(patch)).decision).toBe('accept')

    const release = await fetch(
      `${API}/festivals/${festivalId}/applications/release-decisions`,
      { method: 'POST', headers: auth(organiserToken) },
    )
    expect(release.status).toBe(200)
  })

  it('16. accepted artist appears in festival roster (via spots endpoint)', async () => {
    const res = await fetch(`${API}/festivals/${festivalId}/spots`, {
      headers: auth(organiserToken),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.unassigned_artists)).toBe(true)
    expect(body.unassigned_artists.length).toBe(1)
    artistId = body.unassigned_artists[0].artist_id
    expect(typeof artistId).toBe('string')
  })

  it('17. organiser creates a spot and assigns the artist', async () => {
    // Create a spot
    const createRes = await fetch(`${API}/festivals/${festivalId}/spots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(organiserToken) },
      body: JSON.stringify({ lat: 51.9, lng: -2.07 }),
    })
    expect(createRes.status).toBe(201)
    const spot = await json(createRes)
    const spotId: string = spot.id
    expect(typeof spotId).toBe('string')

    // Assign the artist to the spot
    const assignRes = await fetch(`${API}/festivals/${festivalId}/spots/${spotId}/artist`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...auth(organiserToken) },
      body: JSON.stringify({ artist_id: artistId }),
    })
    expect(assignRes.status).toBe(200)
  })

  it('18. set festival to live', async () => {
    const res = await fetch(`${API}/festivals/${festivalId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth(organiserToken) },
      body: JSON.stringify({ status: 'live' }),
    })
    expect(res.status).toBe(200)
  })

  it('19. public map data returns pin (unauthenticated)', async () => {
    const res = await fetch(`${API}/festivals/slug/${festivalSlug}/map`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.pins)).toBe(true)
    expect(body.pins.length).toBeGreaterThan(0)
    expect(typeof body.pins[0].lat).toBe('number')
  })

  it('20. public festival list includes festival (unauthenticated)', async () => {
    const res = await fetch(`${API}/public/festivals?status=live`)
    expect(res.status).toBe(200)
    const festivals = await res.json()
    const found = (Array.isArray(festivals) ? festivals : []).find(
      (f: { slug: string }) => f.slug === festivalSlug,
    )
    expect(found).toBeDefined()
  })

  it('20.5. publish artist profile (set visibility to public)', async () => {
    // Grant the artist a comp access grant so the publish gate passes.
    // artistId is the profile ID; look up the user ID by email.
    const { rows: uRows } = await db.query<{ id: string }>(
      'SELECT id FROM users WHERE email = $1',
      [`artist-${suffix}@golden.test`],
    )
    const artistUserId = uRows[0].id
    const grantRes = await fetch(`${API}/admin/users/${artistUserId}/grants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(adminToken) },
      body: JSON.stringify({ plan: 'artist_basic', duration_days: 30, note: 'golden path e2e grant' }),
    })
    expect(grantRes.status).toBe(201)

    const res = await fetch(`${API}/profiles/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth(artistToken) },
      body: JSON.stringify({ visibility: 'public' }),
    })
    expect(res.status).toBe(200)
    expect((await json(res)).visibility).toBe('public')
  })

  it('21. public profile accessible (unauthenticated)', async () => {
    const res = await fetch(`${API}/profiles/${profileId}`)
    expect(res.status).toBe(200)
    const data = await json(res)
    expect(data.display_name).toBe('Golden Path Artist')
  })
})
