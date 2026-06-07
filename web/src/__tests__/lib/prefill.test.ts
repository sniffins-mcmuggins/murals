import { describe, it, expect } from 'vitest'
import { resolvePrefill, isPrefillKey, PREFILL_KEYS } from '@/lib/prefill'
import type { components } from '@render/api-client'

type ArtistProfile = components['schemas']['ArtistProfile']

const profile = {
  id: 'profile-1',
  display_name: 'Lady Gabe',
  bio: 'I paint big walls.',
  location_label: 'Cheltenham',
  visibility: 'public',
  medium_tags: ['mural'],
  social_links: { instagram: 'https://instagram.com/ladygabe', website: 'https://ladygabe.com' },
  support_url: 'https://ko-fi.com/ladygabe',
  headline_image_urls: [],
  created_at: '',
  updated_at: '',
} as unknown as ArtistProfile

describe('prefill', () => {
  it('recognises only allowlisted keys', () => {
    expect(isPrefillKey('social.instagram')).toBe(true)
    expect(isPrefillKey('portfolio_collection')).toBe(true)
    expect(isPrefillKey('social.myspace')).toBe(false)
    expect(isPrefillKey('')).toBe(false)
  })

  it('resolves scalar profile fields', () => {
    expect(resolvePrefill('display_name', profile)).toBe('Lady Gabe')
    expect(resolvePrefill('bio', profile)).toBe('I paint big walls.')
    expect(resolvePrefill('location', profile)).toBe('Cheltenham')
    expect(resolvePrefill('support_url', profile)).toBe('https://ko-fi.com/ladygabe')
  })

  it('resolves social links', () => {
    expect(resolvePrefill('social.instagram', profile)).toBe('https://instagram.com/ladygabe')
    expect(resolvePrefill('website', profile)).toBe('https://ladygabe.com')
    expect(resolvePrefill('social.tiktok', profile)).toBe('') // absent → empty
  })

  it('builds an absolute portfolio_url from the base', () => {
    expect(resolvePrefill('portfolio_url', profile, { profileBaseUrl: 'https://app.test/' })).toBe(
      'https://app.test/artists/profile-1',
    )
  })

  it('returns empty for portfolio_collection (handled by the picker)', () => {
    expect(resolvePrefill('portfolio_collection', profile)).toBe('')
  })

  it('every allowlist key resolves without throwing', () => {
    for (const key of PREFILL_KEYS) {
      expect(() => resolvePrefill(key, profile, { profileBaseUrl: 'https://x' })).not.toThrow()
    }
  })
})
