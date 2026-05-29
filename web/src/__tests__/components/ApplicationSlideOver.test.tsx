import { vi, describe, it, expect } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { ApplicationSlideOver } from '@/components/ApplicationSlideOver'
import type { components } from '@render/api-client'

vi.mock('@/components/ApplicationNotes', () => ({
  ApplicationNotes: () => React.createElement('div', { 'data-testid': 'notes' }),
}))
vi.mock('@tanstack/react-query', () => ({
  useMutation: vi.fn().mockReturnValue({ mutate: vi.fn(), isPending: false }),
  useQueryClient: vi.fn().mockReturnValue({ invalidateQueries: vi.fn() }),
}))

const baseApp = {
  id: 'app-1',
  form_id: 'form-1',
  artist_id: 'artist-1',
  status: 'submitted' as const,
  shortlisted: false,
  review_flag: false,
  rank: 0,
  answers: { q1: 'My answer' } as unknown as Record<string, unknown>,
  notes: [],
  avg_score: null,
  score_count: 0,
  my_score: null,
  created_at: '2026-05-01T10:00:00Z',
  updated_at: '2026-05-01T10:00:00Z',
  artist: { display_name: 'Rosa Vane', medium_tags: ['spray paint'], avatar_s3_key: null, location_label: 'Bristol' },
} as unknown as components['schemas']['Application']

const noop = () => {}
const baseProps = {
  festivalId: 'fest-1',
  formFields: [{ id: 'q1', label: 'Tell us about your work', type: 'text', required: true }],
  onClose: noop,
  onAccept: noop,
  onDecline: noop,
  onWaitlist: noop,
  onScore: noop,
  isPending: false,
}

describe('ApplicationSlideOver — owner mode (isReviewer=false)', () => {
  it('shows action buttons', () => {
    render(<ApplicationSlideOver {...baseProps} application={baseApp} isReviewer={false} />)
    expect(screen.getByText('Accept')).toBeInTheDocument()
    expect(screen.getByText('Waitlist')).toBeInTheDocument()
    expect(screen.getByText('Decline')).toBeInTheDocument()
  })

  it('hides avg score when my_score is null', () => {
    render(<ApplicationSlideOver {...baseProps} application={baseApp} isReviewer={false} />)
    expect(screen.queryByText('Panel average')).not.toBeInTheDocument()
  })

  it('shows avg score once my_score is set', () => {
    const app = { ...baseApp, avg_score: 3.5, score_count: 2, my_score: 4 }
    render(<ApplicationSlideOver {...baseProps} application={app} isReviewer={false} />)
    expect(screen.getByText(/Panel average/i)).toBeInTheDocument()
    expect(screen.getByText(/3\.5/)).toBeInTheDocument()
  })
})

describe('ApplicationSlideOver — reviewer mode (isReviewer=true)', () => {
  it('hides action buttons', () => {
    render(<ApplicationSlideOver {...baseProps} application={baseApp} isReviewer={true} />)
    expect(screen.queryByText('Accept')).not.toBeInTheDocument()
    expect(screen.queryByText('Waitlist')).not.toBeInTheDocument()
    expect(screen.queryByText('Decline')).not.toBeInTheDocument()
  })

  it('shows score stars', () => {
    render(<ApplicationSlideOver {...baseProps} application={baseApp} isReviewer={true} />)
    expect(screen.getByLabelText('Score 1')).toBeInTheDocument()
    expect(screen.getByLabelText('Score 5')).toBeInTheDocument()
  })

  it('calls onScore when a star is clicked', () => {
    const onScore = vi.fn()
    render(<ApplicationSlideOver {...baseProps} application={baseApp} isReviewer={true} onScore={onScore} />)
    fireEvent.click(screen.getByLabelText('Score 3'))
    expect(onScore).toHaveBeenCalledWith('app-1', 3)
  })

  it('avg hidden before scoring, visible after', () => {
    const { rerender } = render(<ApplicationSlideOver {...baseProps} application={baseApp} isReviewer={true} />)
    expect(screen.queryByText(/Panel average/i)).not.toBeInTheDocument()

    const app = { ...baseApp, avg_score: 3.0, score_count: 1, my_score: 3 }
    rerender(<ApplicationSlideOver {...baseProps} application={app} isReviewer={true} />)
    expect(screen.getByText(/Panel average/i)).toBeInTheDocument()
  })
})

describe('ApplicationSlideOver — anonymous mode (identity_hidden=true)', () => {
  const anonApp = {
    ...baseApp,
    identity_hidden: true,
    artist: { display_name: '', medium_tags: ['spray paint'], avatar_s3_key: null, location_label: null },
  }

  it('shows "Anonymous artist" in header when identity_hidden=true', () => {
    render(<ApplicationSlideOver {...baseProps} application={anonApp} isReviewer={true} />)
    expect(screen.getByText('Anonymous artist')).toBeInTheDocument()
  })

  it('shows real name when identity_hidden=false', () => {
    const revealedApp = { ...anonApp, identity_hidden: false, artist: { ...baseApp.artist, display_name: 'Rosa Vane' } }
    render(<ApplicationSlideOver {...baseProps} application={revealedApp} isReviewer={true} />)
    expect(screen.getByText('Rosa Vane')).toBeInTheDocument()
  })
})
