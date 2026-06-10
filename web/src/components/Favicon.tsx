'use client'

import { useState } from 'react'
import { SocialIcon, type SocialPlatform } from './SocialIcon'

interface Props {
  platform: SocialPlatform
  src: string
  label: string
  className?: string
}

/** A self-hosted favicon image that falls back to the monochrome brand glyph if the
 *  asset fails to load — so a missing/renamed favicon never shows a broken image. */
export function Favicon({ platform, src, label, className = 'w-4 h-4' }: Props) {
  const [failed, setFailed] = useState(false)
  if (failed) return <SocialIcon platform={platform} className={`${className} text-mid`} />
  return (
    <img
      src={src}
      alt={label}
      width={16}
      height={16}
      className={`${className} object-contain`}
      onError={() => setFailed(true)}
    />
  )
}
