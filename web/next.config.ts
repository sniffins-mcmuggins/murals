import type { NextConfig } from 'next'

// Baseline security response headers, applied to every route. These four are safe
// in every environment (they don't affect navigation, HMR, or Playwright) — the
// env flag is a kill-switch + the future home for the fragile bits:
//   - SECURITY_HEADERS=off disables them entirely (escape hatch for local/CI).
//   - HSTS is intentionally absent — it belongs at the TLS terminator (ALB/CDN),
//     not on http://localhost.
//   - CSP is intentionally absent — it needs a Leaflet/OSM-tile/image-host
//     allowlist and a report-only soak before enforcing. Add it here, gated by
//     this same flag, when that work happens.
const securityHeadersEnabled = process.env.SECURITY_HEADERS !== 'off'

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
]

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@render/api-client'],
  // Type-check every <Link href> / router.push against the real route tree, so a
  // link to a non-existent route is a compile error (caught by `task lint` in CI),
  // not a silent runtime 404. See docs/ui-health — this caught a dangling
  // /festivals/{id}/apply link that had shipped to the public festival page.
  typedRoutes: true,
  // Don't advertise the framework/version in responses (fingerprinting hygiene).
  poweredByHeader: false,
  // Log the full URL of every server-side fetch in dev. Makes the API_URL vs
  // NEXT_PUBLIC_API_URL footgun (a stray localhost:8080 call from a Server
  // Component → ECONNREFUSED) visible immediately instead of as an opaque 500.
  logging: { fetches: { fullUrl: true } },
  async headers() {
    if (!securityHeadersEnabled) return []
    return [{ source: '/(.*)', headers: securityHeaders }]
  },
}

export default nextConfig
