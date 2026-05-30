import { describe, it, expect } from 'vitest'
import robots from '@/app/robots'
import { siteUrl } from '@/lib/site'

describe('robots', () => {
  it('allows crawling and points to the sitemap', () => {
    const r = robots()
    const rules = Array.isArray(r.rules) ? r.rules[0] : r.rules
    expect(rules?.allow).toBe('/')
    expect(r.sitemap).toBe(`${siteUrl()}/sitemap.xml`)
  })
})
