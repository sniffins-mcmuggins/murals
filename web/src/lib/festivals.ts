import type { components } from '@render/api-client'

type FestivalStatus = components['schemas']['FestivalStatus']

/** Display labels for festival.status. */
export const FESTIVAL_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  open: 'Open',
  live: 'Live',
  archived: 'Archived',
}

/** Badge classes for public festival pages. */
export const FESTIVAL_STATUS_BADGES: Record<string, string> = {
  draft: 'bg-warm text-mid border-light',
  open: 'bg-amber/20 text-amber border-amber/30',
  live: 'bg-clay/20 text-clay border-clay/30',
  archived: 'bg-warm text-mid border-light',
}

/** Text-accent classes for the organiser festivals list. */
export const FESTIVAL_STATUS_TEXT: Record<FestivalStatus, string> = {
  draft: 'text-mid',
  open: 'text-amber',
  live: 'text-clay',
  archived: 'text-mid',
}
