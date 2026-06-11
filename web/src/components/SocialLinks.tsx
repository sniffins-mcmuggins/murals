'use client'

import { SocialIcon } from '@/components/SocialIcon'
import { apiClient } from '@/lib/api'

interface SocialLinksProps {
  profileId: string
  socialLinks: Record<string, string>
}

function recordLinkClick(profileId: string) {
  // keepalive lets the beacon survive navigation; openapi-fetch forwards
  // arbitrary fetch init (here keepalive) through to the underlying request.
  apiClient
    .POST('/profiles/{profileID}/link-click', {
      params: { path: { profileID: profileId } },
      keepalive: true,
    })
    .catch(() => {})
}

export function SocialLinks({ profileId, socialLinks }: SocialLinksProps) {
  if (Object.keys(socialLinks).length === 0) return null
  return (
    <nav aria-label="Social links" className="flex flex-wrap gap-4">
      {Object.entries(socialLinks).map(([platform, url]) => (
        <a
          key={platform}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={platform}
          className="text-mid hover:text-amber transition-colors"
          onClick={() => recordLinkClick(profileId)}
        >
          <SocialIcon platform={platform} className="w-6 h-6" />
        </a>
      ))}
    </nav>
  )
}
