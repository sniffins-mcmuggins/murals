import type { components } from '../generated/client'
import createClient from 'openapi-fetch'
import type { paths } from '../generated/client'

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
    this.detail = problem.detail
    this.instance = problem.instance
    this.type = problem.type
  }
}

interface ApiClientOptions {
  baseUrl: string
  getToken?: () => string | null | undefined | Promise<string | null | undefined>
}

export function createApiClient({ baseUrl, getToken }: ApiClientOptions) {
  const client = createClient<paths>({ baseUrl })
  return client
}
