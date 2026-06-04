import { vi, describe, it, expect } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { ApplicationCard } from '@/components/ApplicationCard'

vi.mock('@dnd-kit/core', () => ({
  useDraggable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => {},
    transform: null,
    isDragging: false,
  }),
}))
vi.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
}))
vi.mock('@dnd-kit/utilities', () => ({ CSS: { Translate: { toString: () => '' } } }))

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

const defaultOwnerProps = {
  onSelect: noop,
  onToggleShortlist: noop,
  onScore: noop,
  isReviewer: false,
  isPending: false,
  criteria: [],
  isDraggable: true,
  columnKey: 'undecided',
  isReleased: false,
}

describe('ApplicationCard — owner mode (isReviewer=false)', () => {
  it('shows drag handle and shortlist button', () => {
    render(<ApplicationCard application={baseApp} {...defaultOwnerProps} />)
    expect(screen.getByLabelText('Drag to reorder')).toBeInTheDocument()
    expect(screen.getByTitle('Shortlist')).toBeInTheDocument()
  })

  it('shows avg badge when score_count > 0 and avg_score != null', () => {
    const app = { ...baseApp, avg_score: 3.5, score_count: 2, my_score: 4 }
    render(<ApplicationCard application={app} {...defaultOwnerProps} />)
    expect(screen.getByText(/★.*3\.5/)).toBeInTheDocument()
  })

  it('hides avg badge when score_count is 0', () => {
    const app = { ...baseApp, avg_score: 3.5, score_count: 0, my_score: null }
    render(<ApplicationCard application={app} {...defaultOwnerProps} />)
    expect(screen.queryByText(/3\.5/)).not.toBeInTheDocument()
  })

  it('does not show drag handle when isDraggable=false', () => {
    render(<ApplicationCard application={baseApp} {...defaultOwnerProps} isDraggable={false} />)
    expect(screen.queryByLabelText('Drag to reorder')).not.toBeInTheDocument()
  })

  it('does not show shortlist button when isReleased=true', () => {
    render(<ApplicationCard application={baseApp} {...defaultOwnerProps} isReleased={true} columnKey="accept" />)
    expect(screen.queryByTitle('Shortlist')).not.toBeInTheDocument()
  })
})

describe('ApplicationCard — reviewer mode (isReviewer=true)', () => {
  const reviewerProps = { ...defaultOwnerProps, isReviewer: true, isDraggable: false }

  it('hides drag handle and shortlist button', () => {
    render(<ApplicationCard application={baseApp} {...reviewerProps} />)
    expect(screen.queryByLabelText('Drag to reorder')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Shortlist')).not.toBeInTheDocument()
  })

  it('shows "Score" button when unscored', () => {
    render(<ApplicationCard application={baseApp} {...reviewerProps} />)
    expect(screen.getByRole('button', { name: /^Score$/ })).toBeInTheDocument()
  })

  it('shows "Edit score" button when already scored', () => {
    const app = { ...baseApp, my_score: 4 }
    render(<ApplicationCard application={app} {...reviewerProps} />)
    expect(screen.getByRole('button', { name: /Edit score/ })).toBeInTheDocument()
  })

  it('calls onSelect when Score button is clicked', () => {
    const onSelect = vi.fn()
    render(<ApplicationCard application={baseApp} {...reviewerProps} onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('button', { name: /^Score$/ }))
    expect(onSelect).toHaveBeenCalledWith(baseApp)
  })
})

describe('ApplicationCard — column background colours', () => {
  it('applies green background for accept column', () => {
    const { container } = render(
      <ApplicationCard application={baseApp} {...defaultOwnerProps} columnKey="accept" />
    )
    expect(container.firstChild).toHaveClass('bg-green-50')
  })

  it('applies warm background for undecided column', () => {
    const { container } = render(
      <ApplicationCard application={baseApp} {...defaultOwnerProps} columnKey="undecided" />
    )
    expect(container.firstChild).toHaveClass('bg-warm')
  })
})
