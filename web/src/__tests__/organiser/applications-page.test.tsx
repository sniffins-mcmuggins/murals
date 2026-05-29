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

  it('shows applications list in tabs with counts', async () => {
    const applications = [
      {
        id: 'app-1',
        form_id: 'form-1',
        artist_id: 'aabbccdd-1234-5678-abcd-111111111111',
        status: 'submitted',
        shortlisted: false,
        review_flag: false,
        rank: 0,
        answers: {},
        notes: [],
        created_at: '2026-03-15T10:00:00Z',
        updated_at: '2026-03-15T10:00:00Z',
      },
      {
        id: 'app-2',
        form_id: 'form-1',
        artist_id: 'eeff0011-1234-5678-abcd-222222222222',
        status: 'accepted',
        shortlisted: false,
        review_flag: false,
        rank: 0,
        answers: {},
        notes: [],
        created_at: '2026-02-01T10:00:00Z',
        updated_at: '2026-02-02T10:00:00Z',
      },
      {
        id: 'app-3',
        form_id: 'form-1',
        artist_id: 'gghhiijj-1234-5678-abcd-333333333333',
        status: 'declined',
        shortlisted: false,
        review_flag: false,
        rank: 0,
        answers: {},
        notes: [],
        created_at: '2026-01-10T10:00:00Z',
        updated_at: '2026-01-11T10:00:00Z',
      },
    ]
    mockUseQuery.mockReturnValue({ data: applications, isLoading: false } as unknown as ReturnType<typeof useQuery>)
    render(React.createElement(ApplicationsReviewPage, { params: mockParams }))

    await waitFor(() => {
      // All five tabs are rendered
      expect(screen.getByText('Pending')).toBeInTheDocument()
      expect(screen.getByText('Shortlisted')).toBeInTheDocument()
      expect(screen.getByText('Accepted')).toBeInTheDocument()
      expect(screen.getByText('Waitlisted')).toBeInTheDocument()
      expect(screen.getByText('Declined')).toBeInTheDocument()
    })
    // Pending tab is active by default — the submitted+non-shortlisted application is visible
    expect(screen.getByTitle('Shortlist')).toBeInTheDocument()
    expect(screen.getByText('Accept')).toBeInTheDocument()
  })

  it('shows empty state when no applications', async () => {
    mockUseQuery.mockReturnValue({ data: [], isLoading: false } as unknown as ReturnType<typeof useQuery>)
    render(React.createElement(ApplicationsReviewPage, { params: mockParams }))
    await waitFor(() => {
      expect(screen.getByText('No applications here.')).toBeInTheDocument()
    })
  })

  it('hides decision controls and shows star control in reviewer mode', async () => {
    // First useQuery call = applications (200), second = reviewers (403 sentinel)
    mockUseQuery
      .mockReturnValueOnce({ data: [{
        id: 'app-1', form_id: 'form-1', artist_id: 'artist-1',
        status: 'submitted', shortlisted: false, review_flag: false, rank: 0,
        answers: {}, notes: [], avg_score: null, score_count: 0, my_score: null,
        created_at: '2026-05-01T10:00:00Z', updated_at: '2026-05-01T10:00:00Z',
        artist: { display_name: 'Rosa Vane', medium_tags: [], avatar_s3_key: null, location_label: null },
      }], isLoading: false } as unknown as ReturnType<typeof useQuery>)
      .mockReturnValueOnce({ data: 'REVIEWER', isLoading: false } as unknown as ReturnType<typeof useQuery>)
      // formQuery
      .mockReturnValueOnce({ data: { fields: [] }, isLoading: false } as unknown as ReturnType<typeof useQuery>)

    render(React.createElement(ApplicationsReviewPage, { params: mockParams }))

    await waitFor(() => {
      expect(screen.queryByText('Accept')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('Drag to reorder')).not.toBeInTheDocument()
      expect(screen.getByLabelText('Score 1')).toBeInTheDocument()
    })
  })
})
