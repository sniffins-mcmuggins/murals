// /me/applications lists multiple applications (issue #113).
import { describe, it, expect, beforeAll } from 'vitest'
import {
  createArtist,
  createOrganiser,
  createProfile,
  createFestival,
  setFestivalStatus,
  upsertForm,
  submitApplication,
  ArtistSetup,
  OrganiserSetup,
} from '../fixtures/helpers.js'

const API = process.env.API_URL ?? 'http://localhost:8080'
const SUFFIX = `gaps-meapps-${Date.now()}`

function auth(token: string) {
  return { Authorization: `Bearer ${token}` }
}

describe('/me/applications', () => {
  let artist: ArtistSetup
  let otherArtist: ArtistSetup
  let organiser: OrganiserSetup

  beforeAll(async () => {
    artist = await createArtist(`${SUFFIX}-art`)
    otherArtist = await createArtist(`${SUFFIX}-other`)
    organiser = await createOrganiser(`${SUFFIX}-org`)
    await createProfile(artist.token, { displayName: `MeApps ${SUFFIX}` })
    await createProfile(otherArtist.token, { displayName: `Other ${SUFFIX}` })
  })

  it('returns multiple submitted applications for the authenticated artist', async () => {
    // Two open festivals so we can submit two applications.
    const fest1 = await createFestival(organiser.token, {
      name: 'MeApps One',
      slug: `meapps-one-${SUFFIX}`,
    })
    await upsertForm(organiser.token, fest1.festivalId)
    await setFestivalStatus(organiser.token, fest1.festivalId, 'open')

    const fest2 = await createFestival(organiser.token, {
      name: 'MeApps Two',
      slug: `meapps-two-${SUFFIX}`,
    })
    await upsertForm(organiser.token, fest2.festivalId)
    await setFestivalStatus(organiser.token, fest2.festivalId, 'open')

    const app1 = await submitApplication(artist.token, fest1.festivalId)
    const app2 = await submitApplication(artist.token, fest2.festivalId)

    const res = await fetch(`${API}/me/applications`, { headers: auth(artist.token) })
    expect(res.status).toBe(200)
    const apps = await res.json()
    expect(Array.isArray(apps)).toBe(true)

    const ids = apps.map((a: { id: string }) => a.id)
    expect(ids).toContain(app1.applicationId)
    expect(ids).toContain(app2.applicationId)

    const ours = apps.filter((a: { id: string }) =>
      a.id === app1.applicationId || a.id === app2.applicationId,
    )
    expect(ours).toHaveLength(2)
    for (const a of ours) {
      expect(a.status).toBe('submitted')
    }
  })

  it('does not include another artist\'s applications', async () => {
    const fest = await createFestival(organiser.token, {
      name: 'MeApps Isolation',
      slug: `meapps-iso-${SUFFIX}`,
    })
    await upsertForm(organiser.token, fest.festivalId)
    await setFestivalStatus(organiser.token, fest.festivalId, 'open')

    const appOther = await submitApplication(otherArtist.token, fest.festivalId)

    const res = await fetch(`${API}/me/applications`, { headers: auth(artist.token) })
    expect(res.status).toBe(200)
    const apps = await res.json()
    const ids = apps.map((a: { id: string }) => a.id)
    expect(ids).not.toContain(appOther.applicationId)
  })
})
