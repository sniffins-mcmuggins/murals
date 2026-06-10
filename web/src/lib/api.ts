import { createApiClient } from '@render/api-client'

// Server uses API_URL (internal Docker hostname), browser uses NEXT_PUBLIC_API_URL.
// Both fall back to localhost:8080 for non-Docker local dev.
// apiBaseUrl is correct for the current runtime (server or browser);
// publicApiBaseUrl is ALWAYS the browser-reachable URL (for hrefs, QR codes, etc.).
export const publicApiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'

export const apiBaseUrl =
  typeof window === 'undefined'
    ? (process.env.API_URL ?? publicApiBaseUrl)
    : publicApiBaseUrl

export const apiClient = createApiClient({ baseUrl: apiBaseUrl })
