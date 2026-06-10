import { vi, describe, it, expect, beforeEach } from 'vitest'
import React from 'react'

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }))

vi.mock('@/lib/api', () => ({ apiClient: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn() } }))
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
  redirect: vi.fn(() => { throw new Error('NEXT_REDIRECT') }),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) =>
    React.createElement('a', { href, className }, children),
}))
vi.mock('@/lib/auth-server', () => ({
  requireAuth: vi.fn().mockResolvedValue({ id: 'user-1', email: 'test@example.com', role: 'artist' }),
  getSessionUser: vi.fn().mockResolvedValue({ id: 'user-1', email: 'test@example.com', role: 'artist' }),
  createAuthedServerClient: vi.fn().mockResolvedValue({ GET: mockGet, use: vi.fn() }),
}))
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: vi.fn().mockReturnValue({ invalidateQueries: vi.fn() }),
  useMutation: vi.fn().mockReturnValue({ mutate: vi.fn(), isPending: false }),
}))

import ProfilePage from '@/app/(artist)/profile/page'
import { redirect } from 'next/navigation'

const setUpProfile = {
  id: 'p1',
  display_name: 'Test Artist',
  bio: '',
  visibility: 'draft',
  medium_tags: [],
  social_links: {},
  headline_image_urls: [],
  setup_completed_at: '2026-06-06T00:00:00Z',
  created_at: '2026-06-06T00:00:00Z',
  updated_at: '2026-06-06T00:00:00Z',
}

describe('ProfilePage', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('redirects to the setup wizard when the artist has not completed setup', async () => {
    mockGet.mockResolvedValue({ data: null, error: { status: 404 } })
    await expect(ProfilePage({ searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_REDIRECT')
    expect(redirect).toHaveBeenCalledWith('/profile/setup')
  })

  it('renders the editor when setup is complete', async () => {
    mockGet.mockResolvedValue({ data: setUpProfile, error: undefined })
    const jsx = await ProfilePage({ searchParams: Promise.resolve({}) })
    const rendered = JSON.stringify(jsx)
    expect(rendered).toContain('Profile')
    expect(redirect).not.toHaveBeenCalled()
  })

  it('renders the editor for a freshly claimed prospect even before setup completes', async () => {
    mockGet.mockResolvedValue({ data: null, error: { status: 404 } })
    const jsx = await ProfilePage({ searchParams: Promise.resolve({ claimed: '1' }) })
    const rendered = JSON.stringify(jsx)
    expect(rendered).toContain('Profile')
    expect(redirect).not.toHaveBeenCalled()
  })
})
