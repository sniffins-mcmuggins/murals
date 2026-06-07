import type { components } from '@render/api-client'

type ArtistProfile = components['schemas']['ArtistProfile']

/**
 * Profile-bound form fields (E28 M2). A form field may carry an optional
 * `prefill` key naming a profile attribute; the apply form then pre-fills that
 * field from the artist's profile (editable). The answer is still a plain string
 * in `answers[field.id]` — `prefill` only sets the initial value.
 *
 * IMPORTANT: this allowlist is mirrored server-side in
 * `api/internal/festival/form.go` (allowedPrefillKeys). Keep them in sync.
 */
export const PREFILL_KEYS = [
  'display_name',
  'bio',
  'location',
  'website',
  'social.instagram',
  'social.twitter',
  'social.facebook',
  'social.youtube',
  'social.tiktok',
  'social.linkedin',
  'social.pinterest',
  'support_url',
  'portfolio_url',
  'portfolio_collection',
] as const

export type PrefillKey = (typeof PREFILL_KEYS)[number]

/** Builder-facing labels for each binding. */
export const PREFILL_OPTIONS: { key: PrefillKey; label: string }[] = [
  { key: 'display_name', label: 'Display name' },
  { key: 'bio', label: 'Bio' },
  { key: 'location', label: 'Location' },
  { key: 'website', label: 'Website' },
  { key: 'social.instagram', label: 'Instagram' },
  { key: 'social.twitter', label: 'X / Twitter' },
  { key: 'social.facebook', label: 'Facebook' },
  { key: 'social.youtube', label: 'YouTube' },
  { key: 'social.tiktok', label: 'TikTok' },
  { key: 'social.linkedin', label: 'LinkedIn' },
  { key: 'social.pinterest', label: 'Pinterest' },
  { key: 'support_url', label: 'Support link' },
  { key: 'portfolio_url', label: 'Portfolio (whole profile)' },
  { key: 'portfolio_collection', label: 'Portfolio (choose a collection)' },
]

/** Keys whose value M1 already surfaces to organisers automatically. */
export const AUTO_SHOWN_PREFILL_KEYS = new Set<PrefillKey>([
  'social.instagram',
  'social.twitter',
  'social.facebook',
  'social.youtube',
  'social.tiktok',
  'social.linkedin',
  'social.pinterest',
  'website',
  'support_url',
  'bio',
])

export function isPrefillKey(s: string): s is PrefillKey {
  return (PREFILL_KEYS as readonly string[]).includes(s)
}

/**
 * Resolve a prefill key to a default string value from the artist's profile.
 * `portfolio_collection` is handled by a dedicated picker (returns '' here).
 */
export function resolvePrefill(
  key: PrefillKey,
  profile: ArtistProfile,
  opts?: { profileBaseUrl?: string },
): string {
  const social = (profile.social_links ?? {}) as Record<string, string>
  switch (key) {
    case 'display_name':
      return profile.display_name ?? ''
    case 'bio':
      return profile.bio ?? ''
    case 'location':
      return profile.location_label ?? ''
    case 'website':
      return social.website ?? ''
    case 'support_url':
      return profile.support_url ?? ''
    case 'portfolio_url': {
      const base = (opts?.profileBaseUrl ?? '').replace(/\/$/, '')
      return profile.id ? `${base}/artists/${profile.id}` : ''
    }
    case 'portfolio_collection':
      return ''
    default: {
      // social.<platform>
      const platform = key.startsWith('social.') ? key.slice('social.'.length) : ''
      return platform ? (social[platform] ?? '') : ''
    }
  }
}
