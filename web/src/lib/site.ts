// Canonical public base URL of the browser platform, used for SEO output
// (canonical links, OpenGraph URLs, sitemap, robots). Must never be a Docker
// internal hostname — these URLs ship to crawlers and social scrapers.
//
// Prod sets NEXT_PUBLIC_SITE_URL (e.g. https://render.art). Local dev falls
// back to the dev server origin. NEXT_PUBLIC_* is inlined at build time and is
// readable both server- and client-side.
const DEFAULT_SITE_URL = 'http://localhost:3000'

export function siteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL ?? DEFAULT_SITE_URL
  return raw.replace(/\/+$/, '')
}

export function absoluteUrl(path: string): string {
  const base = siteUrl()
  const suffix = path.startsWith('/') ? path : `/${path}`
  return `${base}${suffix}`
}
