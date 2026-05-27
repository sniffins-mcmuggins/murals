import { describe, it, expect } from 'vitest'

const API = process.env.API_URL ?? 'http://localhost:8080'

function auth(token: string) {
  return { Authorization: `Bearer ${token}` }
}

async function json(res: Response) {
  const text = await res.text()
  try { return JSON.parse(text) } catch { return text }
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

  it('1. artist signup + login', async () => {
    const signupRes = await fetch(`${API}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `artist-${suffix}@golden.test`, password: 'testpass123', role: 'artist' }),
    })
    expect(signupRes.status).toBe(201)

    const loginRes = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `artist-${suffix}@golden.test`, password: 'testpass123' }),
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

    // Rewrite internal Docker URL for host access
    const hostUrl = (uploadUrl as string).replace('http://minio:9000', 'http://localhost:9000')

    // PUT minimal JPEG to MinIO
    const minimalJpeg = Buffer.from(
      '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw' +
      '8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAARCAABAAED' +
      'ASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAA' +
      'AAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwD' +
      'AQACEQMRAD8AJQAB/9k=',
      'base64',
    )
    const putRes = await fetch(hostUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: minimalJpeg,
    })
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

  it('8. public collection GET shows image', async () => {
    const res = await fetch(`${API}/collections/${collectionId}/images`)
    expect(res.status).toBe(200)
    const images = await res.json()
    expect(Array.isArray(images)).toBe(true)
    expect(images.length).toBeGreaterThan(0)
    expect(images[0].s3_key).toBe(s3Key)
  })

  it('9. organiser signup + login', async () => {
    const signupRes = await fetch(`${API}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `organiser-${suffix}@golden.test`, password: 'testpass123', role: 'organiser' }),
    })
    expect(signupRes.status).toBe(201)

    const loginRes = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `organiser-${suffix}@golden.test`, password: 'testpass123' }),
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
      body: JSON.stringify({ fields: [{ type: 'text', label: 'Artist statement', required: true }] }),
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
      body: JSON.stringify({ answers: { 'Artist statement': 'I paint large-scale murals' } }),
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
    expect(apps[0].status).toBe('submitted')
  })

  it('15. organiser accepts application', async () => {
    const res = await fetch(
      `${API}/festivals/${festivalId}/applications/${applicationId}/accept`,
      { method: 'POST', headers: auth(organiserToken) },
    )
    expect(res.status).toBe(200)
    const data = await json(res)
    expect(data.status).toBe('accepted')
  })

  it('16. accepted artist appears in festival roster', async () => {
    const res = await fetch(`${API}/festivals/${festivalId}/artists/accepted`, {
      headers: auth(organiserToken),
    })
    expect(res.status).toBe(200)
    const artists = await res.json()
    expect(Array.isArray(artists)).toBe(true)
    expect(artists.length).toBe(1)
    artistId = artists[0].artist_id
    expect(typeof artistId).toBe('string')
  })

  it('17. organiser sets artist pin', async () => {
    const res = await fetch(`${API}/festivals/${festivalId}/artists/${artistId}/pin`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth(organiserToken) },
      body: JSON.stringify({ lat: 51.9, lng: -2.07, w3w: 'three.word.address' }),
    })
    expect(res.status).toBe(200)
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
    const pins = await res.json()
    expect(Array.isArray(pins)).toBe(true)
    expect(pins.length).toBeGreaterThan(0)
    expect(typeof pins[0].lat).toBe('number')
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

  it('21. public profile accessible (unauthenticated)', async () => {
    const res = await fetch(`${API}/profiles/${profileId}`)
    expect(res.status).toBe(200)
    const data = await json(res)
    expect(data.display_name).toBe('Golden Path Artist')
  })
})
