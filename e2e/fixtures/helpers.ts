import * as http from 'node:http'

const API = process.env.API_URL ?? 'http://localhost:8080'

// Generates a unique suffix safe to use in emails, slugs, and display names.
// Combines timestamp + random hex so parallel tests in the same millisecond
// don't collide, and re-runs against a live DB don't collide either.
export function uniqueSuffix(): string {
  return `${Date.now()}${Math.random().toString(36).slice(2, 7)}`
}

// node:http PUT — used for MinIO presigned URLs because fetch() treats Host as a
// forbidden header, preventing us from setting it explicitly. node:http lets us
// control all headers. Host is derived from the URL so it matches the HMAC signature.
export async function s3Put(url: string, body: Buffer, contentType: string): Promise<{ ok: boolean; status: number }> {
  return new Promise((resolve) => {
    const { hostname, port, pathname, search } = new URL(url)
    const hostHeader = port ? `${hostname}:${port}` : hostname
    const req = http.request(
      {
        hostname,
        port: port ? parseInt(port, 10) : 80,
        path: pathname + search,
        method: 'PUT',
        headers: { 'content-type': contentType, 'host': hostHeader, 'content-length': body.length },
      },
      (res) => { resolve({ ok: (res.statusCode ?? 0) < 300, status: res.statusCode ?? 0 }); res.resume() },
    )
    req.on('error', () => resolve({ ok: false, status: 0 }))
    req.write(body)
    req.end()
  })
}

// ─── Auth helpers ─────────────────────────────────────────────────────────────

export interface UserSetup {
  token: string
  userId: string
  email: string
  password: string
}

export async function createUser(
  prefix = 'user',
  suffix: string | number = uniqueSuffix(),
): Promise<UserSetup> {
  const email = `${prefix}-${suffix}@e2e.test`
  const password = 'testpass123'

  const signupRes = await fetch(`${API}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!signupRes.ok) throw new Error(`Signup failed: ${signupRes.status}`)

  const loginRes = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!loginRes.ok) throw new Error(`Login failed: ${loginRes.status}`)
  const { token, user } = await loginRes.json()

  return { token, userId: user.id, email, password }
}

// Back-compat aliases. Roles are derived from owning an artist_profile /
// festival now, not set at signup — but keeping the named helpers preserves
// readability in existing specs ("createArtist" still signals intent).
export type ArtistSetup = UserSetup
export type OrganiserSetup = UserSetup
export const createArtist = (suffix?: string | number) => createUser('artist', suffix)
export const createOrganiser = (suffix?: string | number) => createUser('organiser', suffix)

// ─── Artist profile helpers ────────────────────────────────────────────────────

export async function createProfile(
  token: string,
  opts: { displayName: string; bio?: string },
): Promise<{ profileId: string }> {
  const res = await fetch(`${API}/profiles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ displayName: opts.displayName }),
  })
  if (!res.ok) throw new Error(`Create profile failed: ${res.status}`)
  if (opts.bio) {
    const patchRes = await fetch(`${API}/profiles/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ bio: opts.bio }),
    })
    if (!patchRes.ok) throw new Error(`Update bio failed: ${patchRes.status}`)
  }
  const data = await res.json()
  return { profileId: data.id }
}

export async function publishProfile(token: string): Promise<void> {
  const res = await fetch(`${API}/profiles/me`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ visibility: 'public' }),
  })
  if (!res.ok) throw new Error(`Publish profile failed: ${res.status}`)
}

export async function createCollection(
  token: string,
  opts: { name: string; description?: string },
): Promise<{ collectionId: string }> {
  const res = await fetch(`${API}/collections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: opts.name, description: opts.description ?? '' }),
  })
  if (!res.ok) throw new Error(`Create collection failed: ${res.status}`)
  const data = await res.json()
  return { collectionId: data.id }
}

// ─── Image upload helper ───────────────────────────────────────────────────────

// Minimal 1×1 white JPEG (valid JPEG data)
const MINIMAL_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw' +
  '8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAARCAABAAED' +
  'ASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAA' +
  'AAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwD' +
  'AQACEQMRAD8AJQAB/9k=',
  'base64',
)

export async function uploadImage(
  token: string,
  collectionId: string,
): Promise<{ imageId: string; cdnUrl: string; s3Key: string }> {
  // 1. Presign
  const presignRes = await fetch(`${API}/images/presign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ contentType: 'image/jpeg' }),
  })
  if (!presignRes.ok) throw new Error(`Presign failed: ${presignRes.status}`)
  const { uploadUrl, s3Key } = await presignRes.json()

  // 3. PUT to MinIO — uses node:http so we can control the Host header
  const putRes = await s3Put(uploadUrl as string, MINIMAL_JPEG, 'image/jpeg')
  if (!putRes.ok) throw new Error(`MinIO PUT failed: ${putRes.status}`)

  // 4. Confirm
  const confirmRes = await fetch(`${API}/images/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ s3Key }),
  })
  if (!confirmRes.ok) throw new Error(`Confirm failed: ${confirmRes.status}`)
  const { cdnUrl } = await confirmRes.json()

  // 5. Attach to collection
  const attachRes = await fetch(`${API}/collections/${collectionId}/images`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ s3Key, cdnUrl }),
  })
  if (!attachRes.ok) throw new Error(`Attach image failed: ${attachRes.status}`)
  const imageData = await attachRes.json()

  // 6. Set as collection cover so it appears on the public artist page
  const coverRes = await fetch(`${API}/collections/${collectionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ coverS3Key: s3Key }),
  })
  if (!coverRes.ok) throw new Error(`Set collection cover failed: ${coverRes.status}`)

  return { imageId: imageData.id, cdnUrl, s3Key }
}

// ─── Festival helpers ─────────────────────────────────────────────────────────

export async function createFestival(
  token: string,
  opts: { name: string; slug: string; description?: string },
): Promise<{ festivalId: string; slug: string }> {
  const res = await fetch(`${API}/festivals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name: opts.name,
      slug: opts.slug,
      description: opts.description ?? '',
    }),
  })
  if (!res.ok) throw new Error(`Create festival failed: ${res.status}`)
  const data = await res.json()
  return { festivalId: data.id, slug: data.slug }
}

export async function setFestivalStatus(
  token: string,
  festivalId: string,
  status: 'draft' | 'open' | 'live' | 'archived',
): Promise<void> {
  const res = await fetch(`${API}/festivals/${festivalId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ status }),
  })
  if (!res.ok) throw new Error(`Set festival status failed: ${res.status}`)
}

export async function upsertForm(token: string, festivalId: string): Promise<void> {
  const res = await fetch(`${API}/festivals/${festivalId}/form`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      fields: [{ id: 'artist-statement', type: 'text', label: 'Artist statement', required: true }],
    }),
  })
  if (!res.ok) throw new Error(`Upsert form failed: ${res.status}`)
}

// ─── Application helpers ──────────────────────────────────────────────────────

export async function submitApplication(
  token: string,
  festivalId: string,
): Promise<{ applicationId: string }> {
  const res = await fetch(`${API}/festivals/${festivalId}/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ answers: { 'artist-statement': 'Test statement for e2e' } }),
  })
  if (!res.ok) throw new Error(`Submit application failed: ${res.status}`)
  const data = await res.json()
  return { applicationId: data.id }
}

export async function acceptArtist(
  token: string,
  festivalId: string,
  applicationId: string,
): Promise<void> {
  const res = await fetch(
    `${API}/festivals/${festivalId}/applications/${applicationId}/accept`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    },
  )
  if (!res.ok) throw new Error(`Accept artist failed: ${res.status}`)
}

export async function setPin(
  token: string,
  festivalId: string,
  artistId: string,
  lat: number,
  lng: number,
): Promise<void> {
  const res = await fetch(`${API}/festivals/${festivalId}/artists/${artistId}/pin`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ lat, lng, w3w: 'three.word.address' }),
  })
  if (!res.ok) throw new Error(`Set pin failed: ${res.status}`)
}

export async function createSpot(
  token: string,
  festivalId: string,
  lat: number,
  lng: number,
): Promise<{ spotId: string }> {
  const res = await fetch(`${API}/festivals/${festivalId}/spots`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ lat, lng }),
  })
  if (!res.ok) throw new Error(`createSpot failed: ${res.status} ${await res.text()}`)
  const data = (await res.json()) as { id: string }
  return { spotId: data.id }
}

export async function assignArtistToSpot(
  token: string,
  festivalId: string,
  spotId: string,
  artistId: string,
): Promise<void> {
  const res = await fetch(`${API}/festivals/${festivalId}/spots/${spotId}/artist`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ artist_id: artistId }),
  })
  if (!res.ok) throw new Error(`assignArtistToSpot failed: ${res.status} ${await res.text()}`)
}
