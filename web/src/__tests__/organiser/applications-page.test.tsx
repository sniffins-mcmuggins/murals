import { vi, describe, it, expect, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

vi.mock('@/lib/api', () => ({ apiClient: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn() } }))
vi.mock('next/link', () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) =>
    React.createElement('a', { href, className }, children),
}))
vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
  useMutation: vi.fn().mockReturnValue({ mutate: vi.fn(), isPending: false, isError: false }),
  useQueryClient: vi.fn().mockReturnValue({ invalidateQueries: vi.fn() }),
}))
vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => React.createElement('div', {}, children),
  DragEndEvent: class {},
  PointerSensor: class {},
  useSensor: vi.fn(),
  useSensors: vi.fn((...args) => args),
  useDroppable: vi.fn(() => ({ setNodeRef: vi.fn(), isOver: false })),
  useDraggable: vi.fn(() => ({ attributes: {}, listeners: {}, setNodeRef: vi.fn(), transform: null })),
}))

import { useQuery } from '@tanstack/react-query'
import ApplicationsReviewPage from '@/app/organiser/festivals/[id]/applications/page'

const mockUseQuery = vi.mocked(useQuery)

const mockParams = Promise.resolve({ id: 'fest-abc123' })

const createMockApplication = (id: string, artistId: string, overrides = {}) => ({
  id,
  form_id: 'form-1',
  artist_id: artistId,
  status: 'submitted' as const,
  shortlisted: false,
  review_flag: false,
  rank: 0,
  answers: {},
  notes: [],
  staged_decision: null as null,
  created_at: '2026-03-15T10:00:00Z',
  updated_at: '2026-03-15T10:00:00Z',
  ...overrides,
})

describe('Organiser ApplicationsReviewPage', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('shows loading state', () => {
    mockUseQuery.mockReturnValue({ data: undefined, isLoading: true, isError: false } as unknown as ReturnType<typeof useQuery>)
    render(React.createElement(ApplicationsReviewPage, { params: mockParams }))
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('renders 5 kanban columns with correct headers', async () => {
    const applications = [
      createMockApplication('app-1', 'artist-1'),
    ]
    mockUseQuery
      .mockReturnValueOnce({ data: applications, isLoading: false, isError: false } as unknown as ReturnType<typeof useQuery>)
      .mockReturnValueOnce({ data: { decisions_released_at: null }, isLoading: false, isError: false } as unknown as ReturnType<typeof useQuery>)
      .mockReturnValueOnce({ data: [], isLoading: false, isError: false } as unknown as ReturnType<typeof useQuery>)
      .mockReturnValueOnce({ data: { fields: [] }, isLoading: false, isError: false } as unknown as ReturnType<typeof useQuery>)

    render(React.createElement(ApplicationsReviewPage, { params: mockParams }))

    await waitFor(() => {
      expect(screen.getByText('Undecided')).toBeInTheDocument()
      expect(screen.getByText('⭐ Shortlisted')).toBeInTheDocument()
      expect(screen.getByText('✓ Accept')).toBeInTheDocument()
      expect(screen.getByText('~ Waitlist')).toBeInTheDocument()
      expect(screen.getByText('✗ Decline')).toBeInTheDocument()
    })
  })

  it('places undecided applications in Undecided column', async () => {
    const applications = [
      createMockApplication('app-1', 'artist-1', { staged_decision: null, shortlisted: false }),
    ]
    mockUseQuery
      .mockReturnValueOnce({ data: applications, isLoading: false, isError: false } as unknown as ReturnType<typeof useQuery>)
      .mockReturnValueOnce({ data: { decisions_released_at: null }, isLoading: false, isError: false } as unknown as ReturnType<typeof useQuery>)
      .mockReturnValueOnce({ data: [], isLoading: false, isError: false } as unknown as ReturnType<typeof useQuery>)
      .mockReturnValueOnce({ data: { fields: [] }, isLoading: false, isError: false } as unknown as ReturnType<typeof useQuery>)

    render(React.createElement(ApplicationsReviewPage, { params: mockParams }))

    await waitFor(() => {
      expect(screen.getByText('Undecided')).toBeInTheDocument()
    })
  })

  it('places shortlisted applications in Shortlisted column', async () => {
    const applications = [
      createMockApplication('app-1', 'artist-1', { staged_decision: null, shortlisted: true }),
    ]
    mockUseQuery
      .mockReturnValueOnce({ data: applications, isLoading: false, isError: false } as unknown as ReturnType<typeof useQuery>)
      .mockReturnValueOnce({ data: { decisions_released_at: null }, isLoading: false, isError: false } as unknown as ReturnType<typeof useQuery>)
      .mockReturnValueOnce({ data: [], isLoading: false, isError: false } as unknown as ReturnType<typeof useQuery>)
      .mockReturnValueOnce({ data: { fields: [] }, isLoading: false, isError: false } as unknown as ReturnType<typeof useQuery>)

    render(React.createElement(ApplicationsReviewPage, { params: mockParams }))

    await waitFor(() => {
      expect(screen.getByText('⭐ Shortlisted')).toBeInTheDocument()
    })
  })

  it('places staged-accept applications in Accept column', async () => {
    const applications = [
      createMockApplication('app-1', 'artist-1', { staged_decision: 'accept', shortlisted: false }),
    ]
    mockUseQuery
      .mockReturnValueOnce({ data: applications, isLoading: false, isError: false } as unknown as ReturnType<typeof useQuery>)
      .mockReturnValueOnce({ data: { decisions_released_at: null }, isLoading: false, isError: false } as unknown as ReturnType<typeof useQuery>)
      .mockReturnValueOnce({ data: [], isLoading: false, isError: false } as unknown as ReturnType<typeof useQuery>)
      .mockReturnValueOnce({ data: { fields: [] }, isLoading: false, isError: false } as unknown as ReturnType<typeof useQuery>)

    render(React.createElement(ApplicationsReviewPage, { params: mockParams }))

    await waitFor(() => {
      expect(screen.getByText('✓ Accept')).toBeInTheDocument()
    })
  })

  it('shows Release button disabled when no decisions staged', async () => {
    const applications = [
      createMockApplication('app-1', 'artist-1', { staged_decision: null, shortlisted: false }),
    ]
    mockUseQuery
      .mockReturnValueOnce({ data: applications, isLoading: false, isError: false } as unknown as ReturnType<typeof useQuery>)
      .mockReturnValueOnce({ data: { decisions_released_at: null }, isLoading: false, isError: false } as unknown as ReturnType<typeof useQuery>)
      .mockReturnValueOnce({ data: [], isLoading: false, isError: false } as unknown as ReturnType<typeof useQuery>)
      .mockReturnValueOnce({ data: { fields: [] }, isLoading: false, isError: false } as unknown as ReturnType<typeof useQuery>)

    render(React.createElement(ApplicationsReviewPage, { params: mockParams }))

    await waitFor(() => {
      const releaseBtn = screen.getByRole('button', { name: /Release.*decisions/ })
      expect(releaseBtn).toBeDisabled()
    })
  })

  it('shows Release button disabled when some apps are staged but others still undecided', async () => {
    const applications = [
      createMockApplication('app-1', 'artist-1', { staged_decision: 'accept', shortlisted: false }),
      createMockApplication('app-2', 'artist-2', { staged_decision: null, shortlisted: false }),
    ]
    mockUseQuery
      .mockReturnValueOnce({ data: applications, isLoading: false, isError: false } as unknown as ReturnType<typeof useQuery>)
      .mockReturnValueOnce({ data: { decisions_released_at: null }, isLoading: false, isError: false } as unknown as ReturnType<typeof useQuery>)
      .mockReturnValueOnce({ data: [], isLoading: false, isError: false } as unknown as ReturnType<typeof useQuery>)
      .mockReturnValueOnce({ data: { fields: [] }, isLoading: false, isError: false } as unknown as ReturnType<typeof useQuery>)

    render(React.createElement(ApplicationsReviewPage, { params: mockParams }))

    await waitFor(() => {
      const releaseBtn = screen.getByRole('button', { name: /Release.*decisions/ })
      expect(releaseBtn).toBeDisabled()
      expect(screen.getByText(/1 still need a decision/)).toBeInTheDocument()
    })
  })

  it('shows Release button enabled when all submitted apps have staged decisions', async () => {
    const applications = [
      createMockApplication('app-1', 'artist-1', { staged_decision: 'accept', shortlisted: false }),
      createMockApplication('app-2', 'artist-2', { staged_decision: 'decline', shortlisted: false }),
    ]
    mockUseQuery
      .mockReturnValueOnce({ data: applications, isLoading: false, isError: false } as unknown as ReturnType<typeof useQuery>)
      .mockReturnValueOnce({ data: { decisions_released_at: null }, isLoading: false, isError: false } as unknown as ReturnType<typeof useQuery>)
      .mockReturnValueOnce({ data: [], isLoading: false, isError: false } as unknown as ReturnType<typeof useQuery>)
      .mockReturnValueOnce({ data: { fields: [] }, isLoading: false, isError: false } as unknown as ReturnType<typeof useQuery>)

    render(React.createElement(ApplicationsReviewPage, { params: mockParams }))

    await waitFor(() => {
      const releaseBtn = screen.getByRole('button', { name: /Release.*2.*decisions/ })
      expect(releaseBtn).not.toBeDisabled()
    })
  })

  it('confirmation modal requires checkbox before Yes release is enabled', async () => {
    const applications = [
      createMockApplication('app-1', 'artist-1', { staged_decision: 'accept', shortlisted: false }),
    ]
    mockUseQuery
      .mockReturnValueOnce({ data: applications, isLoading: false, isError: false } as unknown as ReturnType<typeof useQuery>)
      .mockReturnValueOnce({ data: { decisions_released_at: null }, isLoading: false, isError: false } as unknown as ReturnType<typeof useQuery>)
      .mockReturnValueOnce({ data: [], isLoading: false, isError: false } as unknown as ReturnType<typeof useQuery>)
      .mockReturnValueOnce({ data: { fields: [] }, isLoading: false, isError: false } as unknown as ReturnType<typeof useQuery>)

    render(React.createElement(ApplicationsReviewPage, { params: mockParams }))

    await waitFor(() => {
      screen.getByRole('button', { name: /Release.*decisions/ })
    })
    fireEvent.click(screen.getByRole('button', { name: /Release.*decisions/ }))

    await waitFor(() => {
      expect(screen.getByText('Release decisions?')).toBeInTheDocument()
    })

    const confirmBtn = screen.getByRole('button', { name: 'Yes, release' })
    expect(confirmBtn).toBeDisabled()  // disabled until checkbox is ticked

    fireEvent.click(screen.getByRole('checkbox'))
    expect(confirmBtn).not.toBeDisabled()  // enabled after checkbox
  })

  it('shows empty state when no applications', async () => {
    mockUseQuery
      .mockReturnValueOnce({ data: [], isLoading: false, isError: false } as unknown as ReturnType<typeof useQuery>)
      .mockReturnValueOnce({ data: { decisions_released_at: null }, isLoading: false, isError: false } as unknown as ReturnType<typeof useQuery>)
      .mockReturnValueOnce({ data: [], isLoading: false, isError: false } as unknown as ReturnType<typeof useQuery>)
      .mockReturnValueOnce({ data: { fields: [] }, isLoading: false, isError: false } as unknown as ReturnType<typeof useQuery>)

    render(React.createElement(ApplicationsReviewPage, { params: mockParams }))

    await waitFor(() => {
      expect(screen.getAllByText('empty').length).toBeGreaterThan(0)
    })
  })

  it('hides Release button and decision controls in reviewer mode', async () => {
    // Multiple useQuery calls: applications, festival, reviewers (sentinel), formQuery
    mockUseQuery
      .mockReturnValueOnce({ data: [
        createMockApplication('app-1', 'artist-1', { staged_decision: null, shortlisted: false }),
      ], isLoading: false, isError: false } as unknown as ReturnType<typeof useQuery>)
      .mockReturnValueOnce({ data: { decisions_released_at: null }, isLoading: false, isError: false } as unknown as ReturnType<typeof useQuery>)
      .mockReturnValueOnce({ data: 'REVIEWER', isLoading: false, isError: false } as unknown as ReturnType<typeof useQuery>)
      .mockReturnValueOnce({ data: { fields: [] }, isLoading: false, isError: false } as unknown as ReturnType<typeof useQuery>)

    render(React.createElement(ApplicationsReviewPage, { params: mockParams }))

    await waitFor(() => {
      // Release button should not exist in reviewer mode
      expect(screen.queryByRole('button', { name: /Release.*decisions/ })).not.toBeInTheDocument()
    })
  })

  it('shows read-only message when decisions are released', async () => {
    const applications = [
      createMockApplication('app-1', 'artist-1', { status: 'accepted', staged_decision: null }),
    ]
    mockUseQuery
      .mockReturnValueOnce({ data: applications, isLoading: false, isError: false } as unknown as ReturnType<typeof useQuery>)
      .mockReturnValueOnce({ data: { decisions_released_at: '2026-05-15T10:00:00Z' }, isLoading: false, isError: false } as unknown as ReturnType<typeof useQuery>)
      .mockReturnValueOnce({ data: [], isLoading: false, isError: false } as unknown as ReturnType<typeof useQuery>)
      .mockReturnValueOnce({ data: { fields: [] }, isLoading: false, isError: false } as unknown as ReturnType<typeof useQuery>)

    render(React.createElement(ApplicationsReviewPage, { params: mockParams }))

    await waitFor(() => {
      expect(screen.getByText('Decisions released')).toBeInTheDocument()
      expect(screen.getByText('read-only')).toBeInTheDocument()
    })
  })
})
