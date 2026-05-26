import { NextRequest, NextResponse } from 'next/server'

/**
 * Protected paths — requests to these routes require an active session cookie.
 * The matcher config below restricts which requests this middleware runs on.
 */
const PROTECTED_PATHS = ['/dashboard', '/profile']

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  const isProtected = PROTECTED_PATHS.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )

  if (!isProtected) {
    return NextResponse.next()
  }

  const sessionCookie = request.cookies.get('session')

  if (!sessionCookie?.value) {
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
