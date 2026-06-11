import { vi, describe, it, expect, beforeEach } from 'vitest'
import React from 'react'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { renderWithClient, ok, err, byPath } from '../helpers/query'

// Boundary mock: a real QueryClient drives the hooks; we stub only the API and
// the dnd-kit context (so we can fire a synthetic drag without a real pointer).
const { mockGet, mockPost, mockPatch, mockPut } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockPost: vi.fn(),
  mockPatch: vi.fn(),
  mockPut: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  apiClient: { GET: mockGet, POST: mockPost, PATCH: mockPatch, PUT: mockPut },
}))
vi.mock('next/link', () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) =>
    React.createElement('a', { href, className }, children),
}))
vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children, onDragEnd }: { children: React.ReactNode; onDragEnd?: (e: unknown) => void }) => {
    ;(globalThis as Record<string, unknown>).__onDragEnd = onDragEnd
    return React.createElement('div', {}, children)
  },
  DragEndEvent: class {},
  PointerSensor: class {},
  useSensor: vi.fn(),
  useSensors: vi.fn((...args) => args),
  useDroppable: vi.fn(() => ({ setNodeRef: vi.fn(), isOver: false })),
  useDraggable: vi.fn(() => ({ attributes: {}, listeners: {}, setNodeRef: vi.fn(), transform: null })),
}))
vi.mock('@dnd-kit/sortable', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/sortable')>()
  return {
    SortableContext: ({ children }: { children: React.ReactNode }) => children,
    verticalListSortingStrategy: {},
    useSortable: () => ({ attributes: {}, listeners: {}, setNodeRef: vi.fn(), transform: null, transition: undefined, isDragging: false }),
    arrayMove: actual.arrayMove,
  }
})

import ApplicationsReviewPage from '@/app/organiser/festivals/[id]/applications/page'

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

// Wire the four reads the board makes: applications, festival, reviewers, form.
function wireApi(opts: {
  applications?: unknown[]
  festival?: Record<string, unknown>
  reviewer?: boolean
  form?: Record<string, unknown>
} = {}) {
  const routes: Record<string, unknown> = {
    '/festivals/{festivalID}/applications': ok(opts.applications ?? []),
    '/festivals/{festivalID}': ok(opts.festival ?? { decisions_released_at: null }),
    // A reviewer (not organiser) gets 403 on the reviewers list → sentinel branch.
    '/festivals/{festivalID}/reviewers': opts.reviewer ? err(403) : ok([]),
    '/festivals/{festivalID}/form': ok(opts.form ?? { fields: [] }),
  }
  mockGet.mockImplementation(byPath(routes))
}

function renderPage() {
  return renderWithClient(React.createElement(ApplicationsReviewPage, { params: mockParams }))
}

describe('Organiser ApplicationsReviewPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPost.mockResolvedValue(ok({}))
    mockPatch.mockResolvedValue(ok({}))
    mockPut.mockResolvedValue(ok({}))
  })

  it('renders 5 kanban columns with correct headers', async () => {
    wireApi({ applications: [createMockApplication('app-1', 'artist-1')] })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Undecided')).toBeInTheDocument()
      expect(screen.getByText('⭐ Shortlisted')).toBeInTheDocument()
      expect(screen.getByText('✓ Accept')).toBeInTheDocument()
      expect(screen.getByText('~ Waitlist')).toBeInTheDocument()
      expect(screen.getByText('✗ Decline')).toBeInTheDocument()
    })
  })

  it('disables Release when no decisions are staged', async () => {
    wireApi({ applications: [createMockApplication('app-1', 'artist-1')] })
    renderPage()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Release.*decisions/ })).toBeDisabled()
    })
  })

  it('disables Release and flags the count when some apps are still undecided', async () => {
    wireApi({
      applications: [
        createMockApplication('app-1', 'artist-1', { staged_decision: 'accept' }),
        createMockApplication('app-2', 'artist-2', { staged_decision: null }),
      ],
    })
    renderPage()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Release.*decisions/ })).toBeDisabled()
      expect(screen.getByText(/1 still need a decision/)).toBeInTheDocument()
    })
  })

  it('enables Release when every submitted app has a staged decision', async () => {
    wireApi({
      applications: [
        createMockApplication('app-1', 'artist-1', { staged_decision: 'accept' }),
        createMockApplication('app-2', 'artist-2', { staged_decision: 'decline' }),
      ],
    })
    renderPage()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Release.*2.*decisions/ })).not.toBeDisabled()
    })
  })

  it('requires the confirmation checkbox before "Yes, release" is enabled', async () => {
    wireApi({ applications: [createMockApplication('app-1', 'artist-1', { staged_decision: 'accept' })] })
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: /Release.*decisions/ }))
    await screen.findByText('Release decisions?')

    const confirmBtn = screen.getByRole('button', { name: 'Yes, release' })
    expect(confirmBtn).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox'))
    expect(confirmBtn).not.toBeDisabled()
  })

  it('shows the empty-column placeholder when there are no applications', async () => {
    wireApi({ applications: [] })
    renderPage()
    await waitFor(() => {
      expect(screen.getAllByText('empty').length).toBeGreaterThan(0)
    })
  })

  it('hides the Release button in reviewer mode', async () => {
    wireApi({ applications: [createMockApplication('app-1', 'artist-1')], reviewer: true })
    renderPage()
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Release.*decisions/ })).not.toBeInTheDocument()
    })
  })

  it('shows the read-only banner once decisions are released', async () => {
    wireApi({
      applications: [createMockApplication('app-1', 'artist-1', { status: 'accepted' })],
      festival: { decisions_released_at: '2026-05-15T10:00:00Z' },
    })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Decisions released')).toBeInTheDocument()
      expect(screen.getByText('read-only')).toBeInTheDocument()
    })
  })

  it('calls the reorder endpoint when a card is dragged within its column', async () => {
    wireApi({
      applications: [
        createMockApplication('app-1', 'artist-1'),
        createMockApplication('app-2', 'artist-2'),
      ],
    })
    renderPage()

    // Wait for the loaded render (header reflects 2 apps) so the captured
    // onDragEnd closes over populated columns, not the initial empty state.
    await screen.findByText(/2 total/)

    // Both apps are Undecided; drag app-1 onto app-2 → reorder within the column.
    const onDragEnd = (globalThis as Record<string, unknown>).__onDragEnd as (e: unknown) => void
    onDragEnd({ active: { id: 'app-1' }, over: { id: 'app-2' } })

    await waitFor(() => {
      const reorderCall = mockPost.mock.calls.find(
        c => c[0] === '/festivals/{festivalID}/applications/reorder',
      )
      expect(reorderCall).toBeDefined()
      expect(reorderCall?.[1]?.body?.ids).toEqual(['app-2', 'app-1'])
    })
  })
})
