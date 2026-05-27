// CORS preflight from a disallowed origin (issue #113).
//
// `corsMiddleware` in `api/cmd/api/main.go` sets ACAO only when the request's
// `Origin` is in the allowlist. Local stack allows `http://localhost:3000`;
// anything else should get no ACAO header. (Even on preflight, which still
// returns 204 to avoid leaking the allowlist.)
import { describe, it, expect } from 'vitest'

const API = process.env.API_URL ?? 'http://localhost:8080'

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
