import type { SocialPlatform } from '@/components/SocialIcon'

/** The seven fetchable social platforms → their canonical domains. Single source of
 *  truth, shared by the favicon refresh script (web/scripts/fetch-favicons.sh) and the
 *  helper below. `website` is deliberately excluded — it renders as a globe, never fetched. */
export const PLATFORM_DOMAINS: Record<Exclude<SocialPlatform, 'website'>, string> = {
  instagram: 'instagram.com',
  twitter: 'x.com',
  facebook: 'facebook.com',
  youtube: 'youtube.com',
  tiktok: 'tiktok.com',
  linkedin: 'linkedin.com',
  pinterest: 'pinterest.com',
}

export type FetchablePlatform = keyof typeof PLATFORM_DOMAINS

/** Static path to a self-hosted favicon asset (no network at render time). */
export function platformFaviconSrc(platform: FetchablePlatform): string {
  return `/favicons/${platform}.png`
}

export type LinkIcon =
  | { kind: 'favicon'; platform: FetchablePlatform; src: string }
  | { kind: 'globe' }
  | null

/** Map a form field's `prefill` key to its link icon, or null if it is not a link field. */
export function linkIconForPrefill(prefill?: string): LinkIcon {
  if (!prefill) return null
  if (prefill === 'website') return { kind: 'globe' }
  if (prefill.startsWith('social.')) {
    const platform = prefill.slice('social.'.length)
    if (platform in PLATFORM_DOMAINS) {
      const p = platform as FetchablePlatform
      return { kind: 'favicon', platform: p, src: platformFaviconSrc(p) }
    }
  }
  return null
}
