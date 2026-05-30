import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/api', () => ({
  apiClient: {
    GET: vi.fn(),
  },
}))

import { apiClient } from '@/lib/api'
import sitemap from '@/app/sitemap'

const mockGet = apiClient.GET as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  mockGet.mockReset()
})

describe('sitemap', () => {
  it('lists public artist profiles and festivals plus static routes', async () => {
    mockGet.mockImplementation((path: string) => {
      if (path === '/public/profiles') {
        // Paginated wrapper shape.
        return Promise.resolve({
          data: {
            profiles: [
              { id: 'artist-1', display_name: 'A', updated_at: '2026-01-01T00:00:00Z' },
              { id: 'artist-2', display_name: 'B' },
            ],
          },
          response: { status: 200 },
        })
      }
      if (path === '/public/festivals') {
        return Promise.resolve({
          data: [{ id: 'fest-1', slug: 'cpf-2027', name: 'CPF' }],
          response: { status: 200 },
        })
      }
      return Promise.resolve({ data: null, response: { status: 404 } })
    })

    const entries = await sitemap()
    const urls = entries.map((e) => e.url)

    expect(urls.some((u) => u.endsWith('/artists/artist-1'))).toBe(true)
    expect(urls.some((u) => u.endsWith('/artists/artist-2'))).toBe(true)
    expect(urls.some((u) => u.endsWith('/festivals/cpf-2027'))).toBe(true)
    // home page is present
    expect(urls.some((u) => /\/$|^https?:\/\/[^/]+$/.test(u))).toBe(true)
  })

  it('also tolerates a bare array from the profiles endpoint', async () => {
    mockGet.mockImplementation((path: string) => {
      if (path === '/public/profiles') {
        return Promise.resolve({
          data: [{ id: 'artist-9', display_name: 'Z' }],
          response: { status: 200 },
        })
      }
      return Promise.resolve({ data: [], response: { status: 200 } })
    })

    const entries = await sitemap()
    expect(entries.map((e) => e.url).some((u) => u.endsWith('/artists/artist-9'))).toBe(true)
  })

  it('degrades gracefully when the API returns no data', async () => {
    mockGet.mockResolvedValue({ data: null, response: { status: 500 } })
    const entries = await sitemap()
    // still returns at least the static home route, never throws
    expect(entries.length).toBeGreaterThanOrEqual(1)
  })
})
