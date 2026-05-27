// Application validation tests (issue #113).
//
// - Re-apply protection: second submit → 409.
// - Form validation: missing required field → 422 (canary for the
//   answers-keyed-by-label bug documented in .claude/rules/e2e-debugging.md).
// - Decline path: organiser declines a submitted application → 200, status=declined.
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
const SUFFIX = `gaps-appval-${Date.now()}`

function auth(token: string) {
  return { Authorization: `Bearer ${token}` }
}

describe('application validation', () => {
  let artist: ArtistSetup
  let organiser: OrganiserSetup

  beforeAll(async () => {
    artist = await createArtist(`${SUFFIX}-art`)
    organiser = await createOrganiser(`${SUFFIX}-org`)
    await createProfile(artist.token, { displayName: `AppVal ${SUFFIX}` })
  })

  it('submitting twice to the same festival returns 409', async () => {
    const { festivalId } = await createFestival(organiser.token, {
      name: 'Reapply Fest',
      slug: `reapply-${SUFFIX}`,
    })
    await upsertForm(organiser.token, festivalId)
    await setFestivalStatus(organiser.token, festivalId, 'open')

    // First apply succeeds (helper throws on non-2xx).
    await submitApplication(artist.token, festivalId)

    // Second apply — same artist, same festival.
    const second = await fetch(`${API}/festivals/${festivalId}/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(artist.token) },
      body: JSON.stringify({ answers: { 'artist-statement': 'second try' } }),
    })
    expect(second.status).toBe(409)
  })

  it('apply with required field missing returns 422', async () => {
    const { festivalId } = await createFestival(organiser.token, {
      name: 'Required Fest',
      slug: `required-${SUFFIX}`,
    })
    await upsertForm(organiser.token, festivalId) // declares 'artist-statement' required
    await setFestivalStatus(organiser.token, festivalId, 'open')

    // Submit with empty answers — required field missing.
    const res = await fetch(`${API}/festivals/${festivalId}/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(artist.token) },
      body: JSON.stringify({ answers: {} }),
    })
    expect(res.status).toBe(422)
    const body = await res.json()
    // Detail mentions the field id, not the label — regression canary for the
    // form keying bug.
    expect(JSON.stringify(body)).toContain('artist-statement')
  })

  it('organiser can decline a submitted application (200, status=declined)', async () => {
    const { festivalId } = await createFestival(organiser.token, {
      name: 'Decline Fest',
      slug: `decline-${SUFFIX}`,
    })
    await upsertForm(organiser.token, festivalId)
    await setFestivalStatus(organiser.token, festivalId, 'open')
    const { applicationId } = await submitApplication(artist.token, festivalId)

    const res = await fetch(
      `${API}/festivals/${festivalId}/applications/${applicationId}/decline`,
      { method: 'POST', headers: auth(organiser.token) },
    )
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.status).toBe('declined')
  })
})
