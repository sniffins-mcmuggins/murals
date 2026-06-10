import { describe, it, expect } from 'vitest'
import { PLATFORM_DOMAINS, platformFaviconSrc, linkIconForPrefill } from '@/lib/favicon'
import { SOCIAL_PLATFORMS } from '@/components/SocialIcon'

describe('favicon', () => {
  it('maps every social platform except website to a domain', () => {
    const fetchable = SOCIAL_PLATFORMS.map(p => p.key).filter(k => k !== 'website')
    for (const key of fetchable) {
      expect(PLATFORM_DOMAINS[key as keyof typeof PLATFORM_DOMAINS]).toMatch(/\./)
    }
    expect('website' in PLATFORM_DOMAINS).toBe(false)
    expect(PLATFORM_DOMAINS.twitter).toBe('x.com')
  })

  it('builds a static favicon path per platform', () => {
    expect(platformFaviconSrc('instagram')).toBe('/favicons/instagram.png')
    expect(platformFaviconSrc('tiktok')).toBe('/favicons/tiktok.png')
  })

  it('resolves a prefill key to its link icon', () => {
    expect(linkIconForPrefill('social.instagram')).toEqual({
      kind: 'favicon', platform: 'instagram', src: '/favicons/instagram.png',
    })
    expect(linkIconForPrefill('website')).toEqual({ kind: 'globe' })
    expect(linkIconForPrefill('bio')).toBeNull()
    expect(linkIconForPrefill(undefined)).toBeNull()
    expect(linkIconForPrefill('social.myspace')).toBeNull()
  })
})
