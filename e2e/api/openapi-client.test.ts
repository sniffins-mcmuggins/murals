// OpenAPI typed-client smoke (issue #113).
//
// Round-trips one happy and one error response through the generated
// `@render/api-client` so that codegen regressions surface immediately:
// types must compile and runtime responses must deserialise into the shapes
// the generated `components['schemas']` describe.
import { describe, it, expect } from 'vitest'
import { createApiClient } from '@render/api-client'
import { createArtist } from '../fixtures/helpers.js'

const API = process.env.API_URL ?? 'http://localhost:8080'
const SUFFIX = `gaps-openapi-${Date.now()}`

describe('OpenAPI typed client', () => {
  it('GET /healthz round-trips via createApiClient', async () => {
    const client = createApiClient({ baseUrl: API })
    const res = await client.GET('/healthz')

    // openapi-fetch surfaces 2xx in `data`, problem+json in `error`.
    expect(res.error).toBeUndefined()
    expect(res.data).toBeDefined()
    expect(res.data?.status).toBe('ok')
  })

  it('GET /me with a valid token returns the authenticated user', async () => {
    const artist = await createArtist(`${SUFFIX}-me`)
    const client = createApiClient({
      baseUrl: API,
      getToken: () => artist.token,
    })

    const res = await client.GET('/me')
    expect(res.error).toBeUndefined()
    expect(res.data).toBeDefined()
    expect(res.data?.id).toBe(artist.userId)
    expect(res.data?.email).toBe(artist.email)
    expect(res.data?.role).toBe('artist')
  })

  it('GET /me without auth surfaces a typed problem response', async () => {
    const client = createApiClient({ baseUrl: API })
    const res = await client.GET('/me')

    expect(res.data).toBeUndefined()
    expect(res.error).toBeDefined()
    expect(res.error?.status).toBe(401)
    // The spec models error responses as Problem (RFC 7807) — title is required.
    expect(typeof res.error?.title).toBe('string')
  })
})
