import { describe, expect, it } from 'vitest'
import { apiClient } from '../lib/api'

describe('apiClient', () => {
  it('exposes HTTP method helpers', () => {
    expect(typeof apiClient.GET).toBe('function')
    expect(typeof apiClient.POST).toBe('function')
    expect(typeof apiClient.PUT).toBe('function')
    expect(typeof apiClient.PATCH).toBe('function')
    expect(typeof apiClient.DELETE).toBe('function')
  })
})
