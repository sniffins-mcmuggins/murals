import { describe, it, expect, beforeAll } from 'vitest'
import { createOrganiser } from '../fixtures/helpers'

const API = process.env.API_URL ?? 'http://localhost:8080'

describe('GET /geocode/search', () => {
  const suffix = `geocode-${Date.now()}`
  let token: string

  beforeAll(async () => {
    const u = await createOrganiser(suffix)
    token = u.token
  })

  it('requires authentication', async () => {
    const res = await fetch(`${API}/geocode/search?q=cheltenham`)
    expect(res.status).toBe(401)
  })

  it('returns 400 for empty q', async () => {
    const res = await fetch(`${API}/geocode/search?q=`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 for missing q', async () => {
    const res = await fetch(`${API}/geocode/search`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(400)
  })

  it('returns an array of suggestions for a valid query', async () => {
    const res = await fetch(`${API}/geocode/search?q=cheltenham+uk`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(Array.isArray(data)).toBe(true)
    if (data.length > 0) {
      const first = data[0]
      expect(typeof first.display_name).toBe('string')
      expect(typeof first.lat).toBe('number')
      expect(typeof first.lng).toBe('number')
      expect(data.length).toBeLessThanOrEqual(5)
    }
  })
})
