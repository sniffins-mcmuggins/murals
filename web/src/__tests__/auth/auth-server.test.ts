import { describe, expect, it, vi, beforeEach } from 'vitest'

// server-only is a runtime guard — mock it out in tests.
vi.mock('server-only', () => ({}))

// Mock next/navigation redirect.
const mockRedirect = vi.fn()
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    mockRedirect(path)
    // next/navigation redirect() throws in real usage; simulate that so
    // requireAuth() stops execution.
    throw new Error(`NEXT_REDIRECT:${path}`)
  },
}))

// Mock next/headers cookies().
const mockGet = vi.fn()
vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ get: mockGet }),
}))

// Mock @render/api-client — we control the client's GET response per-test.
const mockUse = vi.fn()
const mockGet2 = vi.fn()
vi.mock('@render/api-client', () => ({
  createApiClient: () => ({
    use: mockUse,
    GET: mockGet2,
  }),
}))

// Mock @/lib/api to avoid the module-level createApiClient() call (which fires
// the factory above before mockUse/mockGet2 are initialised, causing TDZ errors).
vi.mock('@/lib/api', () => ({
  apiBaseUrl: 'http://localhost:8080',
  publicApiBaseUrl: 'http://localhost:8080',
  apiClient: { use: vi.fn(), GET: vi.fn() },
}))

// Import the module under test AFTER all mocks are set up.
import { getSessionUser, requireAuth, createAuthedServerClient } from '../../lib/auth-server'

const fakeUser = {
  id: '1',
  email: 'alice@example.com',
  role: 'artist' as const,
  created_at: '2024-01-01T00:00:00Z',
}

describe('getSessionUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when no session cookie is present', async () => {
    mockGet.mockReturnValue(undefined)

    const result = await getSessionUser()
    expect(result).toBeNull()
    expect(mockGet2).not.toHaveBeenCalled()
  })

  it('returns null when session cookie value is empty', async () => {
    mockGet.mockReturnValue({ value: '' })

    const result = await getSessionUser()
    expect(result).toBeNull()
    expect(mockGet2).not.toHaveBeenCalled()
  })

  it('calls GET /me with cookie header injected via middleware', async () => {
    mockGet.mockReturnValue({ value: 'my-session-token' })
    mockGet2.mockResolvedValue({
      data: fakeUser,
      response: { status: 200, ok: true },
    })

    const result = await getSessionUser()

    expect(result).toEqual(fakeUser)

    // Verify that a middleware was registered (to inject the Cookie header).
    expect(mockUse).toHaveBeenCalledWith(
      expect.objectContaining({ onRequest: expect.any(Function) }),
    )

    // Verify GET /me was called.
    expect(mockGet2).toHaveBeenCalledWith('/me', {})
  })

  it('injects the session cookie into the request via the middleware', async () => {
    mockGet.mockReturnValue({ value: 'test-token-123' })
    mockGet2.mockResolvedValue({
      data: fakeUser,
      response: { status: 200, ok: true },
    })

    await getSessionUser()

    // Extract the middleware that was registered and verify it sets the Cookie header.
    const middleware = mockUse.mock.calls[0][0]
    const fakeRequest = {
      headers: {
        set: vi.fn(),
      },
    }
    middleware.onRequest({ request: fakeRequest })
    expect(fakeRequest.headers.set).toHaveBeenCalledWith(
      'Cookie',
      'session=test-token-123',
    )
  })

  it('returns null on 401 from GET /me', async () => {
    mockGet.mockReturnValue({ value: 'expired-token' })
    mockGet2.mockResolvedValue({
      data: undefined,
      response: { status: 401, ok: false },
    })

    const result = await getSessionUser()
    expect(result).toBeNull()
  })
})

describe('createAuthedServerClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when there is no session cookie', async () => {
    mockGet.mockReturnValue(undefined)

    const client = await createAuthedServerClient()
    expect(client).toBeNull()
  })

  it('returns a client with cookie middleware when a session exists', async () => {
    mockGet.mockReturnValue({ value: 'tok123' })

    const client = await createAuthedServerClient()
    expect(client).not.toBeNull()
    // the mocked createApiClient captures .use() calls — assert one was registered
    expect(mockUse).toHaveBeenCalledWith(
      expect.objectContaining({ onRequest: expect.any(Function) }),
    )
  })
})

describe('requireAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the user when authenticated', async () => {
    mockGet.mockReturnValue({ value: 'valid-token' })
    mockGet2.mockResolvedValue({
      data: fakeUser,
      response: { status: 200, ok: true },
    })

    const user = await requireAuth()
    expect(user).toEqual(fakeUser)
  })

  it('redirects to /login when not authenticated', async () => {
    mockGet.mockReturnValue(undefined)

    await expect(requireAuth()).rejects.toThrow('NEXT_REDIRECT:/login')
    expect(mockRedirect).toHaveBeenCalledWith('/login')
  })
})
