import { NextRequest, NextResponse } from 'next/server'

/**
 * Protected paths — requests to these routes require an active session cookie.
 */
const PROTECTED_PATHS = ['/dashboard', '/profile', '/collections', '/applications', '/organiser']

/**
 * Always-open paths even during beta — the funnel stays accessible so
 * non-members can still be pitched (E15 preview/claim) and waitlisted.
 */
const BETA_ALLOWLIST = ['/', '/login', '/signup', '/waitlist', '/preview', '/claim']

// Renamed from `middleware` → `proxy` per the Next.js 16 file convention.
// Runtime is nodejs (the only option for proxy); this handler uses no
// edge-specific APIs, so the switch is transparent.
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const sessionCookie = request.cookies.get('session')

  const betaMode = process.env.NEXT_PUBLIC_BETA_MODE === 'true'

  // In beta mode, redirect unauthenticated visitors away from any path that
  // isn't on the allowlist. They land on /login, which shows a "closed beta"
  // message (or the normal login form — the copy is a product decision).
  if (betaMode && !sessionCookie?.value) {
    const isAllowed = BETA_ALLOWLIST.some(
      (p) => pathname === p || pathname.startsWith(`${p}/`),
    )
    const isAsset =
      pathname.startsWith('/_next') ||
      pathname.startsWith('/api') ||
      /\.\w+$/.test(pathname)

    if (!isAllowed && !isAsset) {
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('next', pathname)
      return NextResponse.redirect(loginUrl)
    }
  }

  // Standard protected-path redirect (works in both beta and non-beta mode).
  const isProtected = PROTECTED_PATHS.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
  if (isProtected && !sessionCookie?.value) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Match all request paths EXCEPT:
     * - / (home)
     * - /login, /signup
     * - /artists, /festivals (public browse pages)
     * - /_next (Next.js internals)
     * - /api (API routes)
     * - Static files (favicon, images, etc.)
     */
    '/((?!$|login|signup|artists|festivals|_next|api|favicon\\.ico|.*\\..*).*)',
  ],
}
