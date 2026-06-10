import 'server-only'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createApiClient } from '@render/api-client'
import type { components } from '@render/api-client'

type User = components['schemas']['User']

/**
 * Read the session cookie and call GET /me to return the authenticated user.
 * Returns null if no cookie is present or the cookie is invalid/expired.
 *
 * Creates a per-request API client that forwards the session cookie in the
 * Cookie header. Never reuses the singleton apiClient from lib/api.ts — that
 * module-level client is SSR-safe only for unauthenticated requests.
 */
export async function getSessionUser(): Promise<User | null> {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('session')

  if (!sessionCookie?.value) {
    return null
  }

  const sessionValue = sessionCookie.value

  // Create a fresh client per-request and inject the session cookie via
  // the getToken mechanism — but we want a Cookie header, not Bearer.
  // We pass a no-op getToken so the middleware chain is set up, then add
  // a second middleware that sets the Cookie header directly.
  const authedClient = createApiClient({
    baseUrl: process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080',
  })

  // openapi-fetch clients expose .use(middleware) — add cookie injection.
  authedClient.use({
    onRequest({ request }) {
      request.headers.set('Cookie', `session=${sessionValue}`)
      return request
    },
  })

  const { data, response } = await authedClient.GET('/me', {})

  if (response.status === 401 || !data) {
    return null
  }

  return data
}

/**
 * Like getSessionUser() but throws a redirect to /login if not authenticated.
 * Use in Server Components and Server Actions that require authentication.
 */
export async function requireAuth(): Promise<User> {
  const user = await getSessionUser()

  if (!user) {
    redirect('/login')
  }

  return user
}

/**
 * Return true if the authenticated viewer owns the artist profile identified by
 * `profileId`. False for anonymous visitors, other artists, and viewers with no
 * profile. The single source of truth for showing owner-only controls on an
 * otherwise-public page (e.g. the live /artists/{id} page).
 *
 * Keyed on the profile id (not the user id) because public artist routes are
 * keyed on the profile id. Does no fetch at all when there is no session cookie.
 */
export async function isProfileOwner(profileId: string): Promise<boolean> {
  const cookieStore = await cookies()
  const sessionValue = cookieStore.get('session')?.value

  if (!sessionValue) {
    return false
  }

  const authedClient = createApiClient({
    baseUrl: process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080',
  })
  authedClient.use({
    onRequest({ request }) {
      request.headers.set('Cookie', `session=${sessionValue}`)
      return request
    },
  })

  const { data, response } = await authedClient.GET('/profiles/me', {})

  if (response.status === 401 || !data) {
    return false
  }

  return data.id === profileId
}
