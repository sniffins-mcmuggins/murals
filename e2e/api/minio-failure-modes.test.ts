// MinIO upload failure modes (issue #113).
//
// (a) PUT with a content type that doesn't match the presigned signature → fails.
// (b) /images/confirm with a key that wasn't uploaded → 404.
// (c) Anonymous GET of a confirmed image succeeds (bucket policy:
//     `mc anonymous set download` — see infra/docker-compose.yml minio-init).
import { describe, it, expect } from 'vitest'
import { createArtist, s3Put } from '../fixtures/helpers.js'

const API = process.env.API_URL ?? 'http://localhost:8080'
const SUFFIX = `gaps-minio-${Date.now()}`

function auth(token: string) {
  return { Authorization: `Bearer ${token}` }
}

// Minimal 1×1 white JPEG (valid bytes, ~150 bytes).
const MINIMAL_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw' +
    '8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAARCAABAAED' +
    'ASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAA' +
    'AAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwD' +
    'AQACEQMRAD8AJQAB/9k=',
  'base64',
)

async function presign(token: string, contentType = 'image/jpeg'): Promise<{ uploadUrl: string; s3Key: string }> {
  const res = await fetch(`${API}/images/presign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth(token) },
    body: JSON.stringify({ contentType }),
  })
  if (!res.ok) throw new Error(`presign failed: ${res.status}`)
  return res.json()
}

describe('MinIO upload failure modes', () => {
  // Note: MinIO's PresignedPutObject signs `X-Amz-SignedHeaders=host` only;
  // Content-Type is NOT part of the signature, so a PUT with a mismatched
  // content type still succeeds at the bucket level. The API still enforces
  // its allowlist (jpeg/png/gif/webp) at presign time, but there is no
  // server-side verification that uploaded bytes match the declared type.
  // The closest "wrong content type" failure that MinIO will reject is a
  // PUT to a tampered URL (path mutated after signing).
  it('PUT to a tampered URL fails (signature mismatch)', async () => {
    const artist = await createArtist(`${SUFFIX}-ct`)
    const { uploadUrl } = await presign(artist.token, 'image/jpeg')

    // Mutate the key in the path — same query/sig but a different object name.
    const url = new URL(uploadUrl)
    url.pathname = url.pathname.replace(/[^/]+$/, 'tampered.jpg')
    const tamperedUrl = url.toString()

    const putRes = await s3Put(tamperedUrl, MINIMAL_JPEG, 'image/jpeg')
    expect(putRes.ok).toBe(false)
    expect(putRes.status).toBeGreaterThanOrEqual(400)
  })

  it('presign rejects unsupported content types (422)', async () => {
    const artist = await createArtist(`${SUFFIX}-cttext`)
    const res = await fetch(`${API}/images/presign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(artist.token) },
      body: JSON.stringify({ contentType: 'text/plain' }),
    })
    expect(res.status).toBe(422)
  })

  it('confirm with a key that was never uploaded returns 404', async () => {
    const artist = await createArtist(`${SUFFIX}-noobj`)
    // Skip presign+PUT entirely — fabricate a plausible key.
    const fakeKey = `00000000-0000-0000-0000-000000000000.jpg`
    const res = await fetch(`${API}/images/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(artist.token) },
      body: JSON.stringify({ s3Key: fakeKey }),
    })
    expect(res.status).toBe(404)
  })

  it('anonymous GET of a confirmed image succeeds (bucket anonymous=download)', async () => {
    const artist = await createArtist(`${SUFFIX}-anon`)
    const { uploadUrl, s3Key } = await presign(artist.token, 'image/jpeg')

    const putRes = await s3Put(uploadUrl, MINIMAL_JPEG, 'image/jpeg')
    expect(putRes.ok).toBe(true)

    const confirmRes = await fetch(`${API}/images/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(artist.token) },
      body: JSON.stringify({ s3Key }),
    })
    expect(confirmRes.status).toBe(200)
    const { cdnUrl } = await confirmRes.json()
    expect(typeof cdnUrl).toBe('string')

    // Anonymous GET — no Authorization header.
    const anonRes = await fetch(cdnUrl)
    expect(anonRes.status).toBe(200)
    const ct = anonRes.headers.get('content-type')
    expect(ct).toMatch(/image\/jpeg/i)
  })
})
