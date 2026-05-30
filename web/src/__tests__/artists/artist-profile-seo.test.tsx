import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as React from 'react'
import { render } from '@testing-library/react'

// Mock the API client module
vi.mock('@/lib/api', () => ({
  apiClient: {
    GET: vi.fn(),
  },
}))

import { apiClient } from '@/lib/api'
import ArtistPage, { generateMetadata } from '@/app/(public)/artists/[id]/page'

const mockGet = apiClient.GET as unknown as ReturnType<typeof vi.fn>

type MockResponse = { data: unknown; response: { status: number } }

const PROFILE = {
  id: 'artist-123',
  display_name: 'Lady Gabe',
  bio: 'Bristol-based muralist',
  location_label: 'Bristol, UK',
  medium_tags: ['mural', 'spray paint'],
  social_links: {
    instagram: 'https://instagram.com/ladygabe',
    website: 'https://ladygabe.com',
  },
  headline_image_urls: ['https://cdn.example.com/headline1.jpg'],
  avatar_s3_key: 'https://cdn.example.com/avatar.jpg',
}

const COLLECTIONS = [
  {
    id: 'col-1',
    name: 'Street Series',
    status: 'active',
    cover_s3_key: 'https://cdn.example.com/cover1.jpg',
    cover_focal_x: 50,
    cover_focal_y: 50,
  },
  {
    id: 'col-2',
    name: 'Archived Work',
    status: 'archived',
    cover_s3_key: null,
    cover_focal_x: null,
    cover_focal_y: null,
  },
]

function mockProfileAndCollections() {
  mockGet.mockImplementation((path: string) => {
    if (path === '/profiles/{profileID}') {
      return Promise.resolve({ data: PROFILE, response: { status: 200 } } as MockResponse)
    }
    if (path === '/profiles/{profileID}/collections') {
      return Promise.resolve({ data: COLLECTIONS, response: { status: 200 } } as MockResponse)
    }
    return Promise.resolve({ data: null, response: { status: 404 } } as MockResponse)
  })
}

beforeEach(() => {
  mockGet.mockReset()
})

describe('ArtistPage JSON-LD', () => {
  it('renders a JSON-LD script tag', async () => {
    mockProfileAndCollections()
    const { container } = render(
      await ArtistPage({ params: Promise.resolve({ id: 'artist-123' }) }),
    )
    const script = container.querySelector('script[type="application/ld+json"]')
    expect(script).not.toBeNull()
  })

  it('JSON-LD is valid JSON describing the artist as a Person/VisualArtist', async () => {
    mockProfileAndCollections()
    const { container } = render(
      await ArtistPage({ params: Promise.resolve({ id: 'artist-123' }) }),
    )
    const script = container.querySelector('script[type="application/ld+json"]')
    const json = JSON.parse(script!.textContent ?? '{}')
    expect(json['@context']).toBe('https://schema.org')
    expect(json['@type']).toBe('Person')
    expect(json.name).toBe('Lady Gabe')
    expect(json.description).toBe('Bristol-based muralist')
  })

  it('JSON-LD includes the avatar as image and social links as sameAs', async () => {
    mockProfileAndCollections()
    const { container } = render(
      await ArtistPage({ params: Promise.resolve({ id: 'artist-123' }) }),
    )
    const script = container.querySelector('script[type="application/ld+json"]')
    const json = JSON.parse(script!.textContent ?? '{}')
    expect(json.image).toBe('https://cdn.example.com/avatar.jpg')
    expect(json.sameAs).toEqual(
      expect.arrayContaining(['https://instagram.com/ladygabe', 'https://ladygabe.com']),
    )
  })

  it('JSON-LD describes collections as VisualArtwork works', async () => {
    mockProfileAndCollections()
    const { container } = render(
      await ArtistPage({ params: Promise.resolve({ id: 'artist-123' }) }),
    )
    const script = container.querySelector('script[type="application/ld+json"]')
    const json = JSON.parse(script!.textContent ?? '{}')
    const works = json.makesOffer ?? json.subjectOf ?? json.workExample ?? json['@graph']
    // We expose collections under workExample as an array of VisualArtwork
    expect(Array.isArray(json.workExample)).toBe(true)
    expect(json.workExample[0]['@type']).toBe('VisualArtwork')
    expect(json.workExample[0].name).toBe('Street Series')
  })
})

describe('ArtistPage OpenGraph metadata', () => {
  it('sets og:title and og:type', async () => {
    mockProfileAndCollections()
    const meta = await generateMetadata({ params: Promise.resolve({ id: 'artist-123' }) })
    expect(meta.openGraph?.title).toBe('Lady Gabe | Render')
    expect(meta.openGraph && (meta.openGraph as { type?: string }).type).toBe('profile')
  })

  it('sets og:image from the avatar', async () => {
    mockProfileAndCollections()
    const meta = await generateMetadata({ params: Promise.resolve({ id: 'artist-123' }) })
    const images = meta.openGraph?.images
    const first = Array.isArray(images) ? images[0] : images
    const url = typeof first === 'string' ? first : (first as { url?: string })?.url
    expect(url).toBe('https://cdn.example.com/avatar.jpg')
  })

  it('sets a twitter card', async () => {
    mockProfileAndCollections()
    const meta = await generateMetadata({ params: Promise.resolve({ id: 'artist-123' }) })
    const twitter = meta.twitter as { card?: string; title?: string } | null | undefined
    expect(twitter?.card).toBe('summary_large_image')
    expect(twitter?.title).toBe('Lady Gabe | Render')
  })

  it('sets a canonical url for the profile', async () => {
    mockProfileAndCollections()
    const meta = await generateMetadata({ params: Promise.resolve({ id: 'artist-123' }) })
    expect(meta.alternates?.canonical).toContain('/artists/artist-123')
  })

  it('falls back to the first headline image when no avatar', async () => {
    mockGet.mockImplementation((path: string) => {
      if (path === '/profiles/{profileID}') {
        return Promise.resolve({
          data: { ...PROFILE, avatar_s3_key: undefined },
          response: { status: 200 },
        } as MockResponse)
      }
      return Promise.resolve({ data: [], response: { status: 200 } } as MockResponse)
    })
    const meta = await generateMetadata({ params: Promise.resolve({ id: 'artist-123' }) })
    const images = meta.openGraph?.images
    const first = Array.isArray(images) ? images[0] : images
    const url = typeof first === 'string' ? first : (first as { url?: string })?.url
    expect(url).toBe('https://cdn.example.com/headline1.jpg')
  })
})
