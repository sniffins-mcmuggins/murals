import { vi, describe, it, expect, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('@/lib/api', () => ({ apiClient: { GET: vi.fn(), POST: vi.fn(), DELETE: vi.fn() } }))
vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
  useMutation: vi.fn().mockReturnValue({ mutate: vi.fn(), isPending: false }),
  useQueryClient: vi.fn().mockReturnValue({ invalidateQueries: vi.fn() }),
}))

import { useQuery } from '@tanstack/react-query'
import { ReviewersSection } from '@/app/organiser/festivals/[id]/ReviewersSection'

const mockUseQuery = vi.mocked(useQuery)

describe('ReviewersSection', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('shows empty state when no reviewers', async () => {
    mockUseQuery.mockReturnValue({ data: [], isLoading: false } as unknown as ReturnType<typeof useQuery>)
    render(React.createElement(ReviewersSection, { festivalId: 'fest-1' }))
    await waitFor(() => expect(screen.getByText(/No reviewers yet/i)).toBeInTheDocument())
    expect(screen.getByPlaceholderText('email@example.com')).toBeInTheDocument()
  })

  it('renders reviewer list with accepted/pending badges', async () => {
    mockUseQuery.mockReturnValue({
      data: [
        { user_id: 'u1', email: 'jo@test.com', accepted_at: '2026-05-01T10:00:00Z', created_at: '2026-05-01T09:00:00Z' },
        { user_id: 'u2', email: 'hannah@test.com', accepted_at: null, created_at: '2026-05-02T09:00:00Z' },
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof useQuery>)
    render(React.createElement(ReviewersSection, { festivalId: 'fest-1' }))
    await waitFor(() => {
      expect(screen.getByText('jo@test.com')).toBeInTheDocument()
      expect(screen.getByText('hannah@test.com')).toBeInTheDocument()
    })
    expect(screen.getByText('accepted')).toBeInTheDocument()
    expect(screen.getByText('pending')).toBeInTheDocument()
  })

  it('does not invite when email is empty', async () => {
    const { apiClient } = await import('@/lib/api')
    mockUseQuery.mockReturnValue({ data: [], isLoading: false } as unknown as ReturnType<typeof useQuery>)
    render(React.createElement(ReviewersSection, { festivalId: 'fest-1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Invite' }))
    expect(apiClient.POST).not.toHaveBeenCalled()
  })
})
