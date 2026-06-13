// Reviewer/panellist accounts, the review-round lifecycle, and rubric scoring.
//
// Merged from the former reviewer-panellist.test.ts + rubric-scoring.test.ts.
// Both suites built an identical org+festival+form+applicant+reviewers+open-round
// scaffold; they now share a single organiser. Each sub-suite still owns its own
// festival/applicant/reviewers because the score_count / avg_score assertions
// depend on an isolated set of scores per application.
import { describe, it, expect, beforeAll } from 'vitest'
import {
  createArtist, createOrganiser, createProfile, createFestival,
  setFestivalStatus, upsertForm, submitApplication,
  OrganiserSetup, ArtistSetup,
} from '../fixtures/helpers.js'

const API = process.env.API_URL ?? 'http://localhost:8080'
const SUFFIX = `revscore-${Date.now()}`
const auth = (t: string) => ({ Authorization: `Bearer ${t}` })
const json = (t: string) => ({ 'Content-Type': 'application/json', ...auth(t) })

describe('reviewer scoring & panellist', () => {
  // One organiser owns both sub-suites' festivals (cuts a signup+login).
  let org: OrganiserSetup

  beforeAll(async () => {
    org = await createOrganiser(`${SUFFIX}-org`)
  })

  describe('festival reviewer / panellist accounts', () => {
    let festivalId: string
    let appId: string
    let reviewerToken: string
    let reviewerEmail: string

    beforeAll(async () => {
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

      // Open the review round so reviewers can score in the tests below.
      // (The dedicated 'review round gating' describe block exercises the
      // not_started / open / closed transitions on a separate festival.)
      await fetch(`${API}/festivals/${festivalId}/review/open`, { method: 'POST', headers: auth(org.token) })
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
        method: 'POST', headers: json(org.token),
        body: JSON.stringify({ email: reviewerEmail }),
      })
      expect(res.status).toBe(201)
    })

    // Phase 1 keystone: anonymisation is gone. Even if a legacy anonymous_review
    // flag is set, reviewers see the real identity before scoring.
    it('reviewer sees real artist identity before scoring (no anonymisation)', async () => {
      // Attempt to turn on the legacy flag — after Phase 1 this field is ignored.
      await fetch(`${API}/festivals/${festivalId}/form`, {
        method: 'PATCH', headers: json(org.token),
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
      expect(app.decision).toBeUndefined()
      expect(app.released_at).toBeUndefined()
      expect(app.shortlisted).toBeUndefined()
      expect(app.review_flag).toBeUndefined()
      expect(app.rank).toBeUndefined()
      expect(app.notes).toBeUndefined()
      expect(app.updated_at).toBeUndefined()
      // Scoring-relevant fields remain.
      expect(app.artist?.display_name).toBeDefined()
      expect(Array.isArray(app.criterion_scores)).toBe(true)
    })

    it('ApplicationArtist carries id in both organiser and reviewer responses', async () => {
      // Organiser view
      const orgRes = await fetch(`${API}/festivals/${festivalId}/applications`, { headers: auth(org.token) })
      const orgApps = await orgRes.json()
      const orgApp = orgApps.find((a: { id: string }) => a.id === appId)
      expect(orgApp?.artist?.id).toBeDefined()
      expect(typeof orgApp?.artist?.id).toBe('string')

      // Reviewer view
      const revRes = await fetch(`${API}/festivals/${festivalId}/applications`, { headers: auth(reviewerToken) })
      const revApps = await revRes.json()
      const revApp = revApps.find((a: { id: string }) => a.id === appId)
      expect(revApp?.artist?.id).toBeDefined()
      expect(typeof revApp?.artist?.id).toBe('string')
    })

    // Owner shape is unchanged — decision fields still present for the organiser.
    it('owner list response still includes decision fields', async () => {
      const res = await fetch(`${API}/festivals/${festivalId}/applications`, { headers: auth(org.token) })
      const apps = await res.json()
      const app = apps.find((a: { id: string }) => a.id === appId)
      expect(app.shortlisted).toBeDefined()
      expect(Array.isArray(app.notes)).toBe(true)
    })

    // The advisory-boundary canary — the most important test in this suite.
    it('reviewer CANNOT decide / release / reorder / patch → 403', async () => {
      const decide = await fetch(`${API}/festivals/${festivalId}/applications/${appId}`, {
        method: 'PATCH', headers: json(reviewerToken), body: JSON.stringify({ shortlisted: false, review_flag: false, decision: 'accept' }),
      })
      expect(decide.status).toBe(403)
      const release = await fetch(`${API}/festivals/${festivalId}/applications/release-decisions`, { method: 'POST', headers: auth(reviewerToken) })
      expect(release.status).toBe(403)
      const reorder = await fetch(`${API}/festivals/${festivalId}/applications/reorder`, {
        method: 'POST', headers: json(reviewerToken), body: JSON.stringify({ status: 'undecided', ids: [appId] }),
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
        method: 'POST', headers: json(org.token), body: JSON.stringify({ email: reviewer2.email }),
      })
      await fetch(`${API}/festivals/${festivalId}/applications/${appId}/score`, {
        method: 'PUT', headers: json(reviewer2.token), body: JSON.stringify({ score: 2 }),
      })
      const list = await fetch(`${API}/festivals/${festivalId}/applications`, { headers: auth(org.token) })
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
        method: 'POST', headers: json(org.token), body: JSON.stringify({ email: dual.email }),
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
      const list = await fetch(`${API}/festivals/${festivalId}/applications`, { headers: auth(org.token) })
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

    describe('review round gating', () => {
      let rFest: string
      let rApp: string
      let rReviewer: ArtistSetup

      beforeAll(async () => {
        const f = await createFestival(org.token, { name: `RR Fest ${SUFFIX}`, slug: `rr-${SUFFIX}` })
        rFest = f.festivalId
        await upsertForm(org.token, rFest)
        await setFestivalStatus(org.token, rFest, 'open')
        const applicant = await createArtist(`${SUFFIX}-rr-applicant`)
        await createProfile(applicant.token, { displayName: `RR Applicant ${SUFFIX}` })
        rApp = (await submitApplication(applicant.token, rFest)).applicationId
        rReviewer = await createArtist(`${SUFFIX}-rr-reviewer`)
        await fetch(`${API}/festivals/${rFest}/reviewers`, {
          method: 'POST', headers: json(org.token), body: JSON.stringify({ email: rReviewer.email }),
        })
      })

      it('reviewer cannot score before the round opens → 409', async () => {
        const res = await fetch(`${API}/festivals/${rFest}/applications/${rApp}/score`, {
          method: 'PUT', headers: json(rReviewer.token), body: JSON.stringify({ score: 4 }),
        })
        expect(res.status).toBe(409)
      })

      it('owner opens the round → 200 and review_status=open', async () => {
        const open = await fetch(`${API}/festivals/${rFest}/review/open`, { method: 'POST', headers: auth(org.token) })
        expect(open.status).toBe(200)
        const fest = await (await fetch(`${API}/festivals/${rFest}`, { headers: auth(org.token) })).json()
        expect(fest.review_status).toBe('open')
      })

      it('reviewer can score while open; owner CANNOT stage a decision → 409', async () => {
        const score = await fetch(`${API}/festivals/${rFest}/applications/${rApp}/score`, {
          method: 'PUT', headers: json(rReviewer.token), body: JSON.stringify({ score: 4 }),
        })
        expect(score.status).toBe(200)
        const stage = await fetch(`${API}/festivals/${rFest}/applications/${rApp}`, {
          method: 'PATCH', headers: json(org.token), body: JSON.stringify({ shortlisted: false, review_flag: false, decision: 'accept' }),
        })
        expect(stage.status).toBe(409)
      })

      it('owner closes the round (force-close ok) → kanban unlocks, reviewer scoring 409', async () => {
        const close = await fetch(`${API}/festivals/${rFest}/review/close`, { method: 'POST', headers: auth(org.token) })
        expect(close.status).toBe(200)
        // Decisions now allowed.
        const stage = await fetch(`${API}/festivals/${rFest}/applications/${rApp}`, {
          method: 'PATCH', headers: json(org.token), body: JSON.stringify({ shortlisted: false, review_flag: false, decision: 'accept' }),
        })
        expect(stage.status).toBe(200)
        // Reviewer can no longer score.
        const score = await fetch(`${API}/festivals/${rFest}/applications/${rApp}/score`, {
          method: 'PUT', headers: json(rReviewer.token), body: JSON.stringify({ score: 5 }),
        })
        expect(score.status).toBe(409)
      })
    })
  })

  describe('rubric scoring', () => {
    let festivalId: string
    let appId: string
    let reviewerToken: string
    let reviewer2Token: string

    beforeAll(async () => {
      const fest = await createFestival(org.token, { name: `Rubric Fest ${SUFFIX}`, slug: `rubric-${SUFFIX}` })
      festivalId = fest.festivalId
      await upsertForm(org.token, festivalId)
      await setFestivalStatus(org.token, festivalId, 'open')

      const applicant = await createArtist(`${SUFFIX}-rubapp`)
      await createProfile(applicant.token, { displayName: `Rubric Artist ${SUFFIX}` })
      const app = await submitApplication(applicant.token, festivalId)
      appId = app.applicationId

      const reviewer = await createArtist(`${SUFFIX}-rubrev`)
      reviewerToken = reviewer.token
      const reviewer2 = await createArtist(`${SUFFIX}-rubrev2`)
      reviewer2Token = reviewer2.token

      for (const email of [reviewer.email, reviewer2.email]) {
        const inv = await fetch(`${API}/festivals/${festivalId}/reviewers`, {
          method: 'POST', headers: json(org.token), body: JSON.stringify({ email }),
        })
        expect(inv.status).toBe(201)
      }

      // Open the review round so scoring is permitted
      const open = await fetch(`${API}/festivals/${festivalId}/review/open`, {
        method: 'POST', headers: auth(org.token),
      })
      expect(open.status).toBe(200)
    })

    it('non-owner cannot PATCH review_criteria → 403', async () => {
      const res = await fetch(`${API}/festivals/${festivalId}/form`, {
        method: 'PATCH', headers: json(reviewerToken),
        body: JSON.stringify({ review_criteria: [{ label: 'X', min: 1, max: 5 }] }),
      })
      expect(res.status).toBe(403)
    })

    it('owner adds two criteria → form response includes them with generated IDs', async () => {
      const res = await fetch(`${API}/festivals/${festivalId}/form`, {
        method: 'PATCH', headers: json(org.token),
        body: JSON.stringify({ review_criteria: [
          { label: 'Artistic Quality', min: 1, max: 5 },
          { label: 'Feasibility', min: 1, max: 5 },
        ]}),
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.review_criteria).toHaveLength(2)
      expect(body.review_criteria[0].id).toBeTruthy()
      expect(body.review_criteria[0].label).toBe('Artistic Quality')
    })

    it('reviewer scores a named criterion → 200, response has criterion_id', async () => {
      const res = await fetch(`${API}/festivals/${festivalId}/applications/${appId}/score`, {
        method: 'PUT', headers: json(reviewerToken),
        body: JSON.stringify({ score: 4, criterion_id: 'artistic-quality' }),
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.criterion_id).toBe('artistic-quality')
      expect(body.score).toBe(4)
    })

    it('unknown criterion_id → 422', async () => {
      const res = await fetch(`${API}/festivals/${festivalId}/applications/${appId}/score`, {
        method: 'PUT', headers: json(reviewerToken),
        body: JSON.stringify({ score: 3, criterion_id: 'does-not-exist' }),
      })
      expect(res.status).toBe(422)
    })

    it('no criterion_id defaults to overall → 200', async () => {
      const res = await fetch(`${API}/festivals/${festivalId}/applications/${appId}/score`, {
        method: 'PUT', headers: json(reviewerToken),
        body: JSON.stringify({ score: 3 }),
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.criterion_id).toBe('overall')
    })

    it('two reviewers score → criterion_scores avg is non-zero (sqlc canary)', async () => {
      const s = await fetch(`${API}/festivals/${festivalId}/applications/${appId}/score`, {
        method: 'PUT', headers: json(reviewer2Token),
        body: JSON.stringify({ score: 2, criterion_id: 'artistic-quality' }),
      })
      expect(s.status).toBe(200)

      const res = await fetch(`${API}/festivals/${festivalId}/applications`, {
        headers: auth(org.token),
      })
      const apps = await res.json()
      const target = apps.find((a: { id: string }) => a.id === appId)
      expect(target).toBeDefined()
      const cs = target.criterion_scores.find((c: { criterion_id: string }) => c.criterion_id === 'artistic-quality')
      expect(cs).toBeDefined()
      expect(cs.avg_score).toBeGreaterThan(0)
      expect(cs.score_count).toBe(2)
    })

    it('unauthenticated PATCH /form → 401', async () => {
      const res = await fetch(`${API}/festivals/${festivalId}/form`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ review_criteria: [] }),
      })
      expect(res.status).toBe(401)
    })
  })
})
