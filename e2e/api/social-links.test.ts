import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { createArtist, createProfile, uniqueSuffix } from '../fixtures/helpers'
import { forcePublish } from '../fixtures/db-helpers'

const API = process.env.API_URL ?? 'http://localhost:8080'
const DB_URL = process.env.DATABASE_URL ?? 'postgres://render:render@localhost:5432/render'

const auth = (token: string) => ({ Authorization: `Bearer ${token}` })
const json = (res: Response) => res.json()

describe('social links', () => {
  let db: Client

  beforeAll(async () => {
    db = new Client({ connectionString: DB_URL })
    await db.connect()
  })

  afterAll(async () => {
    await db.end()
  })

  it('PATCH /profiles/me without token → 401', async () => {
    const res = await fetch(`${API}/profiles/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ socialLinks: { instagram: 'https://instagram.com/test' } }),
    })
    expect(res.status).toBe(401)
  })

  it('set social links and they appear on the public profile', async () => {
    const suffix = uniqueSuffix()
    const { token, userId } = await createArtist(suffix)
    const { profileId } = await createProfile(token, { displayName: `Social Artist ${suffix}` })

    const patchRes = await fetch(`${API}/profiles/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth(token) },
      body: JSON.stringify({
        socialLinks: {
          instagram: 'https://instagram.com/testartist',
          website: 'https://testartist.com',
        },
      }),
    })
    expect(patchRes.status).toBe(200)
    const updated = await json(patchRes)
    expect(updated.social_links.instagram).toBe('https://instagram.com/testartist')
    expect(updated.social_links.website).toBe('https://testartist.com')

    // Publish before anonymous fetch (bypass gate — this test is about social links, not the publish gate).
    await forcePublish(db, userId)

    const publicRes = await fetch(`${API}/profiles/${profileId}`)
    expect(publicRes.status).toBe(200)
    const pub = await json(publicRes)
    expect(pub.social_links.instagram).toBe('https://instagram.com/testartist')
    expect(pub.social_links.website).toBe('https://testartist.com')
  })

  it('update (overwrite) existing social links', async () => {
    const suffix = uniqueSuffix() + 1
    const { token } = await createArtist(suffix)
    await createProfile(token, { displayName: `Update Artist ${suffix}` })

    await fetch(`${API}/profiles/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth(token) },
      body: JSON.stringify({ socialLinks: { instagram: 'https://instagram.com/old' } }),
    })

    const updateRes = await fetch(`${API}/profiles/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth(token) },
      body: JSON.stringify({ socialLinks: { instagram: 'https://instagram.com/new', twitter: 'https://x.com/handle' } }),
    })
    expect(updateRes.status).toBe(200)
    const data = await json(updateRes)
    expect(data.social_links.instagram).toBe('https://instagram.com/new')
    expect(data.social_links.twitter).toBe('https://x.com/handle')
    expect(data.social_links.website).toBeUndefined()
  })

  it('clear all social links by sending empty object', async () => {
    const suffix = uniqueSuffix() + 2
    const { token, userId } = await createArtist(suffix)
    const { profileId } = await createProfile(token, { displayName: `Clear Artist ${suffix}` })

    await fetch(`${API}/profiles/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth(token) },
      body: JSON.stringify({ socialLinks: { instagram: 'https://instagram.com/gone' } }),
    })

    const clearRes = await fetch(`${API}/profiles/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth(token) },
      body: JSON.stringify({ socialLinks: {} }),
    })
    expect(clearRes.status).toBe(200)
    const data = await json(clearRes)
    expect(Object.keys(data.social_links)).toHaveLength(0)

    // Publish before anonymous fetch (bypass gate — this test is about social links, not the publish gate).
    await forcePublish(db, userId)

    const publicRes = await fetch(`${API}/profiles/${profileId}`)
    const pub = await json(publicRes)
    expect(Object.keys(pub.social_links)).toHaveLength(0)
  })

  it('social links are not included in response when omitted from PATCH', async () => {
    const suffix = uniqueSuffix() + 3
    const { token } = await createArtist(suffix)
    await createProfile(token, { displayName: `Preserve Artist ${suffix}` })

    await fetch(`${API}/profiles/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth(token) },
      body: JSON.stringify({ socialLinks: { youtube: 'https://youtube.com/@channel' } }),
    })

    // PATCH without socialLinks field should not clear existing links
    const patchRes = await fetch(`${API}/profiles/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth(token) },
      body: JSON.stringify({ bio: 'Updated bio only' }),
    })
    expect(patchRes.status).toBe(200)
    const data = await json(patchRes)
    expect(data.social_links.youtube).toBe('https://youtube.com/@channel')
    expect(data.bio).toBe('Updated bio only')
  })
})
