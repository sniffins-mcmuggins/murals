import { describe, it, expect } from 'vitest'
import { createArtist } from '../fixtures/helpers.js'

const API = process.env.API_URL ?? 'http://localhost:8080'

describe('profile setup fields', () => {
  it('support_url round-trips through PATCH and public GET', async () => {
    const { token } = await createArtist()
    const created = await fetch(`${API}/profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ displayName: 'Support Test Artist' }),
    })
    expect(created.ok).toBe(true)

    const patch = await fetch(`${API}/profiles/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ supportUrl: 'https://buymeacoffee.com/testartist' }),
    })
    expect(patch.status).toBe(200)
    const patched = await patch.json()
    expect(patched.support_url).toBe('https://buymeacoffee.com/testartist')

    const me = await fetch(`${API}/profiles/me`, { headers: { Authorization: `Bearer ${token}` } })
    const meBody = await me.json()
    expect(meBody.support_url).toBe('https://buymeacoffee.com/testartist')
  })

  it('rejects a non-http(s) support_url with 422', async () => {
    const { token } = await createArtist()
    const created = await fetch(`${API}/profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ displayName: 'Bad URL Artist' }),
    })
    expect(created.ok).toBe(true)
    const res = await fetch(`${API}/profiles/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ supportUrl: 'javascript:alert(1)' }),
    })
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(JSON.stringify(body).toLowerCase()).toMatch(/url/)
  })

  it('complete-setup stamps setup_completed_at and is idempotent', async () => {
    const { token } = await createArtist()
    const created = await fetch(`${API}/profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ displayName: 'Setup Test Artist' }),
    })
    expect(created.ok).toBe(true)

    const before = await (await fetch(`${API}/profiles/me`, { headers: { Authorization: `Bearer ${token}` } })).json()
    expect(before.setup_completed_at ?? null).toBeNull()

    const first = await fetch(`${API}/profiles/me/complete-setup`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` },
    })
    expect(first.status).toBe(200)
    const firstBody = await first.json()
    expect(typeof firstBody.setup_completed_at).toBe('string')

    const second = await fetch(`${API}/profiles/me/complete-setup`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` },
    })
    expect(second.status).toBe(200)
    const secondBody = await second.json()
    expect(secondBody.setup_completed_at).toBe(firstBody.setup_completed_at) // COALESCE keeps first stamp
  })
})
