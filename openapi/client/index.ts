import type { components } from '../generated/client'

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
