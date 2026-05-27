// Public-status gate regression test (issue #113).
//
// Anonymous `GET /festivals/{id}` must return 404 for `draft` festivals (they
// are not publicly visible) and 200 for `open`/`live` festivals. This regressed
// once historically — see `.claude/rules/e2e-debugging.md`.
import { describe, it, expect } from 'vitest'
import { createOrganiser, createFestival, setFestivalStatus } from '../fixtures/helpers.js'

const API = process.env.API_URL ?? 'http://localhost:8080'
const SUFFIX = `gaps-status-${Date.now()}`

describe('festival public-status gate', () => {
  it('anonymous GET /festivals/{id} → 404 draft, 200 open, 200 live', async () => {
    const organiser = await createOrganiser(SUFFIX)
    const { festivalId } = await createFestival(organiser.token, {
      name: 'Status Gate Fest',
      slug: `status-${SUFFIX}`,
    })

    // draft — invisible
    const draftRes = await fetch(`${API}/festivals/${festivalId}`)
    expect(draftRes.status).toBe(404)

    // open — visible
    await setFestivalStatus(organiser.token, festivalId, 'open')
    const openRes = await fetch(`${API}/festivals/${festivalId}`)
    expect(openRes.status).toBe(200)

    // live — visible
    await setFestivalStatus(organiser.token, festivalId, 'live')
    const liveRes = await fetch(`${API}/festivals/${festivalId}`)
    expect(liveRes.status).toBe(200)
  })
})
