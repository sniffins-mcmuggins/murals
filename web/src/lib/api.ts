import { createApiClient } from '@render/api-client'

// Server uses API_URL (internal Docker hostname), browser uses NEXT_PUBLIC_API_URL.
// Both fall back to localhost:8080 for non-Docker local dev.
const baseUrl =
  typeof window === 'undefined'
    ? (process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080')
    : (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080')

export const apiClient = createApiClient({ baseUrl })
