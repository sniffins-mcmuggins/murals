import { describe, it, expect, beforeAll } from 'vitest'
import {
  createArtist, createOrganiser, createProfile, createFestival,
  setFestivalStatus, upsertForm, submitApplication,
} from '../fixtures/helpers.js'

const API = process.env.API_URL ?? 'http://localhost:8080'
const SUFFIX = `anon-${Date.now()}`
const auth = (t: string) => ({ Authorization: `Bearer ${t}` })
const json = (t: string) => ({ 'Content-Type': 'application/json', ...auth(t) })

describe('anonymous review', () => {
  let orgToken: string
  let festivalId: string
  let appId: string
  let reviewerToken: string

  beforeAll(async () => {
    const org = await createOrganiser(`${SUFFIX}-org`)
    orgToken = org.token
    const fest = await createFestival(org.token, { name: `Anon Fest ${SUFFIX}`, slug: `anon-${SUFFIX}` })
    festivalId = fest.festivalId
    await upsertForm(org.token, festivalId)
    await setFestivalStatus(org.token, festivalId, 'open')

    const applicant = await createArtist(`${SUFFIX}-applicant`)
    await createProfile(applicant.token, { displayName: `Real Name ${SUFFIX}` })
    const app = await submitApplication(applicant.token, festivalId)
    appId = app.applicationId

    const reviewer = await createArtist(`${SUFFIX}-reviewer`)
    reviewerToken = reviewer.token

    // Invite reviewer
    const inv = await fetch(`${API}/festivals/${festivalId}/reviewers`, {
      method: 'POST', headers: json(orgToken),
      body: JSON.stringify({ email: reviewer.email }),
    })
    expect(inv.status).toBe(201)
  })

  it('unauthenticated PATCH /form → 401', async () => {
    const res = await fetch(`${API}/festivals/${festivalId}/form`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ anonymous_review: true }),
    })
    expect(res.status).toBe(401)
  })

  it('non-owner cannot PATCH form anonymous_review → 403', async () => {
    const res = await fetch(`${API}/festivals/${festivalId}/form`, {
      method: 'PATCH', headers: json(reviewerToken),
      body: JSON.stringify({ anonymous_review: true }),
    })
    expect(res.status).toBe(403)
  })

  it('owner enables anonymous_review → form returns true', async () => {
    const res = await fetch(`${API}/festivals/${festivalId}/form`, {
      method: 'PATCH', headers: json(orgToken),
      body: JSON.stringify({ anonymous_review: true }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.anonymous_review).toBe(true)
  })

  it('reviewer (unscored) fetches applications → identity_hidden=true, display_name=""', async () => {
    const res = await fetch(`${API}/festivals/${festivalId}/applications`, {
      headers: auth(reviewerToken),
    })
    expect(res.status).toBe(200)
    const apps = await res.json()
    expect(apps).toHaveLength(1)
    expect(apps[0].identity_hidden).toBe(true)
    expect(apps[0].artist.display_name).toBe('')
    expect(apps[0].artist.avatar_s3_key).toBeNull()
    expect(apps[0].artist.location_label).toBeNull()
  })

  it('owner fetches applications → identity_hidden=false, real name visible', async () => {
    const res = await fetch(`${API}/festivals/${festivalId}/applications`, {
      headers: auth(orgToken),
    })
    expect(res.status).toBe(200)
    const apps = await res.json()
    expect(apps).toHaveLength(1)
    expect(apps[0].identity_hidden).toBe(false)
    expect(apps[0].artist.display_name).toContain('Real Name')
  })

  it('reviewer scores → subsequent fetch returns identity_hidden=false and real name', async () => {
    const score = await fetch(`${API}/festivals/${festivalId}/applications/${appId}/score`, {
      method: 'PUT', headers: json(reviewerToken),
      body: JSON.stringify({ score: 4 }),
    })
    expect(score.status).toBe(200)

    const res = await fetch(`${API}/festivals/${festivalId}/applications`, {
      headers: auth(reviewerToken),
    })
    expect(res.status).toBe(200)
    const apps = await res.json()
    expect(apps[0].identity_hidden).toBe(false)
    expect(apps[0].artist.display_name).toContain('Real Name')
  })

  it('owner disables anonymous_review → unscored second reviewer sees full identity', async () => {
    // Use a fresh reviewer who hasn't scored
    const reviewer2 = await createArtist(`${SUFFIX}-reviewer2`)
    const inv2 = await fetch(`${API}/festivals/${festivalId}/reviewers`, {
      method: 'POST', headers: json(orgToken),
      body: JSON.stringify({ email: reviewer2.email }),
    })
    expect(inv2.status).toBe(201)

    // Disable anonymous review
    const patch = await fetch(`${API}/festivals/${festivalId}/form`, {
      method: 'PATCH', headers: json(orgToken),
      body: JSON.stringify({ anonymous_review: false }),
    })
    expect(patch.status).toBe(200)

    // Unscored reviewer2 now sees full identity
    const res = await fetch(`${API}/festivals/${festivalId}/applications`, {
      headers: auth(reviewer2.token),
    })
    expect(res.status).toBe(200)
    const apps = await res.json()
    expect(apps[0].identity_hidden).toBe(false)
    expect(apps[0].artist.display_name).toContain('Real Name')
  })
})
