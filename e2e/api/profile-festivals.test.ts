import { describe, it, expect } from 'vitest'
import {
  createArtist,
  createOrganiser,
  createProfile,
  createFestival,
  setFestivalStatus,
  upsertForm,
  submitApplication,
  acceptArtist,
} from '../fixtures/helpers'

const API = process.env.API_URL ?? 'http://localhost:8080'

async function declineArtist(token: string, festivalId: string, applicationId: string): Promise<void> {
  const res = await fetch(
    `${API}/festivals/${festivalId}/applications/${applicationId}/decline`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
  )
  if (!res.ok) throw new Error(`Decline artist failed: ${res.status}`)
}

describe('GET /profiles/{profileID}/festivals — public festival appearances', () => {
  it('invalid profileID → 400', async () => {
    const res = await fetch(`${API}/profiles/not-a-uuid/festivals`)
    expect(res.status).toBe(400)
  })

  it('returns [] (not null) for an artist with no appearances', async () => {
    const suffix = Date.now()
    const artist = await createArtist(`noappear-${suffix}`)
    const { profileId } = await createProfile(artist.token, { displayName: `No Appearances ${suffix}` })

    const res = await fetch(`${API}/profiles/${profileId}/festivals`)
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text.trim()).toBe('[]')
  })

  it('accepted artist appears with a live map link; declined artist does not', async () => {
    const suffix = Date.now()

    const organiser = await createOrganiser(`fest-org-${suffix}`)
    const { festivalId, slug } = await createFestival(organiser.token, {
      name: `Appearance Fest ${suffix}`,
      slug: `appearance-fest-${suffix}`,
    })
    await upsertForm(organiser.token, festivalId)

    // Two artists with profiles both apply.
    const accepted = await createArtist(`accepted-${suffix}`)
    const acceptedProfile = await createProfile(accepted.token, { displayName: `Accepted Artist ${suffix}` })
    const acceptedApp = await submitApplication(accepted.token, festivalId)

    const declined = await createArtist(`declined-${suffix}`)
    const declinedProfile = await createProfile(declined.token, { displayName: `Declined Artist ${suffix}` })
    const declinedApp = await submitApplication(declined.token, festivalId)

    // Organiser resolves both applications, then publishes the festival.
    await acceptArtist(organiser.token, festivalId, acceptedApp.applicationId)
    await declineArtist(organiser.token, festivalId, declinedApp.applicationId)
    await setFestivalStatus(organiser.token, festivalId, 'live')

    // Accepted artist's profile lists the festival, with a working map link.
    const acceptedRes = await fetch(`${API}/profiles/${acceptedProfile.profileId}/festivals`)
    expect(acceptedRes.status).toBe(200)
    const acceptedList = await acceptedRes.json()
    expect(Array.isArray(acceptedList)).toBe(true)
    const appearance = acceptedList.find((f: { id: string }) => f.id === festivalId)
    expect(appearance).toBeDefined()
    expect(appearance.slug).toBe(slug)
    expect(appearance.status).toBe('live')
    expect(appearance.map_slug).toBe(slug)

    // Declined artist's profile does NOT list the festival.
    const declinedRes = await fetch(`${API}/profiles/${declinedProfile.profileId}/festivals`)
    expect(declinedRes.status).toBe(200)
    const declinedList = await declinedRes.json()
    expect(declinedList.find((f: { id: string }) => f.id === festivalId)).toBeUndefined()
  })

  it('does not list a festival that is still in draft (not publicly visible)', async () => {
    const suffix = Date.now()

    const organiser = await createOrganiser(`draft-org-${suffix}`)
    const { festivalId } = await createFestival(organiser.token, {
      name: `Draft Fest ${suffix}`,
      slug: `draft-fest-${suffix}`,
    })
    await upsertForm(organiser.token, festivalId)

    const artist = await createArtist(`draft-artist-${suffix}`)
    const profile = await createProfile(artist.token, { displayName: `Draft Artist ${suffix}` })
    const app = await submitApplication(artist.token, festivalId)

    await acceptArtist(organiser.token, festivalId, app.applicationId)
    // Festival left in draft — never published.

    const res = await fetch(`${API}/profiles/${profile.profileId}/festivals`)
    expect(res.status).toBe(200)
    const list = await res.json()
    expect(list.find((f: { id: string }) => f.id === festivalId)).toBeUndefined()
  })
})
