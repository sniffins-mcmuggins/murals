import { createApiClient } from '@render/api-client'

// Unauthenticated client for public endpoints.
// For auth-gated requests, #51 adds a separate client that injects the session cookie.
// Do not add getToken here — it would break SSR (module-level singleton is shared across requests).
export const apiClient = createApiClient({
  baseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080',
})
