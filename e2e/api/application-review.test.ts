// Application review workflow tests.
// Covers issues: #136 (waitlist), #137 (patch flags), #138 (reorder), #139 (notes), #140 (enriched list)
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
const SUFFIX = `app-review-${Date.now()}`

function auth(t: string) {
  return { Authorization: `Bearer ${t}` }
}
function json(t: string) {
  return { 'Content-Type': 'application/json', ...auth(t) }
}

describe('application review workflow', () => {
  let org: OrganiserSetup

  beforeAll(async () => {
    org = await createOrganiser(`${SUFFIX}-org`)
  })

  // ── #140: Enriched list response ────────────────────────────────────────────

  describe('enriched list response', () => {
    let festivalId: string
    let applicationId: string

    beforeAll(async () => {
      const artist = await createArtist(`${SUFFIX}-enrich-art`)
      await createProfile(artist.token, { displayName: `Enrich Artist ${SUFFIX}` })
      const fest = await createFestival(org.token, {
        name: `Enrich Fest ${SUFFIX}`,
        slug: `enrich-${SUFFIX}`,
      })
      festivalId = fest.festivalId
      await upsertForm(org.token, festivalId)
      await setFestivalStatus(org.token, festivalId, 'open')
      const app = await submitApplication(artist.token, festivalId)
      applicationId = app.applicationId
    })

    it('includes artist.display_name and medium_tags array', async () => {
      const res = await fetch(`${API}/festivals/${festivalId}/applications`, {
        headers: auth(org.token),
      })
      expect(res.status).toBe(200)
      const apps = await res.json()
      const app = apps.find((a: { id: string }) => a.id === applicationId)
      expect(app).toBeDefined()
      expect(app.artist?.display_name).toBe(`Enrich Artist ${SUFFIX}`)
      expect(Array.isArray(app.artist?.medium_tags)).toBe(true)
    })

    it('rank, shortlisted, review_flag present with correct default values', async () => {
      const res = await fetch(`${API}/festivals/${festivalId}/applications`, {
        headers: auth(org.token),
      })
      const apps = await res.json()
      const app = apps.find((a: { id: string }) => a.id === applicationId)
      expect(typeof app.rank).toBe('number')
      expect(app.rank).toBe(0)
      expect(app.shortlisted).toBe(false)
      expect(app.review_flag).toBe(false)
    })

    it('notes is [] (not null) when no notes exist', async () => {
      const res = await fetch(`${API}/festivals/${festivalId}/applications`, {
        headers: auth(org.token),
      })
      const apps = await res.json()
      const app = apps.find((a: { id: string }) => a.id === applicationId)
      expect(Array.isArray(app.notes)).toBe(true)
      expect(app.notes).toHaveLength(0)
    })
  })

  // ── #139: Application notes ─────────────────────────────────────────────────

  describe('application notes', () => {
    let festivalId: string
    let applicationId: string

    beforeAll(async () => {
      const artist = await createArtist(`${SUFFIX}-notes-art`)
      await createProfile(artist.token, { displayName: `Notes Artist ${SUFFIX}` })
      const fest = await createFestival(org.token, {
        name: `Notes Fest ${SUFFIX}`,
        slug: `notes-${SUFFIX}`,
      })
      festivalId = fest.festivalId
      await upsertForm(org.token, festivalId)
      await setFestivalStatus(org.token, festivalId, 'open')
      const app = await submitApplication(artist.token, festivalId)
      applicationId = app.applicationId
    })

    it('POST /notes with valid content → 201 with {id, content, created_at}', async () => {
      const res = await fetch(
        `${API}/festivals/${festivalId}/applications/${applicationId}/notes`,
        {
          method: 'POST',
          headers: json(org.token),
          body: JSON.stringify({ content: 'Strong portfolio.' }),
        },
      )
      expect(res.status).toBe(201)
      const note = await res.json()
      expect(typeof note.id).toBe('string')
      expect(note.content).toBe('Strong portfolio.')
      expect(typeof note.created_at).toBe('string')
    })

    it('created note appears in enriched list', async () => {
      const res = await fetch(`${API}/festivals/${festivalId}/applications`, {
        headers: auth(org.token),
      })
      const apps = await res.json()
      const app = apps.find((a: { id: string }) => a.id === applicationId)
      expect(Array.isArray(app.notes)).toBe(true)
      expect(app.notes.length).toBeGreaterThan(0)
      expect(app.notes[0].content).toBe('Strong portfolio.')
    })

    it('POST /notes with empty content → 422', async () => {
      const res = await fetch(
        `${API}/festivals/${festivalId}/applications/${applicationId}/notes`,
        {
          method: 'POST',
          headers: json(org.token),
          body: JSON.stringify({ content: '' }),
        },
      )
      expect(res.status).toBe(422)
    })

    it('POST /notes with whitespace-only content → 422', async () => {
      const res = await fetch(
        `${API}/festivals/${festivalId}/applications/${applicationId}/notes`,
        {
          method: 'POST',
          headers: json(org.token),
          body: JSON.stringify({ content: '   ' }),
        },
      )
      expect(res.status).toBe(422)
    })
  })

  // ── #137: Patch flags ───────────────────────────────────────────────────────

  describe('patch flags', () => {
    let festivalId: string
    let applicationId: string

    beforeAll(async () => {
      const artist = await createArtist(`${SUFFIX}-patch-art`)
      await createProfile(artist.token, { displayName: `Patch Artist ${SUFFIX}` })
      const fest = await createFestival(org.token, {
        name: `Patch Fest ${SUFFIX}`,
        slug: `patch-${SUFFIX}`,
      })
      festivalId = fest.festivalId
      await upsertForm(org.token, festivalId)
      await setFestivalStatus(org.token, festivalId, 'open')
      const app = await submitApplication(artist.token, festivalId)
      applicationId = app.applicationId
    })

    it('PATCH {shortlisted: true, review_flag: false} → 200 with updated values', async () => {
      const res = await fetch(
        `${API}/festivals/${festivalId}/applications/${applicationId}`,
        {
          method: 'PATCH',
          headers: json(org.token),
          body: JSON.stringify({ shortlisted: true, review_flag: false }),
        },
      )
      expect(res.status).toBe(200)
      const updated = await res.json()
      expect(updated.shortlisted).toBe(true)
      expect(updated.review_flag).toBe(false)
    })

    it('shortlisted flag persists in subsequent list', async () => {
      const res = await fetch(`${API}/festivals/${festivalId}/applications`, {
        headers: auth(org.token),
      })
      const apps = await res.json()
      const app = apps.find((a: { id: string }) => a.id === applicationId)
      expect(app?.shortlisted).toBe(true)
    })

    it('PATCH toggles review_flag to true → 200 with updated value', async () => {
      const res = await fetch(
        `${API}/festivals/${festivalId}/applications/${applicationId}`,
        {
          method: 'PATCH',
          headers: json(org.token),
          body: JSON.stringify({ shortlisted: true, review_flag: true }),
        },
      )
      expect(res.status).toBe(200)
      expect((await res.json()).review_flag).toBe(true)
    })
  })

  // ── #136: Waitlist ──────────────────────────────────────────────────────────

  describe('waitlist', () => {
    let artist: ArtistSetup
    let festivalId: string
    let applicationId: string

    beforeAll(async () => {
      artist = await createArtist(`${SUFFIX}-wl-art`)
      await createProfile(artist.token, { displayName: `WL Artist ${SUFFIX}` })
      const fest = await createFestival(org.token, {
        name: `WL Fest ${SUFFIX}`,
        slug: `wl-${SUFFIX}`,
      })
      festivalId = fest.festivalId
      await upsertForm(org.token, festivalId)
      await setFestivalStatus(org.token, festivalId, 'open')
      const app = await submitApplication(artist.token, festivalId)
      applicationId = app.applicationId
    })

    it('POST /waitlist → 200 with status: waitlisted', async () => {
      const res = await fetch(
        `${API}/festivals/${festivalId}/applications/${applicationId}/waitlist`,
        { method: 'POST', headers: auth(org.token) },
      )
      expect(res.status).toBe(200)
      expect((await res.json()).status).toBe('waitlisted')
    })

    it("waitlisted status visible in artist's GET /me/applications", async () => {
      const res = await fetch(`${API}/me/applications`, {
        headers: auth(artist.token),
      })
      expect(res.status).toBe(200)
      const apps = await res.json()
      const mine = apps.find((a: { id: string }) => a.id === applicationId)
      expect(mine?.status).toBe('waitlisted')
    })
  })

  // ── #138: Reorder ───────────────────────────────────────────────────────────

  describe('reorder', () => {
    let festivalId: string
    let appA: string
    let appB: string

    beforeAll(async () => {
      const artistA = await createArtist(`${SUFFIX}-ro-a`)
      const artistB = await createArtist(`${SUFFIX}-ro-b`)
      await createProfile(artistA.token, { displayName: `Reorder A ${SUFFIX}` })
      await createProfile(artistB.token, { displayName: `Reorder B ${SUFFIX}` })
      const fest = await createFestival(org.token, {
        name: `Reorder Fest ${SUFFIX}`,
        slug: `reorder-${SUFFIX}`,
      })
      festivalId = fest.festivalId
      await upsertForm(org.token, festivalId)
      await setFestivalStatus(org.token, festivalId, 'open')
      const r1 = await submitApplication(artistA.token, festivalId)
      const r2 = await submitApplication(artistB.token, festivalId)
      appA = r1.applicationId
      appB = r2.applicationId
    })

    it('POST /reorder with empty ids → 204 (no-op)', async () => {
      const res = await fetch(`${API}/festivals/${festivalId}/applications/reorder`, {
        method: 'POST',
        headers: json(org.token),
        body: JSON.stringify({ status: 'submitted', ids: [] }),
      })
      expect(res.status).toBe(204)
    })

    it('POST /reorder sets rank order, reflected in GET /applications', async () => {
      // Put B before A
      const reorderRes = await fetch(`${API}/festivals/${festivalId}/applications/reorder`, {
        method: 'POST',
        headers: json(org.token),
        body: JSON.stringify({ status: 'submitted', ids: [appB, appA] }),
      })
      expect(reorderRes.status).toBe(204)

      const listRes = await fetch(`${API}/festivals/${festivalId}/applications`, {
        headers: auth(org.token),
      })
      const apps = await listRes.json()
      const rankB = apps.find((a: { id: string }) => a.id === appB)?.rank
      const rankA = apps.find((a: { id: string }) => a.id === appA)?.rank
      expect(rankB).toBe(0)
      expect(rankA).toBe(1)
    })

    it('POST /reorder with invalid status → 400', async () => {
      const res = await fetch(`${API}/festivals/${festivalId}/applications/reorder`, {
        method: 'POST',
        headers: json(org.token),
        body: JSON.stringify({ status: 'not-a-status', ids: [appA] }),
      })
      expect(res.status).toBe(400)
    })

    it('POST /reorder with malformed UUID in ids → 400', async () => {
      const res = await fetch(`${API}/festivals/${festivalId}/applications/reorder`, {
        method: 'POST',
        headers: json(org.token),
        body: JSON.stringify({ status: 'submitted', ids: ['not-a-uuid'] }),
      })
      expect(res.status).toBe(400)
    })
  })
})

// ── Staged decisions ─────────────────────────────────────────────────────────

describe('staged decisions', () => {
  const suffix = `staged-${Date.now()}`
  let org: OrganiserSetup
  let artist: ArtistSetup
  let festivalId: string
  let applicationId: string

  beforeAll(async () => {
    org = await createOrganiser(`${suffix}-org`)
    artist = await createArtist(`${suffix}-art`)
    await createProfile(artist.token, { displayName: `Staged Artist ${suffix}` })
    const fest = await createFestival(org.token, {
      name: `Staged Fest ${suffix}`,
      slug: suffix,
    })
    festivalId = fest.festivalId
    await upsertForm(org.token, festivalId)
    await setFestivalStatus(org.token, festivalId, 'open')
    const app = await submitApplication(artist.token, festivalId)
    applicationId = app.applicationId
  })

  it('stages a decision via PATCH and returns it in the list', async () => {
    const patchRes = await fetch(`${API}/festivals/${festivalId}/applications/${applicationId}`, {
      method: 'PATCH',
      headers: json(org.token),
      body: JSON.stringify({ shortlisted: false, review_flag: false, staged_decision: 'accept' }),
    })
    expect(patchRes.status).toBe(200)
    const patched = await patchRes.json()
    expect(patched.staged_decision).toBe('accept')
    expect(patched.status).toBe('submitted') // status unchanged until release

    const listRes = await fetch(`${API}/festivals/${festivalId}/applications`, {
      headers: auth(org.token),
    })
    const apps = await listRes.json()
    const found = apps.find((a: { id: string }) => a.id === applicationId)
    expect(found.staged_decision).toBe('accept')
  })

  it('clears a staged decision by patching null', async () => {
    const res = await fetch(`${API}/festivals/${festivalId}/applications/${applicationId}`, {
      method: 'PATCH',
      headers: json(org.token),
      body: JSON.stringify({ shortlisted: false, review_flag: false, staged_decision: null }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.staged_decision).toBeNull()
  })

  it('releases decisions: bulk updates status, clears staged_decision', async () => {
    // Stage again before releasing
    await fetch(`${API}/festivals/${festivalId}/applications/${applicationId}`, {
      method: 'PATCH',
      headers: json(org.token),
      body: JSON.stringify({ shortlisted: false, review_flag: false, staged_decision: 'accept' }),
    })

    const releaseRes = await fetch(
      `${API}/festivals/${festivalId}/applications/release-decisions`,
      {
        method: 'POST',
        headers: auth(org.token),
      },
    )
    expect(releaseRes.status).toBe(200)
    const body = await releaseRes.json()
    expect(body.released).toBe(1)

    // Verify application status updated and staged_decision cleared
    const listRes = await fetch(`${API}/festivals/${festivalId}/applications`, {
      headers: auth(org.token),
    })
    const apps = await listRes.json()
    const app = apps.find((a: { id: string }) => a.id === applicationId)
    expect(app.status).toBe('accepted')
    expect(app.staged_decision).toBeNull()
  })

  it('returns 409 on second release attempt', async () => {
    const res = await fetch(
      `${API}/festivals/${festivalId}/applications/release-decisions`,
      {
        method: 'POST',
        headers: auth(org.token),
      },
    )
    expect(res.status).toBe(409)
  })

  it('decisions_released_at is set on the festival after release', async () => {
    const res = await fetch(`${API}/festivals/${festivalId}`, {
      headers: auth(org.token),
    })
    const fest = await res.json()
    expect(fest.decisions_released_at).not.toBeNull()
    expect(typeof fest.decisions_released_at).toBe('string')
  })

  it('returns 422 when releasing with undecided submitted applications', async () => {
    const freshSuffix = `staged-undecided-${Date.now()}`
    const org3 = await createOrganiser(`${freshSuffix}-org`)
    const artist3 = await createArtist(`${freshSuffix}-art`)
    await createProfile(artist3.token, { displayName: `Undecided Artist ${freshSuffix}` })
    const fest3 = await createFestival(org3.token, {
      name: `Undecided Fest ${freshSuffix}`,
      slug: freshSuffix,
    })
    await upsertForm(org3.token, fest3.festivalId)
    await setFestivalStatus(org3.token, fest3.festivalId, 'open')
    await submitApplication(artist3.token, fest3.festivalId)

    // Attempt release without staging any decisions
    const res = await fetch(
      `${API}/festivals/${fest3.festivalId}/applications/release-decisions`,
      { method: 'POST', headers: auth(org3.token) },
    )
    expect(res.status).toBe(422)
  })

  it('rejects invalid staged_decision value with 400', async () => {
    const freshSuffix = `staged-bad-${Date.now()}`
    const org2 = await createOrganiser(`${freshSuffix}-org`)
    const artist2 = await createArtist(`${freshSuffix}-art`)
    await createProfile(artist2.token, { displayName: `Bad Artist ${freshSuffix}` })
    const fest2 = await createFestival(org2.token, {
      name: `Bad Fest ${freshSuffix}`,
      slug: freshSuffix,
    })
    await upsertForm(org2.token, fest2.festivalId)
    await setFestivalStatus(org2.token, fest2.festivalId, 'open')
    const app2 = await submitApplication(artist2.token, fest2.festivalId)

    const res = await fetch(
      `${API}/festivals/${fest2.festivalId}/applications/${app2.applicationId}`,
      {
        method: 'PATCH',
        headers: json(org2.token),
        body: JSON.stringify({ shortlisted: false, review_flag: false, staged_decision: 'invalid' }),
      },
    )
    expect(res.status).toBe(400)
  })
})
