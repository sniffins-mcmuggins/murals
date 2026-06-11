import type { ReactElement } from 'react'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * Render a component tree inside a real React Query provider with retries off.
 *
 * This is the preferred pattern for testing client pages/hooks: drive them with
 * a genuine QueryClient and mock at the API boundary (`@/lib/api`) instead of
 * stubbing `@tanstack/react-query` and satisfying each `useQuery` positionally.
 * Tests then assert behaviour ("shows 3 applications") rather than hook order.
 */
export function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return {
    queryClient,
    ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>),
  }
}

/** An openapi-fetch style success result. */
export function ok<T>(data: T, status = 200) {
  return { data, error: null, response: { ok: status < 400, status } }
}

/** An openapi-fetch style error result. */
export function err(status: number, error: unknown = { error: 'error' }) {
  return { data: undefined, error, response: { ok: false, status } }
}

/**
 * Build a mock implementation for `apiClient.GET`/`POST`/… that dispatches by
 * the path string (the first argument). Unmocked paths throw so a missing route
 * surfaces loudly instead of resolving `undefined`.
 */
export function byPath(routes: Record<string, unknown>) {
  return async (path: string) => {
    if (path in routes) return routes[path]
    throw new Error(`Unmocked API path: ${path}`)
  }
}
