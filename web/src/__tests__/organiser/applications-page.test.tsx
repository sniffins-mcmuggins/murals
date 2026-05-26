import { vi, describe, it, expect, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'

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
import ApplicationsReviewPage from '@/app/organiser/festivals/[id]/applications/page'

const mockUseQuery = vi.mocked(useQuery)

const mockParams = Promise.resolve({ id: 'fest-abc123' })

describe('Organiser ApplicationsReviewPage', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('shows loading state', () => {
    mockUseQuery.mockReturnValue({ data: undefined, isLoading: true } as unknown as ReturnType<typeof useQuery>)
    render(React.createElement(ApplicationsReviewPage, { params: mockParams }))
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('shows applications list with status badges', async () => {
    const applications = [
      {
        id: 'app-1',
        form_id: 'form-1',
        artist_id: 'aabbccdd-1234-5678-abcd-111111111111',
        status: 'submitted',
        answers: { 'Why do you want to participate?': 'I love murals' },
        created_at: '2026-03-15T10:00:00Z',
        updated_at: '2026-03-15T10:00:00Z',
      },
      {
        id: 'app-2',
        form_id: 'form-1',
        artist_id: 'eeff0011-1234-5678-abcd-222222222222',
        status: 'accepted',
        answers: {},
        created_at: '2026-02-01T10:00:00Z',
        updated_at: '2026-02-02T10:00:00Z',
      },
      {
        id: 'app-3',
        form_id: 'form-1',
        artist_id: 'gghhiijj-1234-5678-abcd-333333333333',
        status: 'declined',
        answers: {},
        created_at: '2026-01-10T10:00:00Z',
        updated_at: '2026-01-11T10:00:00Z',
      },
    ]
    mockUseQuery.mockReturnValue({ data: applications, isLoading: false } as unknown as ReturnType<typeof useQuery>)
    render(React.createElement(ApplicationsReviewPage, { params: mockParams }))

    await waitFor(() => {
      expect(screen.getByText('submitted')).toBeInTheDocument()
    })
    expect(screen.getByText('accepted')).toBeInTheDocument()
    expect(screen.getByText('declined')).toBeInTheDocument()
  })

  it('shows empty state when no applications', async () => {
    mockUseQuery.mockReturnValue({ data: [], isLoading: false } as unknown as ReturnType<typeof useQuery>)
    render(React.createElement(ApplicationsReviewPage, { params: mockParams }))
    await waitFor(() => {
      expect(screen.getByText(/No applications yet/)).toBeInTheDocument()
    })
  })
})
