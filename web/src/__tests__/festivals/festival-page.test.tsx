import { vi, describe, it, expect, beforeEach } from 'vitest'
import React from 'react'

vi.mock('@/lib/api', () => ({ apiClient: { GET: vi.fn() } }))
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
  redirect: vi.fn(),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) =>
    React.createElement('a', { href, className }, children),
}))

import { apiClient } from '@/lib/api'
import { notFound } from 'next/navigation'
import FestivalPage from '@/app/(public)/festivals/[id]/page'

const mockApiGet = vi.mocked(apiClient.GET)

const baseFestival = {
  id: 'abc-123',
  organiser_id: 'org-456',
  name: 'Cheltenham Paint Festival',
  slug: 'cpf-2027',
  description: 'Annual street art festival in Cheltenham.',
  location_label: 'Cheltenham, UK',
  start_date: '2027-10-01',
  end_date: '2027-10-05',
  status: 'open' as const,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const makeParams = (id: string) =>
  Promise.resolve({ id })

describe('FestivalPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls notFound() when the festival API returns 404', async () => {
    mockApiGet.mockResolvedValueOnce({ error: { status: 404, title: 'Not Found' }, data: undefined, response: new Response(null, { status: 404 }) })

    await expect(FestivalPage({ params: makeParams('missing-id') })).rejects.toThrow(
      'NEXT_NOT_FOUND'
    )
    expect(notFound).toHaveBeenCalledOnce()
  })

  it('shows the Apply CTA when festival status is open', async () => {
    mockApiGet
      .mockResolvedValueOnce({ data: baseFestival, error: undefined, response: new Response(null, { status: 200 }) })
      .mockResolvedValueOnce({ data: { pins: [] }, error: undefined, response: new Response(null, { status: 200 }) })

    const jsx = await FestivalPage({ params: makeParams('abc-123') })
    const rendered = JSON.stringify(jsx)

    expect(rendered).toContain('/festivals/abc-123/apply')
    expect(rendered).toContain('Apply to exhibit')
  })

  it('shows artist names when map data has pins', async () => {
    const festivalWithLiveStatus = { ...baseFestival, status: 'live' as const }
    const pins = [
      { artist_id: 'artist-1', name: 'Alice Murals', lat: 51.9, lng: -2.07, w3w: null },
      { artist_id: 'artist-2', name: 'Bob Sprays', lat: 51.91, lng: -2.08, w3w: null },
    ]

    mockApiGet
      .mockResolvedValueOnce({ data: festivalWithLiveStatus, error: undefined, response: new Response(null, { status: 200 }) })
      .mockResolvedValueOnce({ data: { pins }, error: undefined, response: new Response(null, { status: 200 }) })

    const jsx = await FestivalPage({ params: makeParams('abc-123') })
    const rendered = JSON.stringify(jsx)

    expect(rendered).toContain('Alice Murals')
    expect(rendered).toContain('Bob Sprays')
    expect(rendered).toContain('/artists/artist-1')
    expect(rendered).toContain('/artists/artist-2')
  })

  it('renders without throwing when map data returns 404 (non-live festival)', async () => {
    const draftFestival = { ...baseFestival, status: 'draft' as const }

    mockApiGet
      .mockResolvedValueOnce({ data: draftFestival, error: undefined, response: new Response(null, { status: 200 }) })
      .mockResolvedValueOnce({ error: { status: 404, title: 'Not Found' }, data: undefined, response: new Response(null, { status: 404 }) })

    const jsx = await FestivalPage({ params: makeParams('abc-123') })
    const rendered = JSON.stringify(jsx)

    expect(rendered).toContain('No artists announced yet')
  })
})
