// e2e/api/profile-publish-changes.test.ts
// E29.7 — No-leak + dirty-flag canaries.
// These tests prove the core E29 guarantee: draft edits do NOT leak to the
// public until the owner calls POST /profiles/me/publish-changes, and that
// the has_unpublished_changes flag is set by edits and cleared by that call.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { createHmac } from 'node:crypto'
import { createArtist, createCollection, createProfile, uniqueSuffix } from '../fixtures/helpers.js'

const API = process.env.API_URL ?? 'http://localhost:8080'
const DB_URL = process.env.DATABASE_URL ?? 'postgres://render:render@localhost:5432/render'
const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-jwt-secret-change-in-prod'

const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

function base64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}
function signHS256(payload: Record<string, unknown>, secret: string): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = base64url(JSON.stringify(payload))
  const sig = base64url(createHmac('sha256', secret).update(`${header}.${body}`).digest())
  return `${header}.${body}.${sig}`
}

async function seedAdminToken(db: Client, suffix: string): Promise<string> {
  const email = `admin-e29-${suffix}@pubchg.test`
  await fetch(`${API}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'adminpass123' }),
  })
  const { rows } = await db.query<{ id: string; session_version: number }>(
    `UPDATE users SET is_admin = true, mfa_enabled = true, mfa_secret = 'fake-totp'
     WHERE email = $1 RETURNING id, session_version`,
    [email],
  )
  const { id: adminUserId, session_version: sv } = rows[0]
  const now = Math.floor(Date.now() / 1000)
  return signHS256({ sub: adminUserId, is_admin: true, sv, iat: now, exp: now + 3600 }, JWT_SECRET)
}

// Grant the artist billing entitlement so the publish gate passes.
async function grantEntitlement(adminToken: string, userId: string): Promise<void> {
  const res = await fetch(`${API}/admin/users/${userId}/grants`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth(adminToken) },
    body: JSON.stringify({ plan: 'artist_basic', duration_days: 30, note: 'e29 e2e test grant' }),
  })
  if (!res.ok) throw new Error(`Grant entitlement failed: ${res.status}`)
}

describe('E29 publish-changes staging', () => {
  let db: Client
  let adminToken: string

  beforeAll(async () => {
    db = new Client({ connectionString: DB_URL })
    await db.connect()
    adminToken = await seedAdminToken(db, uniqueSuffix())
  })

  afterAll(async () => {
    await db.end()
  })

  it('edits do not leak publicly until publish; flag clears on publish', async () => {
    const suffix = uniqueSuffix()
    const { token, userId } = await createArtist(suffix)
    const { profileId } = await createProfile(token, { displayName: `Snap Artist ${suffix}`, bio: 'Bio v1' })

    // Grant entitlement and make the profile public (seeds snapshot v1).
    await grantEntitlement(adminToken, userId)
    const publishRes = await fetch(`${API}/profiles/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth(token) },
      body: JSON.stringify({ visibility: 'public' }),
    })
    expect(publishRes.status).toBe(200)

    // Record what the public snapshot says right now (v1 bio).
    const publicV1 = await fetch(`${API}/profiles/${profileId}`)
    expect(publicV1.status).toBe(200)
    const publicDataV1 = await publicV1.json()
    expect(publicDataV1.bio).toBe('Bio v1')
    // Public response must NOT expose has_unpublished_changes (owner-only field).
    expect('has_unpublished_changes' in publicDataV1).toBe(false)

    // Edit the draft bio to "DRAFT v2".
    const patchRes = await fetch(`${API}/profiles/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth(token) },
      body: JSON.stringify({ bio: 'DRAFT v2' }),
    })
    expect(patchRes.status).toBe(200)

    // Owner sees the new bio AND the dirty flag.
    const ownerRes = await fetch(`${API}/profiles/me`, { headers: auth(token) })
    expect(ownerRes.status).toBe(200)
    const ownerData = await ownerRes.json()
    expect(ownerData.bio).toBe('DRAFT v2')
    expect(ownerData.has_unpublished_changes).toBe(true)

    // Public still sees v1 — no leak.
    const publicDuring = await fetch(`${API}/profiles/${profileId}`)
    expect(publicDuring.status).toBe(200)
    const publicDuringData = await publicDuring.json()
    expect(publicDuringData.bio).toBe('Bio v1')
    expect('has_unpublished_changes' in publicDuringData).toBe(false)

    // Publish the changes.
    const publishChangesRes = await fetch(`${API}/profiles/me/publish-changes`, {
      method: 'POST',
      headers: auth(token),
    })
    expect(publishChangesRes.status).toBe(200)
    const publishChangesData = await publishChangesRes.json()
    // has_unpublished_changes is omitted (omitempty) when false — assert it's not truthy.
    expect(publishChangesData.has_unpublished_changes).toBeFalsy()

    // Public now reflects "DRAFT v2".
    const publicAfter = await fetch(`${API}/profiles/${profileId}`)
    expect(publicAfter.status).toBe(200)
    expect((await publicAfter.json()).bio).toBe('DRAFT v2')

    // Owner flag is cleared (field omitted means false).
    const ownerAfter = await fetch(`${API}/profiles/me`, { headers: auth(token) })
    expect((await ownerAfter.json()).has_unpublished_changes).toBeFalsy()
  })

  it('deleting a collection sets the dirty flag and stays public until publish', async () => {
    const suffix = uniqueSuffix()
    const { token, userId } = await createArtist(suffix)
    const { profileId } = await createProfile(token, { displayName: `Del Artist ${suffix}` })
    const { collectionId } = await createCollection(token, { name: `Collection ${suffix}` })

    // Grant entitlement and go public (seeds snapshot that includes the collection).
    await grantEntitlement(adminToken, userId)
    const publishRes = await fetch(`${API}/profiles/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth(token) },
      body: JSON.stringify({ visibility: 'public' }),
    })
    expect(publishRes.status).toBe(200)

    // Assert the public snapshot includes the collection.
    const publicCollsBefore = await fetch(`${API}/profiles/${profileId}/collections`)
    expect(publicCollsBefore.status).toBe(200)
    const beforeList = await publicCollsBefore.json()
    expect(beforeList.some((c: { id: string }) => c.id === collectionId)).toBe(true)

    // Delete the collection — this should fire the DB dirty trigger.
    const deleteRes = await fetch(`${API}/collections/${collectionId}`, {
      method: 'DELETE',
      headers: auth(token),
    })
    expect(deleteRes.status).toBe(204)

    // Owner sees the dirty flag set.
    const ownerRes = await fetch(`${API}/profiles/me`, { headers: auth(token) })
    expect((await ownerRes.json()).has_unpublished_changes).toBe(true)

    // Public snapshot STILL includes the collection — no leak of the deletion.
    const publicCollsDuring = await fetch(`${API}/profiles/${profileId}/collections`)
    expect(publicCollsDuring.status).toBe(200)
    const duringList = await publicCollsDuring.json()
    expect(duringList.some((c: { id: string }) => c.id === collectionId)).toBe(true)

    // Publish the changes.
    const publishChangesRes = await fetch(`${API}/profiles/me/publish-changes`, {
      method: 'POST',
      headers: auth(token),
    })
    expect(publishChangesRes.status).toBe(200)

    // Public snapshot no longer includes the deleted collection.
    const publicCollsAfter = await fetch(`${API}/profiles/${profileId}/collections`)
    expect(publicCollsAfter.status).toBe(200)
    const afterList = await publicCollsAfter.json()
    expect(afterList.some((c: { id: string }) => c.id === collectionId)).toBe(false)

    // Dirty flag is cleared (omitempty — falsy when false).
    const ownerAfter = await fetch(`${API}/profiles/me`, { headers: auth(token) })
    expect((await ownerAfter.json()).has_unpublished_changes).toBeFalsy()
  })
})
