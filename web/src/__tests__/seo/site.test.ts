import { describe, it, expect } from 'vitest'
import { siteUrl, absoluteUrl } from '@/lib/site'

describe('site url helpers', () => {
  it('siteUrl returns a base url without a trailing slash', () => {
    const url = siteUrl()
    expect(url).toMatch(/^https?:\/\//)
    expect(url.endsWith('/')).toBe(false)
  })

  it('absoluteUrl joins a path onto the base url', () => {
    expect(absoluteUrl('/artists/abc')).toBe(`${siteUrl()}/artists/abc`)
  })

  it('absoluteUrl tolerates a path without a leading slash', () => {
    expect(absoluteUrl('artists/abc')).toBe(`${siteUrl()}/artists/abc`)
  })
})
