import { describe, expect, it } from 'vitest'
import { vi } from 'vitest'
import { ApiError } from './index'
import { createApiClient } from './index'

function mockFetch(status: number, body: unknown): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

describe('ApiError', () => {
  it('is an instance of Error with status and title', () => {
    const err = new ApiError({ status: 404, title: 'Not Found' })

    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('ApiError')
    expect(err.message).toBe('Not Found')
    expect(err.status).toBe(404)
    expect(err.title).toBe('Not Found')
  })

  it('carries optional detail and instance fields', () => {
    const err = new ApiError({
      status: 422,
      title: 'Unprocessable Entity',
      detail: 'email is required',
      instance: '/auth/signup',
      type: 'about:blank',
    })

    expect(err.detail).toBe('email is required')
    expect(err.instance).toBe('/auth/signup')
    expect(err.type).toBe('about:blank')
  })
})

describe('createApiClient — no auth', () => {
  it('makes a request without an Authorization header when getToken is not provided', async () => {
    const fetch = mockFetch(200, { status: 'ok' })
    vi.stubGlobal('fetch', fetch)

    const client = createApiClient({ baseUrl: 'http://localhost:8080' })
    await client.GET('/healthz')

    const req = fetch.mock.calls[0][0] as Request
    expect(req.headers.get('Authorization')).toBeNull()

    vi.unstubAllGlobals()
  })
})

describe('createApiClient — auth middleware', () => {
  it('injects Authorization header when getToken returns a string', async () => {
    const fetch = mockFetch(200, { status: 'ok' })
    vi.stubGlobal('fetch', fetch)

    const client = createApiClient({
      baseUrl: 'http://localhost:8080',
      getToken: () => 'sync-token',
    })
    await client.GET('/healthz')

    const req = fetch.mock.calls[0][0] as Request
    expect(req.headers.get('Authorization')).toBe('Bearer sync-token')

    vi.unstubAllGlobals()
  })

  it('awaits an async getToken and injects the header', async () => {
    const fetch = mockFetch(200, { status: 'ok' })
    vi.stubGlobal('fetch', fetch)

    const client = createApiClient({
      baseUrl: 'http://localhost:8080',
      getToken: async () => 'async-token',
    })
    await client.GET('/healthz')

    const req = fetch.mock.calls[0][0] as Request
    expect(req.headers.get('Authorization')).toBe('Bearer async-token')

    vi.unstubAllGlobals()
  })

  it('does not inject Authorization header when getToken returns null', async () => {
    const fetch = mockFetch(200, { status: 'ok' })
    vi.stubGlobal('fetch', fetch)

    const client = createApiClient({
      baseUrl: 'http://localhost:8080',
      getToken: () => null,
    })
    await client.GET('/healthz')

    const req = fetch.mock.calls[0][0] as Request
    expect(req.headers.get('Authorization')).toBeNull()

    vi.unstubAllGlobals()
  })
})
