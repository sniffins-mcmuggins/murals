import { describe, it, expect } from 'vitest'
import { createArtist, createProfile } from '../fixtures/helpers'

const API = process.env.API_URL ?? 'http://localhost:8080'
const auth = (token: string) => ({ Authorization: `Bearer ${token}` })
const json = (res: Response) => res.json()

describe('profile images', () => {
  it('PATCH /profiles/me without token → 401', async () => {
    const res = await fetch(`${API}/profiles/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ avatarS3Key: 'https://cdn.example.com/avatar.jpg' }),
    })
    expect(res.status).toBe(401)
  })

  it('profile response includes headline_image_urls array (empty by default)', async () => {
    const suffix = Date.now()
    const { token } = await createArtist(suffix)
    const { profileId } = await createProfile(token, { displayName: `Image Artist ${suffix}` })

    const res = await fetch(`${API}/profiles/${profileId}`)
    expect(res.status).toBe(200)
    const data = await json(res)
    expect(Array.isArray(data.headline_image_urls)).toBe(true)
    expect(data.headline_image_urls).toHaveLength(0)
  })

  it('set avatar and headline images via PATCH, appear on public profile', async () => {
    const suffix = Date.now() + 1
    const { token } = await createArtist(suffix)
    const { profileId } = await createProfile(token, { displayName: `Hero Artist ${suffix}` })

    const patchRes = await fetch(`${API}/profiles/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth(token) },
      body: JSON.stringify({
        avatarS3Key: 'https://cdn.example.com/avatar.jpg',
        headlineImageUrls: [
          'https://cdn.example.com/hero1.jpg',
          'https://cdn.example.com/hero2.jpg',
        ],
      }),
    })
    expect(patchRes.status).toBe(200)
    const updated = await json(patchRes)
    expect(updated.avatar_s3_key).toBe('https://cdn.example.com/avatar.jpg')
    expect(updated.headline_image_urls).toEqual([
      'https://cdn.example.com/hero1.jpg',
      'https://cdn.example.com/hero2.jpg',
    ])

    const publicRes = await fetch(`${API}/profiles/${profileId}`)
    const pub = await json(publicRes)
    expect(pub.avatar_s3_key).toBe('https://cdn.example.com/avatar.jpg')
    expect(pub.headline_image_urls).toEqual([
      'https://cdn.example.com/hero1.jpg',
      'https://cdn.example.com/hero2.jpg',
    ])
  })

  it('update headline images replaces the array', async () => {
    const suffix = Date.now() + 2
    const { token } = await createArtist(suffix)
    await createProfile(token, { displayName: `Replace Artist ${suffix}` })

    await fetch(`${API}/profiles/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth(token) },
      body: JSON.stringify({ headlineImageUrls: ['https://cdn.example.com/old.jpg'] }),
    })

    const res = await fetch(`${API}/profiles/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth(token) },
      body: JSON.stringify({
        headlineImageUrls: [
          'https://cdn.example.com/new1.jpg',
          'https://cdn.example.com/new2.jpg',
          'https://cdn.example.com/new3.jpg',
        ],
      }),
    })
    expect(res.status).toBe(200)
    const data = await json(res)
    expect(data.headline_image_urls).toHaveLength(3)
    expect(data.headline_image_urls[0]).toBe('https://cdn.example.com/new1.jpg')
  })

  it('PATCH without headlineImageUrls preserves existing images', async () => {
    const suffix = Date.now() + 3
    const { token } = await createArtist(suffix)
    await createProfile(token, { displayName: `Preserve Image Artist ${suffix}` })

    await fetch(`${API}/profiles/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth(token) },
      body: JSON.stringify({ headlineImageUrls: ['https://cdn.example.com/keep.jpg'] }),
    })

    const res = await fetch(`${API}/profiles/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth(token) },
      body: JSON.stringify({ bio: 'Updated bio only' }),
    })
    expect(res.status).toBe(200)
    const data = await json(res)
    expect(data.headline_image_urls).toContain('https://cdn.example.com/keep.jpg')
    expect(data.bio).toBe('Updated bio only')
  })
})
