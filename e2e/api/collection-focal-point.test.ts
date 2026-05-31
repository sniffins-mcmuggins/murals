// E2E coverage for collection focal point fields (cover_focal_x, cover_focal_y).
// Gaps: PATCH /collections/{id} with focal values should round-trip from DB
// correctly, and out-of-range values should be server-clamped to [0, 100].

import { describe, it, expect } from 'vitest'
import { createArtist, createProfile, createCollection } from '../fixtures/helpers.js'

const API = process.env.API_URL ?? 'http://localhost:8080'
const auth = (token: string) => ({ Authorization: `Bearer ${token}` })
const json = { 'Content-Type': 'application/json' }

describe('collection focal point', () => {
  it('PATCH /collections/{id} without token → 401', async () => {
    const suffix = Date.now()
    const { token } = await createArtist(suffix)
    await createProfile(token, { displayName: `FP Auth ${suffix}` })
    const { collectionId } = await createCollection(token, { name: `FP Auth Coll ${suffix}` })

    const res = await fetch(`${API}/collections/${collectionId}`, {
      method: 'PATCH',
      headers: json,
      body: JSON.stringify({ coverFocalX: 75, coverFocalY: 30 }),
    })
    expect(res.status).toBe(401)
  })

  it('setting focal point values round-trips through the DB', async () => {
    const suffix = Date.now()
    const { token } = await createArtist(suffix)
    await createProfile(token, { displayName: `FP Artist ${suffix}` })
    await fetch(`${API}/profiles/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth(token) },
      body: JSON.stringify({ visibility: 'public' }),
    })
    const { collectionId } = await createCollection(token, { name: `FP Coll ${suffix}` })

    const patchRes = await fetch(`${API}/collections/${collectionId}`, {
      method: 'PATCH',
      headers: { ...json, ...auth(token) },
      body: JSON.stringify({ coverFocalX: 75, coverFocalY: 30 }),
    })
    expect(patchRes.status).toBe(200)
    const data = await patchRes.json()
    expect(data.cover_focal_x).toBe(75)
    expect(data.cover_focal_y).toBe(30)

    // Values also appear in a fresh GET
    const getRes = await fetch(`${API}/collections/${collectionId}`)
    expect(getRes.status).toBe(200)
    const fresh = await getRes.json()
    expect(fresh.cover_focal_x).toBe(75)
    expect(fresh.cover_focal_y).toBe(30)
  })

  it('out-of-range focal values are clamped to [0, 100]', async () => {
    const suffix = Date.now()
    const { token } = await createArtist(suffix)
    await createProfile(token, { displayName: `FP Clamp ${suffix}` })
    const { collectionId } = await createCollection(token, { name: `FP Clamp Coll ${suffix}` })

    const patchRes = await fetch(`${API}/collections/${collectionId}`, {
      method: 'PATCH',
      headers: { ...json, ...auth(token) },
      body: JSON.stringify({ coverFocalX: 150, coverFocalY: -10 }),
    })
    expect(patchRes.status).toBe(200)
    const data = await patchRes.json()
    expect(data.cover_focal_x).toBe(100)
    expect(data.cover_focal_y).toBe(0)
  })

  it('focal point defaults to 50/50 on new collections', async () => {
    const suffix = Date.now()
    const { token } = await createArtist(suffix)
    await createProfile(token, { displayName: `FP Default ${suffix}` })
    await fetch(`${API}/profiles/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth(token) },
      body: JSON.stringify({ visibility: 'public' }),
    })
    const { collectionId } = await createCollection(token, { name: `FP Default Coll ${suffix}` })

    const res = await fetch(`${API}/collections/${collectionId}`)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.cover_focal_x).toBe(50)
    expect(data.cover_focal_y).toBe(50)
  })
})
