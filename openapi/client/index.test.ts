import { describe, expect, it } from 'vitest'
import { ApiError } from './index'

describe('ApiError', () => {
  it('is an instance of Error with status and title', () => {
    const err = new ApiError({ status: 404, title: 'Not Found' })

    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('ApiError')
    expect(err.message).toBe('Not Found')
    expect(err.status).toBe(404)
    expect(err.title).toBe('Not Found')
  })

  it('carries optional detail and instance fields', () => {
    const err = new ApiError({
      status: 422,
      title: 'Unprocessable Entity',
      detail: 'email is required',
      instance: '/auth/signup',
      type: 'about:blank',
    })

    expect(err.detail).toBe('email is required')
    expect(err.instance).toBe('/auth/signup')
    expect(err.type).toBe('about:blank')
  })
})
