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
      onToggleReviewFlag={noop} onScore={noop} isReviewer={false} isPending={false} criteria={[]} />)
    expect(screen.getByLabelText('Drag to reorder')).toBeInTheDocument()
    expect(screen.getByTitle('Shortlist')).toBeInTheDocument()
    expect(screen.getByTitle('Flag for review')).toBeInTheDocument()
    expect(screen.getByText('Accept')).toBeInTheDocument()
  })

  it('shows avg badge when score_count > 0 and my_score != null', () => {
    const app = { ...baseApp, avg_score: 3.5, score_count: 2, my_score: 4 }
    render(<ApplicationCard application={app} onSelect={noop} onAccept={noop}
      onDecline={noop} onWaitlist={noop} onToggleShortlist={noop}
      onToggleReviewFlag={noop} onScore={noop} isReviewer={false} isPending={false} criteria={[]} />)
    expect(screen.getByText(/★.*3\.5.*·.*2/)).toBeInTheDocument()
  })

  it('hides avg badge when my_score is null', () => {
    const app = { ...baseApp, avg_score: 3.5, score_count: 2, my_score: null }
    render(<ApplicationCard application={app} onSelect={noop} onAccept={noop}
      onDecline={noop} onWaitlist={noop} onToggleShortlist={noop}
      onToggleReviewFlag={noop} onScore={noop} isReviewer={false} isPending={false} criteria={[]} />)
    expect(screen.queryByText(/3\.5/)).not.toBeInTheDocument()
  })
})

describe('ApplicationCard — reviewer mode (isReviewer=true)', () => {
  it('hides drag handle, flag buttons, and action buttons', () => {
    render(<ApplicationCard application={baseApp} onSelect={noop} onAccept={noop}
      onDecline={noop} onWaitlist={noop} onToggleShortlist={noop}
      onToggleReviewFlag={noop} onScore={noop} isReviewer={true} isPending={false} criteria={[]} />)
    expect(screen.queryByLabelText('Drag to reorder')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Shortlist')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Flag for review')).not.toBeInTheDocument()
    expect(screen.queryByText('Accept')).not.toBeInTheDocument()
  })

  it('shows star score control when unscored', () => {
    render(<ApplicationCard application={baseApp} onSelect={noop} onAccept={noop}
      onDecline={noop} onWaitlist={noop} onToggleShortlist={noop}
      onToggleReviewFlag={noop} onScore={noop} isReviewer={true} isPending={false} criteria={[]} />)
    expect(screen.getByLabelText('Score 1')).toBeInTheDocument()
    expect(screen.getByLabelText('Score 5')).toBeInTheDocument()
  })

  it('calls onScore when a star is clicked', () => {
    const onScore = vi.fn()
    render(<ApplicationCard application={baseApp} onSelect={noop} onAccept={noop}
      onDecline={noop} onWaitlist={noop} onToggleShortlist={noop}
      onToggleReviewFlag={noop} onScore={onScore} isReviewer={true} isPending={false} criteria={[]} />)
    fireEvent.click(screen.getByLabelText('Score 4'))
    expect(onScore).toHaveBeenCalledWith('app-1', 4)
  })

  it('shows avg badge after scoring (my_score != null)', () => {
    const app = { ...baseApp, avg_score: 4.0, score_count: 1, my_score: 4 }
    render(<ApplicationCard application={app} onSelect={noop} onAccept={noop}
      onDecline={noop} onWaitlist={noop} onToggleShortlist={noop}
      onToggleReviewFlag={noop} onScore={noop} isReviewer={true} isPending={false} criteria={[]} />)
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
      onToggleReviewFlag={noop} onScore={noop} isReviewer={true} isPending={false} criteria={[]} />)
    expect(screen.getByText('Anonymous artist')).toBeInTheDocument()
  })

  it('shows "Score to reveal identity" hint', () => {
    render(<ApplicationCard application={anonApp} onSelect={noop} onAccept={noop}
      onDecline={noop} onWaitlist={noop} onToggleShortlist={noop}
      onToggleReviewFlag={noop} onScore={noop} isReviewer={true} isPending={false} criteria={[]} />)
    expect(screen.getByText(/Score to reveal/i)).toBeInTheDocument()
  })

  it('shows real name when identity_hidden=false', () => {
    const revealedApp = { ...anonApp, identity_hidden: false, artist: { ...baseApp.artist, display_name: 'Rosa Vane' } }
    render(<ApplicationCard application={revealedApp} onSelect={noop} onAccept={noop}
      onDecline={noop} onWaitlist={noop} onToggleShortlist={noop}
      onToggleReviewFlag={noop} onScore={noop} isReviewer={true} isPending={false} criteria={[]} />)
    expect(screen.getByText('Rosa Vane')).toBeInTheDocument()
    expect(screen.queryByText(/Score to reveal/i)).not.toBeInTheDocument()
  })
})

describe('ApplicationCard — rubric mode (criteria configured)', () => {
  const rubricApp = {
    ...baseApp,
    criterion_scores: [
      { criterion_id: 'art', label: 'Artistic Quality', min: 1, max: 5, avg_score: null, score_count: 0, my_score: null },
      { criterion_id: 'feas', label: 'Feasibility', min: 1, max: 5, avg_score: null, score_count: 0, my_score: null },
    ],
  }
  const criteria = [
    { id: 'art', label: 'Artistic Quality', min: 1, max: 5 },
    { id: 'feas', label: 'Feasibility', min: 1, max: 5 },
  ]

  it('shows "Score →" button instead of inline stars when criteria are configured', () => {
    render(<ApplicationCard application={rubricApp} onSelect={noop} onAccept={noop}
      onDecline={noop} onWaitlist={noop} onToggleShortlist={noop}
      onToggleReviewFlag={noop} onScore={noop} isReviewer={true} isPending={false}
      criteria={criteria} />)
    expect(screen.getByRole('button', { name: /Score/i })).toBeInTheDocument()
    expect(screen.queryByLabelText('Score 1')).not.toBeInTheDocument()
  })

  it('calls onSelect when "Score →" button is clicked', () => {
    const onSelect = vi.fn()
    render(<ApplicationCard application={rubricApp} onSelect={onSelect} onAccept={noop}
      onDecline={noop} onWaitlist={noop} onToggleShortlist={noop}
      onToggleReviewFlag={noop} onScore={noop} isReviewer={true} isPending={false}
      criteria={criteria} />)
    fireEvent.click(screen.getByRole('button', { name: /Score/i }))
    expect(onSelect).toHaveBeenCalledWith(rubricApp)
  })
})
