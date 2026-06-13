// Authorization isolation tests (issue #113).
//
// Confirms that user A cannot mutate user B's collections, applications,
// festivals, or read another user's `me/*` resources. Expected status codes
// reflect what the handlers actually return today (403 vs 404) — read each
// handler before changing an expectation.
//
// Users are created once in beforeAll to keep signup/login traffic under the
// rate-limit ceiling when this file runs alongside the rest of the e2e suite.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import {
  createArtist,
  createOrganiser,
  createProfile,
  createCollection,
  createFestival,
  createSpot,
  setFestivalStatus,
  upsertForm,
  submitApplication,
  ArtistSetup,
  OrganiserSetup,
} from '../fixtures/helpers.js'
import { forcePublish } from '../fixtures/db-helpers.js'

const API = process.env.API_URL ?? 'http://localhost:8080'
const DB_URL = process.env.DATABASE_URL ?? 'postgres://render:render@localhost:5432/render'
const SUFFIX = `gaps-isol-${Date.now()}`

function auth(token: string) {
  return { Authorization: `Bearer ${token}` }
}

describe('authorization isolation', () => {
  let artistA: ArtistSetup
  let artistB: ArtistSetup
  let orgA: OrganiserSetup
  let orgB: OrganiserSetup
  let profileAName: string
  let profileBName: string
  let db: Client

  beforeAll(async () => {
    db = new Client({ connectionString: DB_URL })
    await db.connect()

    artistA = await createArtist(`${SUFFIX}-aA`)
    artistB = await createArtist(`${SUFFIX}-aB`)
    orgA = await createOrganiser(`${SUFFIX}-oA`)
    orgB = await createOrganiser(`${SUFFIX}-oB`)
    profileAName = `A ${SUFFIX}`
    profileBName = `B ${SUFFIX}`
    await createProfile(artistA.token, { displayName: profileAName })
    await createProfile(artistB.token, { displayName: profileBName })
    // Bypass publish gate — these tests are about auth isolation, not the publish gate.
    await forcePublish(db, artistA.userId)
    await forcePublish(db, artistB.userId)
  })

  afterAll(async () => {
    await db.end()
  })

  it('user A cannot PATCH user B\'s collection (403)', async () => {
    const { collectionId } = await createCollection(artistB.token, { name: `coll-patch-${SUFFIX}` })

    const res = await fetch(`${API}/collections/${collectionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth(artistA.token) },
      body: JSON.stringify({ name: 'hijacked' }),
    })
    expect(res.status).toBe(403)
  })

  it('user A cannot DELETE user B\'s collection (403)', async () => {
    const { collectionId } = await createCollection(artistB.token, { name: `coll-del-${SUFFIX}` })

    const res = await fetch(`${API}/collections/${collectionId}`, {
      method: 'DELETE',
      headers: auth(artistA.token),
    })
    expect(res.status).toBe(403)

    // Still exists: anyone can read it (public GET).
    const verifyRes = await fetch(`${API}/collections/${collectionId}`)
    expect(verifyRes.status).toBe(200)
  })

  it('GET /profiles/me returns own profile, never another user\'s', async () => {
    const resA = await fetch(`${API}/profiles/me`, { headers: auth(artistA.token) })
    expect(resA.status).toBe(200)
    const dataA = await resA.json()
    expect(dataA.display_name).toBe(profileAName)

    const resB = await fetch(`${API}/profiles/me`, { headers: auth(artistB.token) })
    expect(resB.status).toBe(200)
    const dataB = await resB.json()
    expect(dataB.display_name).toBe(profileBName)

    expect(dataA.id).not.toBe(dataB.id)
  })

  it('organiser A cannot PATCH organiser B\'s festival (403)', async () => {
    const { festivalId } = await createFestival(orgB.token, {
      name: 'B Fest',
      slug: `b-fest-patch-${SUFFIX}`,
    })

    const res = await fetch(`${API}/festivals/${festivalId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth(orgA.token) },
      body: JSON.stringify({ name: 'hijacked' }),
    })
    expect(res.status).toBe(403)
  })

  it('organiser A cannot accept an application on organiser B\'s festival (403)', async () => {
    const { festivalId } = await createFestival(orgB.token, {
      name: 'B Fest Accept',
      slug: `b-fest-acc-${SUFFIX}`,
    })
    await upsertForm(orgB.token, festivalId)
    await setFestivalStatus(orgB.token, festivalId, 'open')
    const { applicationId } = await submitApplication(artistA.token, festivalId)

    // Organiser A tries to set a decision on B's festival — 403.
    const acceptRes = await fetch(
      `${API}/festivals/${festivalId}/applications/${applicationId}`,
      {
        method: 'PATCH',
        headers: { ...auth(orgA.token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ shortlisted: false, review_flag: false, decision: 'accept' }),
      },
    )
    expect(acceptRes.status).toBe(403)
  })

  it('organiser A cannot list applications on organiser B\'s festival (403)', async () => {
    const { festivalId } = await createFestival(orgB.token, {
      name: 'B Fest List',
      slug: `b-fest-list-${SUFFIX}`,
    })

    const res = await fetch(`${API}/festivals/${festivalId}/applications`, {
      headers: auth(orgA.token),
    })
    expect(res.status).toBe(403)
  })

  // ── IDOR: new review endpoints (issue #141) ─────────────────────────────────

  it("organiser A cannot release decisions on organiser B's festival (403)", async () => {
    const { festivalId } = await createFestival(orgB.token, {
      name: 'B Waitlist Fest',
      slug: `b-wl-${SUFFIX}`,
    })
    await upsertForm(orgB.token, festivalId)
    await setFestivalStatus(orgB.token, festivalId, 'open')
    await submitApplication(artistA.token, festivalId)

    const res = await fetch(
      `${API}/festivals/${festivalId}/applications/release-decisions`,
      { method: 'POST', headers: auth(orgA.token) },
    )
    expect(res.status).toBe(403)
  })

  it("organiser A cannot patch flags on an application in organiser B's festival (403)", async () => {
    const { festivalId } = await createFestival(orgB.token, {
      name: 'B Patch Fest',
      slug: `b-patch-${SUFFIX}`,
    })
    await upsertForm(orgB.token, festivalId)
    await setFestivalStatus(orgB.token, festivalId, 'open')
    const { applicationId } = await submitApplication(artistA.token, festivalId)

    const res = await fetch(
      `${API}/festivals/${festivalId}/applications/${applicationId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...auth(orgA.token) },
        body: JSON.stringify({ shortlisted: true, review_flag: false }),
      },
    )
    expect(res.status).toBe(403)
  })

  it("organiser A cannot add notes to an application in organiser B's festival (403)", async () => {
    const { festivalId } = await createFestival(orgB.token, {
      name: 'B Notes Fest',
      slug: `b-notes-${SUFFIX}`,
    })
    await upsertForm(orgB.token, festivalId)
    await setFestivalStatus(orgB.token, festivalId, 'open')
    const { applicationId } = await submitApplication(artistA.token, festivalId)

    const res = await fetch(
      `${API}/festivals/${festivalId}/applications/${applicationId}/notes`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth(orgA.token) },
        body: JSON.stringify({ content: 'sneaky note' }),
      },
    )
    expect(res.status).toBe(403)
  })

  it("organiser A cannot reorder applications in organiser B's festival (403)", async () => {
    const { festivalId } = await createFestival(orgB.token, {
      name: 'B Reorder Fest',
      slug: `b-reorder-${SUFFIX}`,
    })
    await upsertForm(orgB.token, festivalId)
    await setFestivalStatus(orgB.token, festivalId, 'open')
    const { applicationId } = await submitApplication(artistA.token, festivalId)

    const res = await fetch(
      `${API}/festivals/${festivalId}/applications/reorder`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth(orgA.token) },
        body: JSON.stringify({ status: 'undecided', ids: [applicationId] }),
      },
    )
    expect(res.status).toBe(403)
  })

  // ── IDOR: spot CRUD on another organiser's festival (issue #219) ─────────────

  it("organiser A cannot create a spot on organiser B's festival (403)", async () => {
    const { festivalId } = await createFestival(orgB.token, {
      name: 'B Spot Create',
      slug: `b-spot-create-${SUFFIX}`,
    })
    const res = await fetch(`${API}/festivals/${festivalId}/spots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(orgA.token) },
      body: JSON.stringify({ lat: 51.9, lng: -2.07 }),
    })
    expect(res.status).toBe(403)
  })

  it("organiser A cannot update a spot on organiser B's festival (403)", async () => {
    const { festivalId } = await createFestival(orgB.token, {
      name: 'B Spot Update',
      slug: `b-spot-update-${SUFFIX}`,
    })
    const { spotId } = await createSpot(orgB.token, festivalId, 51.9, -2.07)
    const res = await fetch(`${API}/festivals/${festivalId}/spots/${spotId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth(orgA.token) },
      body: JSON.stringify({ lat: 51.8 }),
    })
    expect(res.status).toBe(403)
  })

  it("organiser A cannot delete a spot on organiser B's festival (403)", async () => {
    const { festivalId } = await createFestival(orgB.token, {
      name: 'B Spot Delete',
      slug: `b-spot-delete-${SUFFIX}`,
    })
    const { spotId } = await createSpot(orgB.token, festivalId, 51.9, -2.07)
    const res = await fetch(`${API}/festivals/${festivalId}/spots/${spotId}`, {
      method: 'DELETE',
      headers: auth(orgA.token),
    })
    expect(res.status).toBe(403)
  })

  it("organiser A cannot assign an artist to a spot on organiser B's festival (403)", async () => {
    const { festivalId } = await createFestival(orgB.token, {
      name: 'B Spot Artist',
      slug: `b-spot-artist-${SUFFIX}`,
    })
    const { spotId } = await createSpot(orgB.token, festivalId, 51.9, -2.07)
    const res = await fetch(`${API}/festivals/${festivalId}/spots/${spotId}/artist`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...auth(orgA.token) },
      body: JSON.stringify({ artist_id: artistA.userId }),
    })
    expect(res.status).toBe(403)
  })

  it("organiser A cannot clear the artist from a spot on organiser B's festival (403)", async () => {
    const { festivalId } = await createFestival(orgB.token, {
      name: 'B Spot Clear',
      slug: `b-spot-clear-${SUFFIX}`,
    })
    const { spotId } = await createSpot(orgB.token, festivalId, 51.9, -2.07)
    const res = await fetch(`${API}/festivals/${festivalId}/spots/${spotId}/artist`, {
      method: 'DELETE',
      headers: auth(orgA.token),
    })
    expect(res.status).toBe(403)
  })
})
