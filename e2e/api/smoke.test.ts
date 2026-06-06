// Cross-cutting smoke tests (issue #113).
//
// Merged from the former cors / geocode / openapi-client / festival-status-gates
// files. These are small, independent checks of platform-level behaviour
// (CORS, geocode proxy, the generated typed client, public-status gating).
// Grouping them into one file removes three Vitest worker startups; each concern
// keeps its own describe block.
import { describe, it, expect, beforeAll } from 'vitest'
import { createApiClient } from '@render/api-client'
import {
  createArtist, createOrganiser, createFestival, setFestivalStatus,
} from '../fixtures/helpers.js'

const API = process.env.API_URL ?? 'http://localhost:8080'

// ─── CORS preflight ──────────────────────────────────────────────────────────
// `corsMiddleware` in `api/cmd/api/main.go` sets ACAO only when the request's
// `Origin` is in the allowlist. Local stack allows `http://localhost:3000`;
// anything else should get no ACAO header. (Even on preflight, which still
// returns 204 to avoid leaking the allowlist.)
describe('CORS preflight', () => {
  it('disallowed Origin → no Access-Control-Allow-Origin on OPTIONS', async () => {
    const res = await fetch(`${API}/me`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://evil.example.com',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization',
      },
    })
    // Preflight returns 204 even for disallowed origins (the missing ACAO is
    // what blocks the browser, not the status code).
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('allowed Origin (localhost:3000) → ACAO header echoes origin', async () => {
    const res = await fetch(`${API}/me`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:3000',
        'Access-Control-Request-Method': 'GET',
      },
    })
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3000')
  })
})

// ─── Geocode search proxy ────────────────────────────────────────────────────
describe('GET /geocode/search', () => {
  const suffix = `geocode-${Date.now()}`
  let token: string

  beforeAll(async () => {
    const u = await createOrganiser(suffix)
    token = u.token
  })

  it('requires authentication', async () => {
    const res = await fetch(`${API}/geocode/search?q=cheltenham`)
    expect(res.status).toBe(401)
  })

  it('returns 400 for empty q', async () => {
    const res = await fetch(`${API}/geocode/search?q=`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 for missing q', async () => {
    const res = await fetch(`${API}/geocode/search`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(400)
  })

  it('returns an array of suggestions for a valid query', async () => {
    const res = await fetch(`${API}/geocode/search?q=cheltenham+uk`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(Array.isArray(data)).toBe(true)
    if (data.length > 0) {
      const first = data[0]
      expect(typeof first.display_name).toBe('string')
      expect(typeof first.lat).toBe('number')
      expect(typeof first.lng).toBe('number')
      expect(data.length).toBeLessThanOrEqual(5)
    }
  })
})

// ─── OpenAPI typed client ────────────────────────────────────────────────────
// Round-trips one happy and one error response through the generated
// `@render/api-client` so that codegen regressions surface immediately:
// types must compile and runtime responses must deserialise into the shapes
// the generated `components['schemas']` describe.
describe('OpenAPI typed client', () => {
  const SUFFIX = `gaps-openapi-${Date.now()}`

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
    expect(res.data?.is_admin).toBe(false)
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

// ─── Festival public-status gate ─────────────────────────────────────────────
// Anonymous `GET /festivals/{id}` must return 404 for `draft` festivals (they
// are not publicly visible) and 200 for `open`/`live` festivals. This regressed
// once historically — see `.claude/rules/e2e-debugging.md`.
describe('festival public-status gate', () => {
  const SUFFIX = `gaps-status-${Date.now()}`

  it('anonymous GET /festivals/{id} → 404 draft, 200 open, 200 live', async () => {
    const organiser = await createOrganiser(SUFFIX)
    const { festivalId } = await createFestival(organiser.token, {
      name: 'Status Gate Fest',
      slug: `status-${SUFFIX}`,
    })

    // draft — invisible
    const draftRes = await fetch(`${API}/festivals/${festivalId}`)
    expect(draftRes.status).toBe(404)

    // open — visible
    await setFestivalStatus(organiser.token, festivalId, 'open')
    const openRes = await fetch(`${API}/festivals/${festivalId}`)
    expect(openRes.status).toBe(200)

    // live — visible
    await setFestivalStatus(organiser.token, festivalId, 'live')
    const liveRes = await fetch(`${API}/festivals/${festivalId}`)
    expect(liveRes.status).toBe(200)
  })
})
