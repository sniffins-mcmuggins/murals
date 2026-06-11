import { describe, it, expect, vi, beforeEach } from 'vitest'
import type React from 'react'
import type { components } from '@render/api-client'

vi.mock('@/lib/api', () => ({
  apiClient: {
    GET: vi.fn(),
  },
}))

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
  redirect: vi.fn(),
}))

vi.mock('next/link', () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) =>
    ({ type: 'a', props: { href, className, children } }),
}))

// auth-server is `server-only`; stub it so these tests render the public
// (non-owner) view without pulling the server-only guard into jsdom.
vi.mock('@/lib/auth-server', () => ({
  isProfileOwner: vi.fn().mockResolvedValue(false),
}))

// Import after mocks are set up
import ArtistPage from '@/app/(public)/artists/[id]/page'
import { apiClient } from '@/lib/api'
import { notFound } from 'next/navigation'

const mockGet = vi.mocked(apiClient.GET)

const mockProfile: components['schemas']['ArtistProfile'] = {
  id: 'profile-uuid-123',
  user_id: 'user-uuid-456',
  display_name: 'Alice Muralist',
  bio: 'A street artist from Bristol.',
  visibility: 'public',
  location_label: 'Bristol, UK',
  medium_tags: ['mural', 'stencil'],
  social_links: { instagram: 'https://instagram.com/alice' },
  avatar_s3_key: null,
  headline_image_urls: [],
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  has_unpublished_changes: false,
}

const mockCollection: components['schemas']['Collection'] = {
  id: 'collection-uuid-789',
  artist_profile_id: 'profile-uuid-123',
  name: 'Bristol 2024',
  description: 'Murals painted in Bristol during 2024.',
  cover_s3_key: null,
  status: 'active',
  display_order: 0,
  cover_focal_x: 50,
  cover_focal_y: 50,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
}

function makeOkResponse(data: unknown) {
  return { data, error: undefined, response: new Response(null, { status: 200 }) }
}

function make404Response() {
  return { data: undefined, error: { status: 404, title: 'Not Found' }, response: new Response(null, { status: 404 }) }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ArtistPage', () => {
  it('calls notFound() when the profile API returns 404', async () => {
    mockGet
      .mockResolvedValueOnce(make404Response() as never)
      .mockResolvedValueOnce(makeOkResponse([]) as never)
      .mockResolvedValueOnce(makeOkResponse([]) as never)
      .mockResolvedValueOnce(makeOkResponse({ endorsements: [] }) as never)

    await expect(
      ArtistPage({ params: Promise.resolve({ id: 'nonexistent-uuid' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND')

    expect(notFound).toHaveBeenCalledOnce()
  })

  it('renders the artist display_name when the API returns a valid profile', async () => {
    mockGet
      .mockResolvedValueOnce(makeOkResponse(mockProfile) as never)
      .mockResolvedValueOnce(makeOkResponse([mockCollection]) as never)
      .mockResolvedValueOnce(makeOkResponse([]) as never) // festivals
      .mockResolvedValueOnce(makeOkResponse({ endorsements: [] }) as never)

    const result = await ArtistPage({ params: Promise.resolve({ id: 'profile-uuid-123' }) })

    // The result is a React element (JSX). Convert to string to verify content.
    const html = JSON.stringify(result)
    expect(html).toContain('Alice Muralist')
    expect(html).toContain('Bristol, UK')
    expect(html).toContain('mural')
    expect(html).toContain('stencil')
    expect(html).toContain('Bristol 2024')
  })

  it('renders collections as a scroll strip with links to collection detail pages', async () => {
    mockGet
      .mockResolvedValueOnce(makeOkResponse(mockProfile) as never)
      .mockResolvedValueOnce(makeOkResponse([mockCollection]) as never)
      .mockResolvedValueOnce(makeOkResponse([]) as never) // festivals
      .mockResolvedValueOnce(makeOkResponse({ endorsements: [] }) as never)

    const result = await ArtistPage({ params: Promise.resolve({ id: 'profile-uuid-123' }) })

    const html = JSON.stringify(result)
    // Collection detail link uses artist id + collection id
    expect(html).toContain('/artists/profile-uuid-123/collections/collection-uuid-789')
    // Status badge
    expect(html).toContain('Active')
  })

  it('hides the collections section when the artist has no collections', async () => {
    mockGet
      .mockResolvedValueOnce(makeOkResponse(mockProfile) as never)
      .mockResolvedValueOnce(makeOkResponse([]) as never)
      .mockResolvedValueOnce(makeOkResponse([]) as never) // festivals
      .mockResolvedValueOnce(makeOkResponse({ endorsements: [] }) as never)

    const result = await ArtistPage({ params: Promise.resolve({ id: 'profile-uuid-123' }) })

    const html = JSON.stringify(result)
    expect(html).not.toContain('Collections')
  })

  it('does not call notFound() when the profile is found', async () => {
    mockGet
      .mockResolvedValueOnce(makeOkResponse(mockProfile) as never)
      .mockResolvedValueOnce(makeOkResponse([]) as never)
      .mockResolvedValueOnce(makeOkResponse([]) as never) // festivals
      .mockResolvedValueOnce(makeOkResponse({ endorsements: [] }) as never)

    await ArtistPage({ params: Promise.resolve({ id: 'profile-uuid-123' }) })

    expect(notFound).not.toHaveBeenCalled()
  })
})
