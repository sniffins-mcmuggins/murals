'use client'

import { linkIconForPrefill } from '@/lib/favicon'
import { Favicon } from './Favicon'
import { SocialIcon } from './SocialIcon'

type LinkField = { id?: string; label: string; prefill?: string }

/** Renders the social/web links an artist shared on an application as a row of
 *  clickable favicons (the favicon *is* the link, opening in a new tab). Driven by
 *  the form's link-bound fields (`prefill` = social.* / website) crossed with the
 *  non-empty answers — an un-shared link submits '' and is therefore skipped. */
export function SharedLinks({
  formFields,
  answers,
  className,
}: {
  formFields: LinkField[]
  answers: Record<string, string>
  className?: string
}) {
  const links = formFields
    .map((f) => {
      const key = f.id ?? f.label
      const url = (answers[key] ?? '').trim()
      const icon = linkIconForPrefill(f.prefill)
      return icon && url ? { key, label: f.label, url, icon } : null
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)

  if (links.length === 0) return null

  return (
    <div className={`flex items-center gap-2 flex-wrap ${className ?? ''}`} data-testid="shared-links">
      {links.map(({ key, label, url, icon }) => (
        <a
          key={key}
          href={url}
          target="_blank"
          rel="noreferrer"
          aria-label={label}
          className="group relative inline-flex text-mid hover:text-ink transition-colors flex-shrink-0"
        >
          {icon.kind === 'favicon'
            ? <Favicon platform={icon.platform} src={icon.src} label={label} className="w-5 h-5" />
            : <SocialIcon platform="website" className="w-5 h-5" />}
          {/* Hover tooltip showing the actual address — reassures before clicking through. */}
          <span
            role="tooltip"
            className="pointer-events-none absolute left-0 top-full mt-1 z-50 whitespace-nowrap rounded bg-ink px-2 py-1 font-mono text-[10px] text-offwhite shadow-lg opacity-0 transition-opacity duration-150 group-hover:opacity-100"
          >
            {url}
          </span>
        </a>
      ))}
    </div>
  )
}
