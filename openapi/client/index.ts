import type { components } from '../generated/client'
import createClient, { type Middleware } from 'openapi-fetch'
import type { paths } from '../generated/client'

export type { components, operations, paths } from '../generated/client'

export class ApiError extends Error {
  readonly status: number
  readonly title: string
  readonly detail?: string
  readonly instance?: string
  readonly type?: string

  constructor(problem: components['schemas']['Problem']) {
    super(problem.title)
    this.name = 'ApiError'
    this.status = problem.status
    this.title = problem.title
    if (problem.detail !== undefined) this.detail = problem.detail
    if (problem.instance !== undefined) this.instance = problem.instance
    if (problem.type !== undefined) this.type = problem.type
  }
}

interface ApiClientOptions {
  baseUrl: string
  getToken?: () => string | null | undefined | Promise<string | null | undefined>
}

export function createApiClient({ baseUrl, getToken }: ApiClientOptions) {
  const client = createClient<paths>({ baseUrl, credentials: 'include' })

  if (getToken) {
    const middleware: Middleware = {
      async onRequest({ request }) {
        const token = await getToken()
        if (token) {
          request.headers.set('Authorization', `Bearer ${token}`)
        }
        return request
      },
    }
    client.use(middleware)
  }

  return client
}
