import { vi, describe, it, expect, beforeEach } from 'vitest'
import React from 'react'
import { render, screen } from '@testing-library/react'

vi.mock('@/lib/api', () => ({ apiClient: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn() } }))
vi.mock('next/link', () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) =>
    React.createElement('a', { href, className }, children),
}))
vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
  useMutation: vi.fn().mockReturnValue({ mutate: vi.fn(), isPending: false }),
  useQueryClient: vi.fn().mockReturnValue({ invalidateQueries: vi.fn() }),
}))

import { useQuery } from '@tanstack/react-query'
import CollectionsPage from '@/app/(artist)/collections/page'

const mockUseQuery = vi.mocked(useQuery)

describe('CollectionsPage', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('shows loading state', () => {
    mockUseQuery
      .mockReturnValueOnce({ data: null, isLoading: true } as unknown as ReturnType<typeof useQuery>)
      .mockReturnValueOnce({ data: [], isLoading: true } as unknown as ReturnType<typeof useQuery>)
    render(React.createElement(CollectionsPage))
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('shows empty state when no collections', () => {
    mockUseQuery
      .mockReturnValueOnce({ data: { id: 'profile-1' }, isLoading: false } as unknown as ReturnType<typeof useQuery>)
      .mockReturnValueOnce({ data: [], isLoading: false } as unknown as ReturnType<typeof useQuery>)
    render(React.createElement(CollectionsPage))
    expect(screen.getByText(/No collections yet/)).toBeInTheDocument()
  })

  it('renders collection list', () => {
    const collections = [
      { id: 'col-1', name: 'My Murals', description: 'Street art', status: 'active', display_order: 0, artist_profile_id: 'p1', created_at: '', updated_at: '' },
    ]
    mockUseQuery
      .mockReturnValueOnce({ data: { id: 'profile-1' }, isLoading: false } as unknown as ReturnType<typeof useQuery>)
      .mockReturnValueOnce({ data: collections, isLoading: false } as unknown as ReturnType<typeof useQuery>)
    render(React.createElement(CollectionsPage))
    expect(screen.getByText('My Murals')).toBeInTheDocument()
  })
})
