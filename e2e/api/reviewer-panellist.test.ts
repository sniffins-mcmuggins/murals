import { describe, it, expect, beforeAll } from 'vitest'
import {
  createArtist, createOrganiser, createProfile, createFestival,
  setFestivalStatus, upsertForm, submitApplication,
} from '../fixtures/helpers.js'

const API = process.env.API_URL ?? 'http://localhost:8080'
const SUFFIX = `reviewer-${Date.now()}`
const auth = (t: string) => ({ Authorization: `Bearer ${t}` })
const json = (t: string) => ({ 'Content-Type': 'application/json', ...auth(t) })

describe('festival reviewer / panellist accounts', () => {
  let orgToken: string
  let festivalId: string
  let appId: string
  let reviewerToken: string
  let reviewerEmail: string

  beforeAll(async () => {
    const org = await createOrganiser(`${SUFFIX}-org`)
    orgToken = org.token
    const fest = await createFestival(org.token, { name: `Rev Fest ${SUFFIX}`, slug: `rev-${SUFFIX}` })
    festivalId = fest.festivalId
    await upsertForm(org.token, festivalId)
    await setFestivalStatus(org.token, festivalId, 'open')

    const applicant = await createArtist(`${SUFFIX}-applicant`)
    await createProfile(applicant.token, { displayName: `Applicant ${SUFFIX}` })
    const app = await submitApplication(applicant.token, festivalId)
    appId = app.applicationId

    const reviewer = await createArtist(`${SUFFIX}-reviewer`)
    reviewerToken = reviewer.token
    reviewerEmail = reviewer.email
  })

  it('unauthenticated → 401 on reviewer + score + me/reviewing endpoints', async () => {
    expect((await fetch(`${API}/festivals/${festivalId}/reviewers`)).status).toBe(401)
    expect((await fetch(`${API}/me/reviewing`)).status).toBe(401)
    const s = await fetch(`${API}/festivals/${festivalId}/applications/${appId}/score`, { method: 'PUT' })
    expect(s.status).toBe(401)
  })

  it('non-owner cannot invite reviewers → 403', async () => {
    const res = await fetch(`${API}/festivals/${festivalId}/reviewers`, {
      method: 'POST', headers: json(reviewerToken),
      body: JSON.stringify({ email: 'x@e2e.test' }),
    })
    expect(res.status).toBe(403)
  })

  it('owner invites a reviewer (existing user) → 201', async () => {
    const res = await fetch(`${API}/festivals/${festivalId}/reviewers`, {
      method: 'POST', headers: json(orgToken),
      body: JSON.stringify({ email: reviewerEmail }),
    })
    expect(res.status).toBe(201)
  })

  // Phase 1 keystone: anonymisation is gone. Even if a legacy anonymous_review
  // flag is set, reviewers see the real identity before scoring.
  it('reviewer sees real artist identity before scoring (no anonymisation)', async () => {
    // Attempt to turn on the legacy flag — after Phase 1 this field is ignored.
    await fetch(`${API}/festivals/${festivalId}/form`, {
      method: 'PATCH', headers: json(orgToken),
      body: JSON.stringify({ anonymous_review: true }),
    })

    const list = await fetch(`${API}/festivals/${festivalId}/applications`, { headers: auth(reviewerToken) })
    expect(list.status).toBe(200)
    const apps = await list.json()
    const app = apps.find((a: { id: string }) => a.id === appId)
    expect(app).toBeDefined()
    // Real name visible pre-score (this reviewer has not scored appId yet at this point).
    expect(app.artist?.display_name).toBe(`Applicant ${SUFFIX}`)
    // The identity_hidden field is removed entirely.
    expect(app.identity_hidden).toBeUndefined()
  })

  it('reviewer sees applications and can score → 200', async () => {
    const list = await fetch(`${API}/festivals/${festivalId}/applications`, { headers: auth(reviewerToken) })
    expect(list.status).toBe(200)
    const score = await fetch(`${API}/festivals/${festivalId}/applications/${appId}/score`, {
      method: 'PUT', headers: json(reviewerToken), body: JSON.stringify({ score: 4 }),
    })
    expect(score.status).toBe(200)
  })

  // Phase 2 leak-seal: the reviewer's application list must NOT carry any
  // organiser decision data. This is the most important test in this phase.
  it('reviewer list response omits all decision fields', async () => {
    const res = await fetch(`${API}/festivals/${festivalId}/applications`, { headers: auth(reviewerToken) })
    expect(res.status).toBe(200)
    const apps = await res.json()
    const app = apps.find((a: { id: string }) => a.id === appId)
    expect(app).toBeDefined()
    // Decision fields must be absent from the reviewer shape.
    expect(app.staged_decision).toBeUndefined()
    expect(app.shortlisted).toBeUndefined()
    expect(app.review_flag).toBeUndefined()
    expect(app.rank).toBeUndefined()
    expect(app.notes).toBeUndefined()
    expect(app.status).toBeUndefined()
    expect(app.updated_at).toBeUndefined()
    // Scoring-relevant fields remain.
    expect(app.artist?.display_name).toBeDefined()
    expect(Array.isArray(app.criterion_scores)).toBe(true)
  })

  // Owner shape is unchanged — decision fields still present for the organiser.
  it('owner list response still includes decision fields', async () => {
    const res = await fetch(`${API}/festivals/${festivalId}/applications`, { headers: auth(orgToken) })
    const apps = await res.json()
    const app = apps.find((a: { id: string }) => a.id === appId)
    expect(app.shortlisted).toBeDefined()
    expect(Array.isArray(app.notes)).toBe(true)
  })

  // The advisory-boundary canary — the most important test in this suite.
  it('reviewer CANNOT accept / decline / reorder / patch → 403', async () => {
    const accept = await fetch(`${API}/festivals/${festivalId}/applications/${appId}/accept`, { method: 'POST', headers: auth(reviewerToken) })
    expect(accept.status).toBe(403)
    const decline = await fetch(`${API}/festivals/${festivalId}/applications/${appId}/decline`, { method: 'POST', headers: auth(reviewerToken) })
    expect(decline.status).toBe(403)
    const reorder = await fetch(`${API}/festivals/${festivalId}/applications/reorder`, {
      method: 'POST', headers: json(reviewerToken), body: JSON.stringify({ status: 'submitted', ids: [appId] }),
    })
    expect(reorder.status).toBe(403)
    const patch = await fetch(`${API}/festivals/${festivalId}/applications/${appId}`, {
      method: 'PATCH', headers: json(reviewerToken), body: JSON.stringify({ shortlisted: true, review_flag: false }),
    })
    expect(patch.status).toBe(403)
  })

  // sqlc Scan canary — avg must appear non-zero in the owner's list JSON.
  it('two reviewers score; avg_score appears non-zero for the owner', async () => {
    const reviewer2 = await createArtist(`${SUFFIX}-reviewer2`)
    await fetch(`${API}/festivals/${festivalId}/reviewers`, {
      method: 'POST', headers: json(orgToken), body: JSON.stringify({ email: reviewer2.email }),
    })
    await fetch(`${API}/festivals/${festivalId}/applications/${appId}/score`, {
      method: 'PUT', headers: json(reviewer2.token), body: JSON.stringify({ score: 2 }),
    })
    const list = await fetch(`${API}/festivals/${festivalId}/applications`, { headers: auth(orgToken) })
    const apps = await list.json()
    const a = apps.find((x: { id: string }) => x.id === appId)
    expect(a.score_count).toBe(2)
    expect(a.avg_score).toBeGreaterThan(0)      // (4 + 2) / 2 = 3
    expect(a.avg_score).toBeCloseTo(3, 5)
  })

  it('reviewer who is also an applicant cannot see/score own application (COI)', async () => {
    const dual = await createArtist(`${SUFFIX}-dual`)
    await createProfile(dual.token, { displayName: `Dual ${SUFFIX}` })
    const dualApp = await submitApplication(dual.token, festivalId)
    await fetch(`${API}/festivals/${festivalId}/reviewers`, {
      method: 'POST', headers: json(orgToken), body: JSON.stringify({ email: dual.email }),
    })
    const list = await fetch(`${API}/festivals/${festivalId}/applications`, { headers: auth(dual.token) })
    const apps = await list.json()
    expect(apps.find((x: { id: string }) => x.id === dualApp.applicationId)).toBeUndefined()
    const score = await fetch(`${API}/festivals/${festivalId}/applications/${dualApp.applicationId}/score`, {
      method: 'PUT', headers: json(dual.token), body: JSON.stringify({ score: 5 }),
    })
    expect(score.status).toBe(403)
  })

  it('concurrent score upsert from one reviewer → one row, both 200', async () => {
    const [r1, r2] = await Promise.all([
      fetch(`${API}/festivals/${festivalId}/applications/${appId}/score`, { method: 'PUT', headers: json(reviewerToken), body: JSON.stringify({ score: 5 }) }),
      fetch(`${API}/festivals/${festivalId}/applications/${appId}/score`, { method: 'PUT', headers: json(reviewerToken), body: JSON.stringify({ score: 3 }) }),
    ])
    expect([r1.status, r2.status]).toEqual([200, 200])
    // still exactly one score row for this reviewer → score_count is 2 (reviewer1 + reviewer2)
    const list = await fetch(`${API}/festivals/${festivalId}/applications`, { headers: auth(orgToken) })
    const apps = await list.json()
    const a = apps.find((x: { id: string }) => x.id === appId)
    expect(a.score_count).toBe(2)
  })

  it('reviewer appears in GET /me/reviewing', async () => {
    const res = await fetch(`${API}/me/reviewing`, { headers: auth(reviewerToken) })
    expect(res.status).toBe(200)
    const fests = await res.json()
    expect(fests.some((f: { id: string }) => f.id === festivalId)).toBe(true)
  })
})
