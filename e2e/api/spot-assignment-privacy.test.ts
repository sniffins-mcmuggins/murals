import { describe, it, expect } from 'vitest'
import {
  createArtist, createOrganiser, createProfile, createFestival,
  setFestivalStatus, upsertForm, submitApplication, stageDecision,
  createSpot, assignArtistToSpot,
} from '../fixtures/helpers'

const API = process.env.API_URL ?? 'http://localhost:8080'

describe('no artist awareness before release', () => {
  it('pre-release: artist can be assigned a spot but learns nothing via the API', async () => {
    const suffix = `privacy-${Date.now()}`
    const artist = await createArtist(suffix)
    await createProfile(artist.token, { displayName: `Privacy Artist ${suffix}` })
    const org = await createOrganiser(suffix)
    const { festivalId, slug } = await createFestival(org.token, {
      name: `Privacy Fest ${suffix}`, slug: `privacy-${suffix}`,
    })
    await upsertForm(org.token, festivalId)
    await setFestivalStatus(org.token, festivalId, 'open')
    const { applicationId } = await submitApplication(artist.token, festivalId)

    // Organiser stages accept (NO release) and assigns a spot pre-release.
    await stageDecision(org.token, festivalId, applicationId, 'accept')
    const spotsRes = await fetch(`${API}/festivals/${festivalId}/spots`, {
      headers: { Authorization: `Bearer ${org.token}` },
    })
    const { unassigned_artists } = await spotsRes.json()
    expect(unassigned_artists.length).toBe(1) // provisional accept is eligible
    const artistProfileId = unassigned_artists[0].artist_id
    const { spotId } = await createSpot(org.token, festivalId, 51.9, -2.07)
    await assignArtistToSpot(org.token, festivalId, spotId, artistProfileId)

    // 1. Artist's own /me/applications leaks no review signal.
    const mine = await fetch(`${API}/me/applications`, {
      headers: { Authorization: `Bearer ${artist.token}` },
    })
    const mineBody = await mine.text()
    expect(mine.status).toBe(200)
    // Decision is null until released — the staged 'accept' must not leak.
    expect(mineBody).toContain('"decision":null')
    expect(mineBody).not.toContain('"decision":"accept"')
    expect(mineBody).not.toContain('staged_decision')
    expect(mineBody).not.toContain('shortlisted')

    // 2. Public artist appearances don't show the unreleased festival.
    const appearances = await fetch(`${API}/profiles/${artistProfileId}/festivals`).then(r => r.json())
    expect(appearances.find((f: { slug: string }) => f.slug === slug)).toBeUndefined()

    // 3. Public map 404s (festival not live).
    const map = await fetch(`${API}/festivals/slug/${slug}/map`)
    expect(map.status).toBe(404)
  })

  it('re-staging away from accept clears the pre-release spot', async () => {
    const suffix = `clear-${Date.now()}`
    const artist = await createArtist(suffix)
    await createProfile(artist.token, { displayName: `Clear Artist ${suffix}` })
    const org = await createOrganiser(suffix)
    const { festivalId } = await createFestival(org.token, {
      name: `Clear Fest ${suffix}`, slug: `clear-${suffix}`,
    })
    await upsertForm(org.token, festivalId)
    await setFestivalStatus(org.token, festivalId, 'open')
    const { applicationId } = await submitApplication(artist.token, festivalId)
    await stageDecision(org.token, festivalId, applicationId, 'accept')

    const spotsRes = await fetch(`${API}/festivals/${festivalId}/spots`, {
      headers: { Authorization: `Bearer ${org.token}` },
    })
    const { unassigned_artists } = await spotsRes.json()
    const artistProfileId = unassigned_artists[0].artist_id
    const { spotId } = await createSpot(org.token, festivalId, 51.9, -2.07)
    await assignArtistToSpot(org.token, festivalId, spotId, artistProfileId)

    // Flip to decline → spot must clear.
    await stageDecision(org.token, festivalId, applicationId, 'decline')
    const after = await fetch(`${API}/festivals/${festivalId}/spots`, {
      headers: { Authorization: `Bearer ${org.token}` },
    }).then(r => r.json())
    const spot = after.spots.find((s: { id: string }) => s.id === spotId)
    expect(spot.artist_id).toBeNull()
  })
})
