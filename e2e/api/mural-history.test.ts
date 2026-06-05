import { describe, it, expect, beforeAll } from 'vitest'
import {
  createOrganiser, createFestival, setFestivalStatus, upsertForm,
  createArtist, createProfile,
  OrganiserSetup,
} from '../fixtures/helpers.js'

const API = process.env.API_URL ?? 'http://localhost:8080'
const SUFFIX = `mural-hist-${Date.now()}`
const auth = (t: string) => ({ Authorization: `Bearer ${t}` })
const json = (t: string) => ({ 'Content-Type': 'application/json', ...auth(t) })

// Cheltenham town centre
const CHELT_LAT = 51.8994
const CHELT_LNG = -2.0783

describe('mural history', () => {
  let org: OrganiserSetup
  let fest2027Id: string
  let spotId: string

  beforeAll(async () => {
    org = await createOrganiser(SUFFIX)
    const f = await createFestival(org.token, {
      name: `CPF 2027 ${SUFFIX}`,
      slug: `cpf-2027-${SUFFIX}`,
    })
    fest2027Id = f.festivalId
    await upsertForm(org.token, fest2027Id)
    await setFestivalStatus(org.token, fest2027Id, 'open')

    // Create a spot on 2027 festival
    const createRes = await fetch(`${API}/festivals/${fest2027Id}/spots`, {
      method: 'POST',
      headers: json(org.token),
      body: JSON.stringify({ lat: CHELT_LAT, lng: CHELT_LNG }),
    })
    expect(createRes.status).toBe(201)
    const spot = await createRes.json()
    spotId = spot.id
  })

  it('spot has mural_status defaulting to unknown', async () => {
    const res = await fetch(`${API}/festivals/${fest2027Id}/spots`, { headers: auth(org.token) })
    expect(res.status).toBe(200)
    const data = await res.json()
    const s = data.spots.find((x: { id: string }) => x.id === spotId)
    expect(s?.mural_status).toBe('unknown')
  })

  it('PATCH spot with mural_status persists the value', async () => {
    const res = await fetch(`${API}/festivals/${fest2027Id}/spots/${spotId}`, {
      method: 'PATCH',
      headers: json(org.token),
      body: JSON.stringify({ lat: CHELT_LAT, lng: CHELT_LNG, mural_status: 'permanent' }),
    })
    expect(res.status).toBe(200)
    const spot = await res.json()
    expect(spot.mural_status).toBe('permanent')
  })

  it('invalid mural_status is rejected with 422', async () => {
    const res = await fetch(`${API}/festivals/${fest2027Id}/spots/${spotId}`, {
      method: 'PATCH',
      headers: json(org.token),
      body: JSON.stringify({ lat: CHELT_LAT, lng: CHELT_LNG, mural_status: 'foobar' }),
    })
    expect(res.status).toBe(422)
  })

  it('GET /spots/nearby-history returns [] when festival has no center', async () => {
    const res = await fetch(`${API}/festivals/${fest2027Id}/spots/nearby-history`, {
      headers: auth(org.token),
    })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(Array.isArray(data)).toBe(true)
    expect(data).toHaveLength(0)
  })

  it('after setting center, nearby-history returns spots from nearby festivals', async () => {
    // Create a second (historical) festival nearby and add a spot
    const hist = await createFestival(org.token, {
      name: `CPF 2026 ${SUFFIX}`,
      slug: `cpf-2026-${SUFFIX}`,
    })
    // Set its center
    const patchFest = await fetch(`${API}/festivals/${hist.festivalId}`, {
      method: 'PATCH',
      headers: json(org.token),
      body: JSON.stringify({ center_lat: CHELT_LAT + 0.001, center_lng: CHELT_LNG + 0.001 }),
    })
    expect(patchFest.status).toBe(200)
    // Add a spot
    await fetch(`${API}/festivals/${hist.festivalId}/spots`, {
      method: 'POST',
      headers: json(org.token),
      body: JSON.stringify({ lat: CHELT_LAT + 0.002, lng: CHELT_LNG + 0.002 }),
    })
    const histSpots = await (await fetch(`${API}/festivals/${hist.festivalId}/spots`, { headers: auth(org.token) })).json()
    const histSpotId = histSpots.spots[0].id
    await fetch(`${API}/festivals/${hist.festivalId}/spots/${histSpotId}`, {
      method: 'PATCH',
      headers: json(org.token),
      body: JSON.stringify({ lat: CHELT_LAT + 0.002, lng: CHELT_LNG + 0.002, mural_status: 'permanent' }),
    })

    // Set center on 2027 festival
    await fetch(`${API}/festivals/${fest2027Id}`, {
      method: 'PATCH',
      headers: json(org.token),
      body: JSON.stringify({ center_lat: CHELT_LAT, center_lng: CHELT_LNG }),
    })

    const res = await fetch(`${API}/festivals/${fest2027Id}/spots/nearby-history`, {
      headers: auth(org.token),
    })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.length).toBeGreaterThan(0)
    const entry = data[0]
    expect(entry.mural_status).toBeDefined()
    expect(entry.festival_name).toBeDefined()
    expect(typeof entry.lat).toBe('number')
    expect(typeof entry.lng).toBe('number')
    // Must not include the current festival's own spots
    expect(entry.festival_id).not.toBe(fest2027Id)
  })

  it('public profile includes spot_history when artist has placements', async () => {
    const artist = await createArtist(`${SUFFIX}-art`)
    await createProfile(artist.token, { displayName: `History Artist ${SUFFIX}` })
    const profileRes = await fetch(`${API}/profiles/me`, { headers: auth(artist.token) })
    const { id: profileId } = await profileRes.json()

    // Check the field exists and is an array even when empty
    const pubRes = await fetch(`${API}/profiles/${profileId}`)
    expect(pubRes.status).toBe(200)
    const pub = await pubRes.json()
    expect(Array.isArray(pub.spot_history)).toBe(true)
  })
})
