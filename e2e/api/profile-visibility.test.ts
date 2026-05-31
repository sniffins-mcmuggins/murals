import { describe, it, expect } from 'vitest'
import { createArtist, createProfile } from '../fixtures/helpers'

const API = process.env.API_URL ?? 'http://localhost:8080'
const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

async function publishProfile(token: string): Promise<void> {
  const res = await fetch(`${API}/profiles/me`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...auth(token) },
    body: JSON.stringify({ visibility: 'public' }),
  })
  if (!res.ok) throw new Error(`publishProfile failed: ${res.status}`)
}

describe('profile visibility (E15.1)', () => {
  it('new profile is draft — anonymous GET returns 404', async () => {
    const suffix = Date.now()
    const { token } = await createArtist(suffix)
    const { profileId } = await createProfile(token, { displayName: `Draft ${suffix}` })

    const res = await fetch(`${API}/profiles/${profileId}`)
    expect(res.status).toBe(404)
  })

  it('owner can GET their own draft profile and sees visibility=draft', async () => {
    const suffix = Date.now() + 1
    const { token } = await createArtist(suffix)
    const { profileId } = await createProfile(token, { displayName: `Draft Owner ${suffix}` })

    const res = await fetch(`${API}/profiles/${profileId}`, { headers: auth(token) })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.id).toBe(profileId)
    expect(data.visibility).toBe('draft')
  })

  it('draft profile collections return 404 for anonymous caller', async () => {
    const suffix = Date.now() + 2
    const { token } = await createArtist(suffix)
    const { profileId } = await createProfile(token, { displayName: `Draft Coll ${suffix}` })

    const res = await fetch(`${API}/profiles/${profileId}/collections`)
    expect(res.status).toBe(404)
  })

  it('owner can GET collections on their draft profile', async () => {
    const suffix = Date.now() + 3
    const { token } = await createArtist(suffix)
    const { profileId } = await createProfile(token, { displayName: `Draft Coll Owner ${suffix}` })

    const res = await fetch(`${API}/profiles/${profileId}/collections`, { headers: auth(token) })
    expect(res.status).toBe(200)
  })

  it('non-owner authenticated user cannot see draft profile', async () => {
    const suffix = Date.now() + 4
    const { token: ownerToken } = await createArtist(suffix)
    const { profileId } = await createProfile(ownerToken, { displayName: `Draft Other ${suffix}` })

    const { token: otherToken } = await createArtist(suffix + 10000)
    const res = await fetch(`${API}/profiles/${profileId}`, { headers: auth(otherToken) })
    expect(res.status).toBe(404)
  })

  it('draft profile does not appear in GET /public/profiles', async () => {
    const suffix = Date.now() + 5
    const { token } = await createArtist(suffix)
    const { profileId } = await createProfile(token, { displayName: `Hidden ${suffix}` })

    const res = await fetch(`${API}/public/profiles`)
    const list = await res.json()
    expect(list.profiles.every((p: { id: string }) => p.id !== profileId)).toBe(true)
  })

  it('PATCH visibility to public → anonymous GET 200, appears in /public/profiles', async () => {
    const suffix = Date.now() + 6
    const { token } = await createArtist(suffix)
    const { profileId } = await createProfile(token, { displayName: `Going Public ${suffix}` })

    // Confirm draft state first
    expect((await fetch(`${API}/profiles/${profileId}`)).status).toBe(404)

    // Flip to public
    const patchRes = await fetch(`${API}/profiles/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth(token) },
      body: JSON.stringify({ visibility: 'public' }),
    })
    expect(patchRes.status).toBe(200)
    expect((await patchRes.json()).visibility).toBe('public')

    // Now accessible anonymously
    const getRes = await fetch(`${API}/profiles/${profileId}`)
    expect(getRes.status).toBe(200)
    expect((await getRes.json()).visibility).toBe('public')

    // Appears in public listing
    const listRes = await fetch(`${API}/public/profiles`)
    const list = await listRes.json()
    expect(list.profiles.some((p: { id: string }) => p.id === profileId)).toBe(true)
  })

  it('PATCH visibility with invalid value → 422', async () => {
    const suffix = Date.now() + 7
    const { token } = await createArtist(suffix)
    await createProfile(token, { displayName: `Bad Vis ${suffix}` })

    const res = await fetch(`${API}/profiles/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth(token) },
      body: JSON.stringify({ visibility: 'suspended' }),
    })
    expect(res.status).toBe(422)
  })
})
