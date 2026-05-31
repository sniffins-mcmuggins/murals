// E2E coverage for collection and image reorder endpoints.
// Gaps identified in audit: success path, IDOR, and 401 probes for
// PUT /collections/order and PUT /collections/{id}/images/order.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { createArtist, createProfile, createCollection } from '../fixtures/helpers.js'
import { forcePublish } from '../fixtures/db-helpers.js'

const API = process.env.API_URL ?? 'http://localhost:8080'
const DB_URL = process.env.DATABASE_URL ?? 'postgres://render:render@localhost:5432/render'
const auth = (token: string) => ({ Authorization: `Bearer ${token}` })
const json = { 'Content-Type': 'application/json' }

let db: Client
beforeAll(async () => { db = new Client({ connectionString: DB_URL }); await db.connect() })
afterAll(async () => { await db.end() })

// Attach an image directly without going through MinIO — AttachImageHandler
// accepts any s3Key/cdnUrl, no MinIO validation.
async function attachImage(
  token: string,
  collectionId: string,
  suffix: number,
  n: number,
): Promise<{ imageId: string }> {
  const res = await fetch(`${API}/collections/${collectionId}/images`, {
    method: 'POST',
    headers: { ...json, ...auth(token) },
    body: JSON.stringify({
      s3Key: `test/reorder-${suffix}-${n}.jpg`,
      cdnUrl: `https://cdn.example.com/reorder-${suffix}-${n}.jpg`,
    }),
  })
  if (!res.ok) throw new Error(`Attach image failed: ${res.status}`)
  const data = await res.json()
  return { imageId: data.id }
}

// ─── Collection reorder (PUT /collections/order) ─────────────────────────────

describe('collection reorder', () => {
  it('PUT /collections/order without token → 401', async () => {
    const res = await fetch(`${API}/collections/order`, {
      method: 'PUT',
      headers: json,
      body: JSON.stringify({ collectionIds: [] }),
    })
    expect(res.status).toBe(401)
  })

  it('reorders collections and order persists in GET /profiles/{profileID}/collections', async () => {
    const suffix = Date.now()
    const { token, userId } = await createArtist(suffix)
    const { profileId } = await createProfile(token, { displayName: `Reorder Colls ${suffix}` })
    const { collectionId: idA } = await createCollection(token, { name: `A-${suffix}` })
    const { collectionId: idB } = await createCollection(token, { name: `B-${suffix}` })

    // Bypass publish gate — this test is about collection ordering, not the publish gate.
    await forcePublish(db, userId)

    // Explicitly set A first, then assert we can flip to B first.
    // (Don't rely on creation-time ordering — both rows may share the same millisecond.)
    const init = await fetch(`${API}/collections/order`, {
      method: 'PUT',
      headers: { ...json, ...auth(token) },
      body: JSON.stringify({ collectionIds: [idA, idB] }),
    })
    expect(init.status).toBe(204)

    const before = (await fetch(`${API}/profiles/${profileId}/collections`).then(r => r.json())) as Array<{ id: string }>
    expect(before[0].id).toBe(idA)
    expect(before[1].id).toBe(idB)

    // Reorder: B before A
    const reorderRes = await fetch(`${API}/collections/order`, {
      method: 'PUT',
      headers: { ...json, ...auth(token) },
      body: JSON.stringify({ collectionIds: [idB, idA] }),
    })
    expect(reorderRes.status).toBe(204)

    // Order persists
    const after = (await fetch(`${API}/profiles/${profileId}/collections`).then(r => r.json())) as Array<{ id: string }>
    expect(after[0].id).toBe(idB)
    expect(after[1].id).toBe(idA)
  })

  it('artist A cannot reorder artist B\'s collections → 422', async () => {
    const suffix = Date.now()
    const artistA = await createArtist(`${suffix}-ra`)
    const artistB = await createArtist(`${suffix}-rb`)
    await createProfile(artistA.token, { displayName: `RA ${suffix}` })
    await createProfile(artistB.token, { displayName: `RB ${suffix}` })
    const { collectionId: bCollId } = await createCollection(artistB.token, { name: `B coll ${suffix}` })

    // A tries to include B's collection in a reorder request
    const res = await fetch(`${API}/collections/order`, {
      method: 'PUT',
      headers: { ...json, ...auth(artistA.token) },
      body: JSON.stringify({ collectionIds: [bCollId] }),
    })
    expect(res.status).toBe(422)
  })
})

// ─── Image reorder (PUT /collections/{collectionID}/images/order) ─────────────

describe('image reorder', () => {
  it('PUT /collections/{id}/images/order without token → 401', async () => {
    const suffix = Date.now()
    const { token } = await createArtist(suffix)
    await createProfile(token, { displayName: `IR Auth ${suffix}` })
    const { collectionId } = await createCollection(token, { name: `IR Auth Coll ${suffix}` })

    const res = await fetch(`${API}/collections/${collectionId}/images/order`, {
      method: 'PUT',
      headers: json,
      body: JSON.stringify({ imageIds: [] }),
    })
    expect(res.status).toBe(401)
  })

  it('reorders images and order persists in GET /collections/{id}/images', async () => {
    const suffix = Date.now()
    const { token } = await createArtist(suffix)
    await createProfile(token, { displayName: `Reorder Imgs ${suffix}` })
    const { collectionId } = await createCollection(token, { name: `Imgs Coll ${suffix}` })

    const { imageId: idA } = await attachImage(token, collectionId, suffix, 1)
    const { imageId: idB } = await attachImage(token, collectionId, suffix, 2)

    // Explicitly set A first to establish known starting state
    const init = await fetch(`${API}/collections/${collectionId}/images/order`, {
      method: 'PUT',
      headers: { ...json, ...auth(token) },
      body: JSON.stringify({ imageIds: [idA, idB] }),
    })
    expect(init.status).toBe(200)
    const initList = (await init.json()) as Array<{ id: string }>
    expect(initList[0].id).toBe(idA)
    expect(initList[1].id).toBe(idB)

    // Reorder: B before A — returns 200 with the updated list
    const reorderRes = await fetch(`${API}/collections/${collectionId}/images/order`, {
      method: 'PUT',
      headers: { ...json, ...auth(token) },
      body: JSON.stringify({ imageIds: [idB, idA] }),
    })
    expect(reorderRes.status).toBe(200)
    const reordered = (await reorderRes.json()) as Array<{ id: string }>
    expect(reordered[0].id).toBe(idB)
    expect(reordered[1].id).toBe(idA)

    // Order persists on a fresh GET
    const after = (await fetch(`${API}/collections/${collectionId}/images`).then(r => r.json())) as Array<{ id: string }>
    expect(after[0].id).toBe(idB)
    expect(after[1].id).toBe(idA)
  })

  it('artist A cannot reorder images in artist B\'s collection → 403', async () => {
    const suffix = Date.now()
    const artistA = await createArtist(`${suffix}-ia`)
    const artistB = await createArtist(`${suffix}-ib`)
    await createProfile(artistA.token, { displayName: `IA ${suffix}` })
    await createProfile(artistB.token, { displayName: `IB ${suffix}` })
    const { collectionId: bCollId } = await createCollection(artistB.token, { name: `IB coll ${suffix}` })
    const { imageId } = await attachImage(artistB.token, bCollId, suffix, 99)

    const res = await fetch(`${API}/collections/${bCollId}/images/order`, {
      method: 'PUT',
      headers: { ...json, ...auth(artistA.token) },
      body: JSON.stringify({ imageIds: [imageId] }),
    })
    expect(res.status).toBe(403)
  })
})
