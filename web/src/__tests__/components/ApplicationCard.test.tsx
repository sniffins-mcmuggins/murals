import { vi, describe, it, expect } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { ApplicationCard } from '@/components/ApplicationCard'

vi.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => {},
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
}))
vi.mock('@dnd-kit/utilities', () => ({ CSS: { Transform: { toString: () => '' } } }))

const baseApp = {
  id: 'app-1',
  form_id: 'form-1',
  artist_id: 'artist-1',
  status: 'submitted' as const,
  shortlisted: false,
  review_flag: false,
  rank: 0,
  answers: {},
  notes: [],
  avg_score: null,
  score_count: 0,
  my_score: null,
  created_at: '2026-05-01T10:00:00Z',
  updated_at: '2026-05-01T10:00:00Z',
  artist: { display_name: 'Rosa Vane', medium_tags: [], avatar_s3_key: null, location_label: 'Bristol' },
}

const noop = () => {}

describe('ApplicationCard — owner mode (isReviewer=false)', () => {
  it('shows drag handle, flag buttons, and action buttons', () => {
    render(<ApplicationCard application={baseApp} onSelect={noop} onAccept={noop}
      onDecline={noop} onWaitlist={noop} onToggleShortlist={noop}
      onToggleReviewFlag={noop} onScore={noop} isReviewer={false} isPending={false} />)
    expect(screen.getByLabelText('Drag to reorder')).toBeInTheDocument()
    expect(screen.getByTitle('Shortlist')).toBeInTheDocument()
    expect(screen.getByTitle('Flag for review')).toBeInTheDocument()
    expect(screen.getByText('Accept')).toBeInTheDocument()
  })

  it('shows avg badge when score_count > 0 and my_score != null', () => {
    const app = { ...baseApp, avg_score: 3.5, score_count: 2, my_score: 4 }
    render(<ApplicationCard application={app} onSelect={noop} onAccept={noop}
      onDecline={noop} onWaitlist={noop} onToggleShortlist={noop}
      onToggleReviewFlag={noop} onScore={noop} isReviewer={false} isPending={false} />)
    expect(screen.getByText(/★.*3\.5.*·.*2/)).toBeInTheDocument()
  })

  it('hides avg badge when my_score is null', () => {
    const app = { ...baseApp, avg_score: 3.5, score_count: 2, my_score: null }
    render(<ApplicationCard application={app} onSelect={noop} onAccept={noop}
      onDecline={noop} onWaitlist={noop} onToggleShortlist={noop}
      onToggleReviewFlag={noop} onScore={noop} isReviewer={false} isPending={false} />)
    expect(screen.queryByText(/3\.5/)).not.toBeInTheDocument()
  })
})

describe('ApplicationCard — reviewer mode (isReviewer=true)', () => {
  it('hides drag handle, flag buttons, and action buttons', () => {
    render(<ApplicationCard application={baseApp} onSelect={noop} onAccept={noop}
      onDecline={noop} onWaitlist={noop} onToggleShortlist={noop}
      onToggleReviewFlag={noop} onScore={noop} isReviewer={true} isPending={false} />)
    expect(screen.queryByLabelText('Drag to reorder')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Shortlist')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Flag for review')).not.toBeInTheDocument()
    expect(screen.queryByText('Accept')).not.toBeInTheDocument()
  })

  it('shows star score control when unscored', () => {
    render(<ApplicationCard application={baseApp} onSelect={noop} onAccept={noop}
      onDecline={noop} onWaitlist={noop} onToggleShortlist={noop}
      onToggleReviewFlag={noop} onScore={noop} isReviewer={true} isPending={false} />)
    expect(screen.getByLabelText('Score 1')).toBeInTheDocument()
    expect(screen.getByLabelText('Score 5')).toBeInTheDocument()
  })

  it('calls onScore when a star is clicked', () => {
    const onScore = vi.fn()
    render(<ApplicationCard application={baseApp} onSelect={noop} onAccept={noop}
      onDecline={noop} onWaitlist={noop} onToggleShortlist={noop}
      onToggleReviewFlag={noop} onScore={onScore} isReviewer={true} isPending={false} />)
    fireEvent.click(screen.getByLabelText('Score 4'))
    expect(onScore).toHaveBeenCalledWith('app-1', 4)
  })

  it('shows avg badge after scoring (my_score != null)', () => {
    const app = { ...baseApp, avg_score: 4.0, score_count: 1, my_score: 4 }
    render(<ApplicationCard application={app} onSelect={noop} onAccept={noop}
      onDecline={noop} onWaitlist={noop} onToggleShortlist={noop}
      onToggleReviewFlag={noop} onScore={noop} isReviewer={true} isPending={false} />)
    expect(screen.getByText(/★.*4\.0.*·.*1/)).toBeInTheDocument()
  })
})

describe('ApplicationCard — anonymous mode (identity_hidden=true)', () => {
  const anonApp = {
    ...baseApp,
    identity_hidden: true,
    artist: { display_name: '', medium_tags: ['spray paint'], avatar_s3_key: null, location_label: null },
  }

  it('shows "Anonymous artist" placeholder name', () => {
    render(<ApplicationCard application={anonApp} onSelect={noop} onAccept={noop}
      onDecline={noop} onWaitlist={noop} onToggleShortlist={noop}
      onToggleReviewFlag={noop} onScore={noop} isReviewer={true} isPending={false} />)
    expect(screen.getByText('Anonymous artist')).toBeInTheDocument()
  })

  it('shows "Score to reveal identity" hint', () => {
    render(<ApplicationCard application={anonApp} onSelect={noop} onAccept={noop}
      onDecline={noop} onWaitlist={noop} onToggleShortlist={noop}
      onToggleReviewFlag={noop} onScore={noop} isReviewer={true} isPending={false} />)
    expect(screen.getByText(/Score to reveal/i)).toBeInTheDocument()
  })

  it('shows real name when identity_hidden=false', () => {
    const revealedApp = { ...anonApp, identity_hidden: false, artist: { ...baseApp.artist, display_name: 'Rosa Vane' } }
    render(<ApplicationCard application={revealedApp} onSelect={noop} onAccept={noop}
      onDecline={noop} onWaitlist={noop} onToggleShortlist={noop}
      onToggleReviewFlag={noop} onScore={noop} isReviewer={true} isPending={false} />)
    expect(screen.getByText('Rosa Vane')).toBeInTheDocument()
    expect(screen.queryByText(/Score to reveal/i)).not.toBeInTheDocument()
  })
})
