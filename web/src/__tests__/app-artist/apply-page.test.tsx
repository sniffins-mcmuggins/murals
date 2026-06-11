import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithClient, ok, err, byPath } from '../helpers/query'

const { mockPush, mockGet, mockPost } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockGet: vi.fn(),
  mockPost: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'fest-1' }),
  useRouter: () => ({ push: mockPush }),
}))

vi.mock('@/lib/api', () => ({
  apiClient: { GET: mockGet, POST: mockPost },
}))

// DynamicForm has its own test; stub it to a single submit button so this test
// covers the page's wiring (queries, prefill, mutation) rather than form internals.
vi.mock('@/components/DynamicForm', () => ({
  __esModule: true,
  default: ({
    fields,
    submitting,
    onSubmit,
  }: {
    fields: { id: string }[]
    submitting: boolean
    onSubmit: (a: Record<string, string>) => void
  }) => (
    <div>
      <span data-testid="field-count">{fields.length}</span>
      <button type="button" disabled={submitting} onClick={() => onSubmit({ q1: 'an answer' })}>
        Submit application
      </button>
    </div>
  ),
  type: {},
}))

import ApplyPage from '@/app/(artist)/applications/apply/[id]/page'

const festival = { id: 'fest-1', name: 'Cheltenham Paint Festival', status: 'open' }
const profile = { id: 'prof-1', display_name: 'Lady Gabe', bio: 'Muralist' }

const formNoBound = { id: 'form-1', fields: [{ id: 'q1', label: 'Why?', type: 'text', required: false }] }
const formBound = {
  id: 'form-1',
  fields: [{ id: 'name', label: 'Your name', type: 'text', required: true, prefill: 'display_name' }],
}

function baseRoutes(overrides: Record<string, unknown> = {}) {
  return {
    '/festivals/{festivalID}': ok(festival),
    '/festivals/{festivalID}/form': ok(formNoBound),
    '/profiles/me': ok(profile),
    '/profiles/{profileID}/collections': ok([]),
    ...overrides,
  }
}

describe('ApplyPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPost.mockResolvedValue(ok({ id: 'app-1' }))
  })

  it('shows an error message when a query fails', async () => {
    mockGet.mockImplementation(byPath(baseRoutes({ '/festivals/{festivalID}': err(500) })))
    renderWithClient(<ApplyPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/Couldn.t load your details/i)
  })

  it('renders the festival name and the application form', async () => {
    mockGet.mockImplementation(byPath(baseRoutes()))
    renderWithClient(<ApplyPage />)
    expect(
      await screen.findByRole('heading', { name: /Apply to Cheltenham Paint Festival/i }),
    ).toBeInTheDocument()
    expect(screen.getByTestId('field-count')).toHaveTextContent('1')
  })

  it('submits answers from the form and shows the success screen', async () => {
    mockGet.mockImplementation(byPath(baseRoutes()))
    renderWithClient(<ApplyPage />)

    const submit = await screen.findByRole('button', { name: /Submit application/i })
    await userEvent.click(submit)

    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith(
        '/festivals/{festivalID}/apply',
        expect.objectContaining({ body: { answers: { q1: 'an answer' } } }),
      ),
    )
    expect(await screen.findByRole('heading', { name: /Application submitted/i })).toBeInTheDocument()
  })

  it('offers "Apply with my profile" when fields are prefilled and submits the resolved answers', async () => {
    mockGet.mockImplementation(byPath(baseRoutes({ '/festivals/{festivalID}/form': ok(formBound) })))
    renderWithClient(<ApplyPage />)

    expect(await screen.findByText(/pre-filled 1 question/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Apply with my profile/i }))

    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith(
        '/festivals/{festivalID}/apply',
        expect.objectContaining({ body: { answers: { name: 'Lady Gabe' } } }),
      ),
    )
  })

  it('shows the "profile required" prompt when the API rejects with profile_required', async () => {
    mockGet.mockImplementation(byPath(baseRoutes()))
    mockPost.mockResolvedValue(err(409, { error: 'profile_required' }))

    renderWithClient(<ApplyPage />)
    await userEvent.click(await screen.findByRole('button', { name: /Submit application/i }))

    expect(await screen.findByText(/You need an artist profile to apply/i)).toBeInTheDocument()
  })
})
