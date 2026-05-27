const API = process.env.API_URL ?? 'http://localhost:8080'

// ─── Auth helpers ─────────────────────────────────────────────────────────────

export interface ArtistSetup {
  token: string
  userId: string
  email: string
  password: string
}

export async function createArtist(suffix = Date.now()): Promise<ArtistSetup> {
  const email = `artist-${suffix}@e2e.test`
  const password = 'testpass123'

  const signupRes = await fetch(`${API}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, role: 'artist' }),
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

export interface OrganiserSetup {
  token: string
  userId: string
  email: string
  password: string
}

export async function createOrganiser(suffix = Date.now()): Promise<OrganiserSetup> {
  const email = `organiser-${suffix}@e2e.test`
  const password = 'testpass123'

  const signupRes = await fetch(`${API}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, role: 'organiser' }),
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

  // 2. Rewrite internal Docker URL to host-accessible URL
  const hostUploadUrl = (uploadUrl as string).replace('http://minio:9000', 'http://localhost:9000')

  // 3. PUT to MinIO
  const putRes = await fetch(hostUploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/jpeg' },
    body: MINIMAL_JPEG,
  })
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
      fields: [{ type: 'text', label: 'Artist statement', required: true }],
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
    body: JSON.stringify({ answers: { 'Artist statement': 'Test statement for e2e' } }),
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
