import { describe, it, expect, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { proxy } from '@/proxy'

// Build a NextRequest for `path`, optionally carrying a session cookie.
function req(path: string, withSession = false): NextRequest {
  const r = new NextRequest(new URL(`http://localhost:3000${path}`))
  if (withSession) r.cookies.set('session', 'tok')
  return r
}

function locationOf(res: ReturnType<typeof proxy>): string | null {
  const loc = res.headers.get('location')
  return loc ? new URL(loc).pathname + new URL(loc).search : null
}

describe('proxy', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  describe('non-beta mode', () => {
    it('redirects an unauthenticated visitor away from a protected path to /login with next', () => {
      vi.stubEnv('NEXT_PUBLIC_BETA_MODE', 'false')
      const res = proxy(req('/dashboard'))
      expect(res.status).toBe(307)
      expect(locationOf(res)).toBe('/login?next=%2Fdashboard')
    })

    it('lets an authenticated visitor through to a protected path', () => {
      vi.stubEnv('NEXT_PUBLIC_BETA_MODE', 'false')
      const res = proxy(req('/dashboard', true))
      expect(res.headers.get('location')).toBeNull()
    })

    it('does not protect a public browse path', () => {
      vi.stubEnv('NEXT_PUBLIC_BETA_MODE', 'false')
      const res = proxy(req('/artists/abc'))
      expect(res.headers.get('location')).toBeNull()
    })

    it('protects nested paths under a protected prefix', () => {
      vi.stubEnv('NEXT_PUBLIC_BETA_MODE', 'false')
      const res = proxy(req('/organiser/festivals/1/applications'))
      expect(res.status).toBe(307)
      expect(locationOf(res)).toBe('/login?next=%2Forganiser%2Ffestivals%2F1%2Fapplications')
    })
  })

  describe('beta mode', () => {
    it('redirects an unauthenticated visitor off a non-allowlisted path', () => {
      vi.stubEnv('NEXT_PUBLIC_BETA_MODE', 'true')
      const res = proxy(req('/artists/abc'))
      expect(res.status).toBe(307)
      expect(locationOf(res)).toBe('/login?next=%2Fartists%2Fabc')
    })

    it('allows an allowlisted path (signup) without a session', () => {
      vi.stubEnv('NEXT_PUBLIC_BETA_MODE', 'true')
      const res = proxy(req('/signup'))
      expect(res.headers.get('location')).toBeNull()
    })

    it('allows a claim/preview funnel path without a session', () => {
      vi.stubEnv('NEXT_PUBLIC_BETA_MODE', 'true')
      const res = proxy(req('/preview/some-artist'))
      expect(res.headers.get('location')).toBeNull()
    })

    it('does not block static asset requests', () => {
      vi.stubEnv('NEXT_PUBLIC_BETA_MODE', 'true')
      const res = proxy(req('/logo.png'))
      expect(res.headers.get('location')).toBeNull()
    })

    it('lets an authenticated visitor through any path', () => {
      vi.stubEnv('NEXT_PUBLIC_BETA_MODE', 'true')
      const res = proxy(req('/artists/abc', true))
      expect(res.headers.get('location')).toBeNull()
    })
  })
})
