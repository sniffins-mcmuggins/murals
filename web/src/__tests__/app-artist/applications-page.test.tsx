import { vi, describe, it, expect, beforeEach } from 'vitest'
import React from 'react'
import { render, screen } from '@testing-library/react'

vi.mock('@/lib/api', () => ({ apiClient: { GET: vi.fn(), POST: vi.fn() } }))
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
import ApplicationsPage from '@/app/(artist)/applications/page'

const mockUseQuery = vi.mocked(useQuery)

describe('ApplicationsPage', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('shows loading state', () => {
    mockUseQuery
      .mockReturnValueOnce({ data: undefined, isLoading: true } as unknown as ReturnType<typeof useQuery>)
      .mockReturnValueOnce({ data: undefined, isLoading: true } as unknown as ReturnType<typeof useQuery>)
    render(React.createElement(ApplicationsPage))
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('shows "No applications yet" when empty', () => {
    mockUseQuery
      .mockReturnValueOnce({ data: [], isLoading: false } as unknown as ReturnType<typeof useQuery>)
      .mockReturnValueOnce({ data: [], isLoading: false } as unknown as ReturnType<typeof useQuery>)
    render(React.createElement(ApplicationsPage))
    expect(screen.getByText(/No applications yet/)).toBeInTheDocument()
  })

  it('shows applications list with outcome and date', () => {
    const applications = [
      {
        id: 'app-1',
        form_id: 'form-1',
        artist_id: 'artist-1',
        decision: null, // not yet released → under review
        answers: {},
        created_at: '2026-03-15T10:00:00Z',
        updated_at: '2026-03-15T10:00:00Z',
      },
      {
        id: 'app-2',
        form_id: 'form-2',
        artist_id: 'artist-1',
        decision: 'accept', // released accept
        answers: {},
        created_at: '2026-02-01T10:00:00Z',
        updated_at: '2026-02-02T10:00:00Z',
      },
    ]
    mockUseQuery
      .mockReturnValueOnce({ data: applications, isLoading: false } as unknown as ReturnType<typeof useQuery>)
      .mockReturnValueOnce({ data: [], isLoading: false } as unknown as ReturnType<typeof useQuery>)
    render(React.createElement(ApplicationsPage))
    expect(screen.getByText('Under review')).toBeInTheDocument()
    expect(screen.getByText('Accepted')).toBeInTheDocument()
  })
})
