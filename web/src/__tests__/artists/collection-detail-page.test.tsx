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
}))

vi.mock('next/link', () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) =>
    ({ type: 'a', props: { href, className, children } }),
}))

import CollectionPage from '@/app/(public)/artists/[id]/collections/[collectionId]/page'
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
  medium_tags: [],
  social_links: {},
  avatar_s3_key: null,
  headline_image_urls: [],
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
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

const mockImage: components['schemas']['CollectionImage'] = {
  id: 'image-uuid-001',
  collection_id: 'collection-uuid-789',
  s3_key: 'images/test.jpg',
  cdn_url: 'https://cdn.example.com/images/test.jpg',
  display_order: 0,
  created_at: '2024-01-01T00:00:00Z',
}

function makeOkResponse(data: unknown) {
  return { data, error: undefined, response: new Response(null, { status: 200 }) }
}

function make404Response() {
  return { data: undefined, error: { status: 404 }, response: new Response(null, { status: 404 }) }
}

const defaultParams = Promise.resolve({ id: 'profile-uuid-123', collectionId: 'collection-uuid-789' })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('CollectionPage', () => {
  it('calls notFound() when the collection API returns 404', async () => {
    mockGet
      .mockResolvedValueOnce(makeOkResponse(mockProfile) as never)
      .mockResolvedValueOnce(make404Response() as never)
      .mockResolvedValueOnce(makeOkResponse([]) as never)

    await expect(CollectionPage({ params: defaultParams })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(notFound).toHaveBeenCalledOnce()
  })

  it('renders collection name, description, and status', async () => {
    mockGet
      .mockResolvedValueOnce(makeOkResponse(mockProfile) as never)
      .mockResolvedValueOnce(makeOkResponse(mockCollection) as never)
      .mockResolvedValueOnce(makeOkResponse([]) as never)

    const result = await CollectionPage({ params: defaultParams })
    const html = JSON.stringify(result)

    expect(html).toContain('Bristol 2024')
    expect(html).toContain('Murals painted in Bristol during 2024.')
    expect(html).toContain('Active')
  })

  it('renders a back link to the artist profile', async () => {
    mockGet
      .mockResolvedValueOnce(makeOkResponse(mockProfile) as never)
      .mockResolvedValueOnce(makeOkResponse(mockCollection) as never)
      .mockResolvedValueOnce(makeOkResponse([]) as never)

    const result = await CollectionPage({ params: defaultParams })
    const html = JSON.stringify(result)

    expect(html).toContain('/artists/profile-uuid-123')
    expect(html).toContain('Alice Muralist')
  })

  it('renders images when present', async () => {
    mockGet
      .mockResolvedValueOnce(makeOkResponse(mockProfile) as never)
      .mockResolvedValueOnce(makeOkResponse(mockCollection) as never)
      .mockResolvedValueOnce(makeOkResponse([mockImage]) as never)

    const result = await CollectionPage({ params: defaultParams })
    const html = JSON.stringify(result)

    expect(html).toContain('https://cdn.example.com/images/test.jpg')
  })

  it('shows empty state when collection has no images', async () => {
    mockGet
      .mockResolvedValueOnce(makeOkResponse(mockProfile) as never)
      .mockResolvedValueOnce(makeOkResponse(mockCollection) as never)
      .mockResolvedValueOnce(makeOkResponse([]) as never)

    const result = await CollectionPage({ params: defaultParams })
    const html = JSON.stringify(result)

    expect(html).toContain('No images in this collection yet')
  })
})
