import { vi, describe, it, expect, beforeEach } from 'vitest'
import React from 'react'

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
}))
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: vi.fn().mockReturnValue({ value: 'test-session' }) }),
}))
vi.mock('@render/api-client', () => ({
  createApiClient: vi.fn().mockReturnValue({
    GET: vi.fn().mockResolvedValue({ data: null, error: { status: 404 } }),
    use: vi.fn(),
  }),
}))
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: vi.fn().mockReturnValue({ invalidateQueries: vi.fn() }),
  useMutation: vi.fn().mockReturnValue({ mutate: vi.fn(), isPending: false }),
}))

import ProfilePage from '@/app/(artist)/profile/page'

describe('ProfilePage', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('renders without throwing when profile is null', async () => {
    const jsx = await ProfilePage({ searchParams: Promise.resolve({}) })
    const rendered = JSON.stringify(jsx)
    expect(rendered).toContain('Profile')
  })
})
