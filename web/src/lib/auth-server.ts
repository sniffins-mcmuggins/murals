import 'server-only'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createApiClient } from '@render/api-client'
import type { components } from '@render/api-client'
import { apiBaseUrl } from './api'

type User = components['schemas']['User']
type ApiClient = ReturnType<typeof createApiClient>

/**
 * Per-request API client with the session cookie injected. Returns null when
 * there is no session cookie — callers decide whether that means redirect,
 * 403, or anonymous fallback. This is THE way to make authed API calls from
 * Server Components; never reuse the singleton apiClient for authed calls.
 */
export async function createAuthedServerClient(): Promise<ApiClient | null> {
  const cookieStore = await cookies()
  const sessionValue = cookieStore.get('session')?.value
  if (!sessionValue) return null

  const client = createApiClient({ baseUrl: apiBaseUrl })
  client.use({
    onRequest({ request }) {
      request.headers.set('Cookie', `session=${sessionValue}`)
      return request
    },
  })
  return client
}

/**
 * Read the session cookie and call GET /me to return the authenticated user.
 * Returns null if no cookie is present or the cookie is invalid/expired.
 *
 * Creates a per-request API client that forwards the session cookie in the
 * Cookie header. Never reuses the singleton apiClient from lib/api.ts — that
 * module-level client is SSR-safe only for unauthenticated requests.
 */
export async function getSessionUser(): Promise<User | null> {
  const authedClient = await createAuthedServerClient()
  if (!authedClient) return null

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
  const authedClient = await createAuthedServerClient()
  if (!authedClient) return false

  const { data, response } = await authedClient.GET('/profiles/me', {})

  if (response.status === 401 || !data) {
    return false
  }

  return data.id === profileId
}
