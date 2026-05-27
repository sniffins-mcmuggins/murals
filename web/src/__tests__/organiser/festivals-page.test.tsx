import { vi, describe, it, expect, beforeEach } from 'vitest'
import React from 'react'
import { render, screen } from '@testing-library/react'

vi.mock('@/lib/api', () => ({ apiClient: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn() } }))
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
import FestivalsPage from '@/app/organiser/festivals/page'

const mockUseQuery = vi.mocked(useQuery)

describe('FestivalsPage', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('shows loading state', () => {
    mockUseQuery.mockReturnValueOnce({ data: undefined, isLoading: true } as unknown as ReturnType<typeof useQuery>)
    render(React.createElement(FestivalsPage))
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('shows empty state when no festivals', () => {
    mockUseQuery.mockReturnValueOnce({ data: [], isLoading: false } as unknown as ReturnType<typeof useQuery>)
    render(React.createElement(FestivalsPage))
    expect(screen.getByText(/No festivals yet/)).toBeInTheDocument()
  })

  it('renders festival list', () => {
    const festivals = [
      {
        id: 'fest-1',
        name: 'Cheltenham Paint Festival',
        slug: 'cpf-2027',
        description: 'Annual street art festival',
        location_label: 'Cheltenham, UK',
        start_date: '2027-10-01',
        end_date: '2027-10-07',
        status: 'draft',
        organiser_id: 'org-1',
        created_at: '',
        updated_at: '',
      },
    ]
    mockUseQuery.mockReturnValueOnce({ data: festivals, isLoading: false } as unknown as ReturnType<typeof useQuery>)
    render(React.createElement(FestivalsPage))
    expect(screen.getByText('Cheltenham Paint Festival')).toBeInTheDocument()
    expect(screen.getByText('draft')).toBeInTheDocument()
  })
})
