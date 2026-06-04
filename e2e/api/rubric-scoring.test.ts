import { describe, it, expect, beforeAll } from 'vitest'
import {
  createArtist, createOrganiser, createProfile, createFestival,
  setFestivalStatus, upsertForm, submitApplication,
} from '../fixtures/helpers.js'

const API = process.env.API_URL ?? 'http://localhost:8080'
const SUFFIX = `rubric-${Date.now()}`
const auth = (t: string) => ({ Authorization: `Bearer ${t}` })
const json = (t: string) => ({ 'Content-Type': 'application/json', ...auth(t) })

describe('rubric scoring', () => {
  let orgToken: string
  let festivalId: string
  let appId: string
  let reviewerToken: string
  let reviewer2Token: string

  beforeAll(async () => {
    const org = await createOrganiser(`${SUFFIX}-org`)
    orgToken = org.token
    const fest = await createFestival(org.token, { name: `Rubric Fest ${SUFFIX}`, slug: `rubric-${SUFFIX}` })
    festivalId = fest.festivalId
    await upsertForm(org.token, festivalId)
    await setFestivalStatus(org.token, festivalId, 'open')

    const applicant = await createArtist(`${SUFFIX}-app`)
    await createProfile(applicant.token, { displayName: `Rubric Artist ${SUFFIX}` })
    const app = await submitApplication(applicant.token, festivalId)
    appId = app.applicationId

    const reviewer = await createArtist(`${SUFFIX}-rev`)
    reviewerToken = reviewer.token
    const reviewer2 = await createArtist(`${SUFFIX}-rev2`)
    reviewer2Token = reviewer2.token

    for (const email of [reviewer.email, reviewer2.email]) {
      const inv = await fetch(`${API}/festivals/${festivalId}/reviewers`, {
        method: 'POST', headers: json(orgToken), body: JSON.stringify({ email }),
      })
      expect(inv.status).toBe(201)
    }

    // Open the review round so scoring is permitted
    const open = await fetch(`${API}/festivals/${festivalId}/review/open`, {
      method: 'POST', headers: auth(orgToken),
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
      method: 'PATCH', headers: json(orgToken),
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
      headers: auth(orgToken),
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
