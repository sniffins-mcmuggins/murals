// e2e/api/endorsements.test.ts
// E18 — Endorsements: create/withdraw/list, peer+organiser validation, visibility controls.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { createArtist, createOrganiser } from '../fixtures/helpers'

const API = process.env.API_URL ?? 'http://localhost:8080'
const DB_URL = process.env.DATABASE_URL ?? 'postgres://render:render@localhost:5432/render'
const SUFFIX = `e18-${Date.now()}`

function auth(token: string) {
  return { Authorization: `Bearer ${token}` }
}

async function post(path: string, body: unknown, token: string) {
  return fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth(token) },
    body: JSON.stringify(body),
  })
}

async function json(res: Response) {
  const text = await res.text()
  try { return JSON.parse(text) } catch { return text }
}

let db: Client
let endorserToken: string
let endorser2Token: string  // second peer endorser for the 2-endorsement test
let endorseeToken: string
let endorseeProfileID: string
let organiserToken: string
let festivalID: string
let endorsementID: string  // peer endorsement created in test 1

beforeAll(async () => {
  db = new Client(DB_URL)
  await db.connect()

  // Endorser: has an artist_profile (peer kind)
  const endorser = await createArtist(`endorser-${SUFFIX}`)
  endorserToken = endorser.token
  await post('/profiles', { displayName: `Endorser ${SUFFIX}` }, endorserToken)

  // Endorser2: second artist for the received-list test
  const endorser2 = await createArtist(`endorser2-${SUFFIX}`)
  endorser2Token = endorser2.token
  await post('/profiles', { displayName: `Endorser2 ${SUFFIX}` }, endorser2Token)

  // Endorsee: has a public artist_profile
  const endorsee = await createArtist(`endorsee-${SUFFIX}`)
  endorseeToken = endorsee.token
  const profileRes = await post('/profiles', { displayName: `Endorsee ${SUFFIX}` }, endorseeToken)
  const profileData = await json(profileRes)
  endorseeProfileID = profileData.id

  // Bypass publish gate — set visibility directly in DB for this test
  await db.query(
    `UPDATE artist_profiles SET visibility = 'public' WHERE id = $1`,
    [endorseeProfileID],
  )

  // Organiser: creates a festival
  const org = await createOrganiser(`org-${SUFFIX}`)
  organiserToken = org.token
  const festRes = await post('/festivals', {
    name: `E18 Festival ${SUFFIX}`,
    slug: `e18-fest-${SUFFIX}`,
    description: '',
    location_label: '',
  }, organiserToken)
  const festData = await json(festRes)
  festivalID = festData.id
})

afterAll(async () => {
  await db.end()
})

describe('E18 endorsements', () => {
  it('1. peer endorsement created', async () => {
    const res = await post('/endorsements', {
      endorsee_id: endorseeProfileID,
      kind: 'peer',
      body: 'Amazing muralist.',
      skills: ['mural', 'stencil'],
    }, endorserToken)
    expect(res.status).toBe(201)
    const data = await json(res)
    expect(data.kind).toBe('peer')
    expect(data.body).toBe('Amazing muralist.')
    expect(data.skills).toContain('mural')
    endorsementID = data.id
  })

  it('2. self-endorse → 400', async () => {
    const res = await post('/endorsements', {
      endorsee_id: endorseeProfileID,
      kind: 'peer',
    }, endorseeToken)
    expect(res.status).toBe(400)
  })

  it('3. upsert — second POST same pair merges, no duplicate', async () => {
    const res = await post('/endorsements', {
      endorsee_id: endorseeProfileID,
      kind: 'peer',
      body: 'Updated: still amazing.',
    }, endorserToken)
    expect(res.status).toBe(201)
    const data = await json(res)
    expect(data.id).toBe(endorsementID)
    expect(data.body).toBe('Updated: still amazing.')

    // Confirm no duplicate in DB
    const { rows } = await db.query(
      `SELECT COUNT(*) AS n FROM endorsements WHERE endorser_id = (SELECT id FROM users WHERE email LIKE $1)`,
      [`%endorser-${SUFFIX}%`],
    )
    expect(Number(rows[0].n)).toBe(1)
  })

  it('4. public list shows endorsement', async () => {
    const res = await fetch(`${API}/profiles/${endorseeProfileID}/endorsements`)
    expect(res.status).toBe(200)
    const data = await json(res)
    expect(data.endorsements).toHaveLength(1)
    expect(data.endorsements[0].kind).toBe('peer')
    expect(data.endorsements[0].endorser_display_name).toContain(`Endorser ${SUFFIX}`)
  })

  it('5. endorsee hides → public list is empty', async () => {
    const patch = await fetch(`${API}/endorsements/${endorsementID}/visibility`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth(endorseeToken) },
      body: JSON.stringify({ hidden: true }),
    })
    expect(patch.status).toBe(200)
    const patchData = await json(patch)
    expect(patchData.hidden_by_endorsee).toBe(true)

    const list = await fetch(`${API}/profiles/${endorseeProfileID}/endorsements`)
    const data = await json(list)
    expect(data.endorsements).toHaveLength(0)
  })

  it('6. endorsee shows again → public list restored', async () => {
    const patch = await fetch(`${API}/endorsements/${endorsementID}/visibility`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth(endorseeToken) },
      body: JSON.stringify({ hidden: false }),
    })
    expect(patch.status).toBe(200)

    const list = await fetch(`${API}/profiles/${endorseeProfileID}/endorsements`)
    const data = await json(list)
    expect(data.endorsements).toHaveLength(1)
  })

  it('7. endorser cannot set visibility → 403', async () => {
    const res = await fetch(`${API}/endorsements/${endorsementID}/visibility`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth(endorserToken) },
      body: JSON.stringify({ hidden: true }),
    })
    expect(res.status).toBe(403)
  })

  it('8. organiser endorsement with owned festival → 201 with festival_name in public list', async () => {
    const res = await post('/endorsements', {
      endorsee_id: endorseeProfileID,
      kind: 'organiser',
      festival_id: festivalID,
      body: 'Featured at our festival.',
    }, organiserToken)
    expect(res.status).toBe(201)
    const data = await json(res)
    expect(data.kind).toBe('organiser')
    expect(data.festival_id).toBe(festivalID)

    // Organiser endorsement appears first in public list
    const list = await fetch(`${API}/profiles/${endorseeProfileID}/endorsements`)
    const listData = await json(list)
    expect(listData.endorsements[0].kind).toBe('organiser')
    expect(listData.endorsements[0].festival_name).toBeTruthy()
  })

  it('9. organiser badge with unowned festival → 403', async () => {
    const res = await post('/endorsements', {
      endorsee_id: endorseeProfileID,
      kind: 'organiser',
      festival_id: festivalID,
    }, endorserToken) // endorser does not own festivalID
    expect(res.status).toBe(403)
  })

  it('10. endorser withdraws peer endorsement → 204', async () => {
    const res = await fetch(`${API}/endorsements/${endorsementID}`, {
      method: 'DELETE',
      headers: auth(endorserToken),
    })
    expect(res.status).toBe(204)

    const list = await fetch(`${API}/profiles/${endorseeProfileID}/endorsements`)
    const data = await json(list)
    const peerEndorsements = data.endorsements.filter((e: { kind: string }) => e.kind === 'peer')
    expect(peerEndorsements).toHaveLength(0)
  })

  it('11. endorsee cannot delete endorsement → 403', async () => {
    // Re-create a peer endorsement to test deletion auth
    const createRes = await post('/endorsements', {
      endorsee_id: endorseeProfileID,
      kind: 'peer',
      body: 'For deletion test.',
    }, endorserToken)
    expect(createRes.status).toBe(201)
    const newID = (await json(createRes)).id

    const res = await fetch(`${API}/endorsements/${newID}`, {
      method: 'DELETE',
      headers: auth(endorseeToken),
    })
    expect(res.status).toBe(403)

    // Clean up
    await fetch(`${API}/endorsements/${newID}`, {
      method: 'DELETE',
      headers: auth(endorserToken),
    })
  })

  it('12. received list returns all endorsements including hidden', async () => {
    // Add a second peer endorsement from endorser2, then hide it
    const res2 = await post('/endorsements', {
      endorsee_id: endorseeProfileID,
      kind: 'peer',
    }, endorser2Token)
    expect(res2.status).toBe(201)
    const newID = (await json(res2)).id
    await fetch(`${API}/endorsements/${newID}/visibility`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth(endorseeToken) },
      body: JSON.stringify({ hidden: true }),
    })

    const received = await fetch(`${API}/endorsements/received`, {
      headers: auth(endorseeToken),
    })
    expect(received.status).toBe(200)
    const data = await json(received)
    // Should have: organiser (from test 8) + hidden peer (endorser2) + any visible peer
    const hiddenOnes = data.endorsements.filter((e: { hidden_by_endorsee: boolean }) => e.hidden_by_endorsee)
    expect(hiddenOnes.length).toBeGreaterThanOrEqual(1)
  })

  it('13. no token → received list 401', async () => {
    const res = await fetch(`${API}/endorsements/received`)
    expect(res.status).toBe(401)
  })
})
