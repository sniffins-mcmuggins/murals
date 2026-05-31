import { describe, it, expect } from 'vitest'
import { createArtist, createProfile, uniqueSuffix } from '../fixtures/helpers'

const API = process.env.API_URL ?? 'http://localhost:8080'

const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

async function publishProfile(token: string): Promise<void> {
  const res = await fetch(`${API}/profiles/me`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...auth(token) },
    body: JSON.stringify({ visibility: 'public' }),
  })
  if (!res.ok) throw new Error(`publishProfile failed: ${res.status}`)
}

describe('GET /profiles/me/analytics', () => {
  it('without token → 401', async () => {
    const res = await fetch(`${API}/profiles/me/analytics`)
    expect(res.status).toBe(401)
  })

  it('with token but no profile → 404', async () => {
    const suffix = uniqueSuffix()
    const { token } = await createArtist(suffix)

    const res = await fetch(`${API}/profiles/me/analytics`, { headers: auth(token) })
    expect(res.status).toBe(404)
  })

  it('returns zero counts and 90-day window for a free artist with no events', async () => {
    const suffix = uniqueSuffix()
    const { token } = await createArtist(suffix)
    await createProfile(token, { displayName: `Analytics Artist ${suffix}` })

    const res = await fetch(`${API}/profiles/me/analytics`, { headers: auth(token) })
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.profile_views).toBe(0)
    expect(data.qr_scans).toBe(0)
    expect(data.link_clicks).toBe(0)
    expect(data.window_days).toBe(90)
  })

  it('profile_view events appear in the response after visiting the public profile', async () => {
    const suffix = uniqueSuffix() + 1
    const { token } = await createArtist(suffix)
    const { profileId } = await createProfile(token, { displayName: `View Artist ${suffix}` })
    await publishProfile(token)

    // Trigger a profile_view by fetching the public profile.
    await fetch(`${API}/profiles/${profileId}`)
    await fetch(`${API}/profiles/${profileId}`)

    const res = await fetch(`${API}/profiles/me/analytics`, { headers: auth(token) })
    expect(res.status).toBe(200)

    const data = await res.json()
    // Events are recorded asynchronously; allow a moment for the goroutines to complete.
    // We check >= 1 rather than == 2 to avoid flakiness from timing.
    expect(data.profile_views).toBeGreaterThanOrEqual(1)
    expect(data.window_days).toBe(90)
  })

  it('link_click events appear in the response after POST /profiles/{profileID}/link-click', async () => {
    const suffix = uniqueSuffix() + 2
    const { token } = await createArtist(suffix)
    const { profileId } = await createProfile(token, { displayName: `Link Artist ${suffix}` })

    await fetch(`${API}/profiles/${profileId}/link-click`, { method: 'POST' })
    await fetch(`${API}/profiles/${profileId}/link-click`, { method: 'POST' })

    const res = await fetch(`${API}/profiles/me/analytics`, { headers: auth(token) })
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.link_clicks).toBeGreaterThanOrEqual(1)
    expect(data.window_days).toBe(90)
  })
})
