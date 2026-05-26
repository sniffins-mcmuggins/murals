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
import SignupPage from '../../app/(auth)/signup/page'

const fakeUser = {
  id: '2',
  email: 'bob@example.com',
  role: 'artist' as const,
  created_at: '2024-01-01T00:00:00Z',
}

describe('SignupPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders email, password, role inputs and submit button', () => {
    render(<SignupPage />)
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
    expect(screen.getByRole('combobox')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /create account/i }),
    ).toBeInTheDocument()
  })

  it('renders a link to the login page', () => {
    render(<SignupPage />)
    const link = screen.getByRole('link', { name: /sign in/i })
    expect(link).toHaveAttribute('href', '/login')
  })

  it('redirects to /login?registered=1 on successful signup', async () => {
    mockPost.mockResolvedValueOnce({
      data: fakeUser,
      response: { ok: true, status: 201 },
    })

    render(<SignupPage />)

    await userEvent.type(screen.getByLabelText(/email/i), 'bob@example.com')
    await userEvent.type(screen.getByLabelText(/password/i), 'password123')
    // Role defaults to 'artist' — no change needed.
    await userEvent.click(screen.getByRole('button', { name: /create account/i }))

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/auth/signup', {
        body: {
          email: 'bob@example.com',
          password: 'password123',
          role: 'artist',
        },
      })
      expect(mockPush).toHaveBeenCalledWith('/login?registered=1')
    })
  })

  it('shows "Email already registered" on 409', async () => {
    mockPost.mockResolvedValueOnce({
      data: undefined,
      response: { ok: false, status: 409 },
    })

    render(<SignupPage />)

    await userEvent.type(screen.getByLabelText(/email/i), 'existing@example.com')
    await userEvent.type(screen.getByLabelText(/password/i), 'password123')
    await userEvent.click(screen.getByRole('button', { name: /create account/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Email already registered',
      )
    })
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('shows a validation error on 422', async () => {
    mockPost.mockResolvedValueOnce({
      data: undefined,
      response: { ok: false, status: 422 },
    })

    render(<SignupPage />)

    await userEvent.type(screen.getByLabelText(/email/i), 'bad@example.com')
    await userEvent.type(screen.getByLabelText(/password/i), 'short')
    await userEvent.click(screen.getByRole('button', { name: /create account/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Please check your details',
      )
    })
  })
})
