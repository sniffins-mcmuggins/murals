import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'

// vi.hoisted ensures these are available when the vi.mock factory is hoisted.
const { mockPush, mockPost } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockPost: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/lib/api', () => ({
  apiClient: {
    POST: mockPost,
  },
}))

// Import after mocks are set up.
import LoginPage from '../../app/(auth)/login/page'

const fakeUser = {
  id: '1',
  email: 'alice@example.com',
  role: 'artist' as const,
  created_at: '2024-01-01T00:00:00Z',
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders email, password inputs and submit button', () => {
    render(<LoginPage />)
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
  })

  it('renders a link to the signup page', () => {
    render(<LoginPage />)
    const link = screen.getByRole('link', { name: /sign up/i })
    expect(link).toHaveAttribute('href', '/signup')
  })

  it('redirects to / on successful login', async () => {
    mockPost.mockResolvedValueOnce({
      data: { token: 'tok', user: fakeUser },
      response: { ok: true, status: 200 },
    })

    render(<LoginPage />)

    await userEvent.type(screen.getByLabelText(/email/i), 'alice@example.com')
    await userEvent.type(screen.getByLabelText(/password/i), 'password123')
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/auth/login', {
        body: { email: 'alice@example.com', password: 'password123' },
      })
      expect(mockPush).toHaveBeenCalledWith('/')
    })
  })

  it('shows an error on 401', async () => {
    mockPost.mockResolvedValueOnce({
      data: undefined,
      response: { ok: false, status: 401 },
    })

    render(<LoginPage />)

    await userEvent.type(screen.getByLabelText(/email/i), 'bad@example.com')
    await userEvent.type(screen.getByLabelText(/password/i), 'wrongpass')
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Invalid email or password',
      )
    })
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('shows a generic error on unexpected response status', async () => {
    mockPost.mockResolvedValueOnce({
      data: undefined,
      response: { ok: false, status: 500 },
    })

    render(<LoginPage />)

    await userEvent.type(screen.getByLabelText(/email/i), 'test@example.com')
    await userEvent.type(screen.getByLabelText(/password/i), 'password123')
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Something went wrong',
      )
    })
  })
})
