/** Display labels for collection.status. Single source — used by all public pages. */
export const COLLECTION_STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  archived: 'Archived',
  ongoing: 'Ongoing',
}

/** Badge classes for collection.status (design tokens only). */
export const COLLECTION_STATUS_BADGES: Record<string, string> = {
  active: 'bg-amber text-ink',
  archived: 'bg-warm text-mid border border-light',
  ongoing: 'bg-clay text-offwhite',
}

/** Fallback badge class for unknown statuses. */
export const COLLECTION_STATUS_BADGE_FALLBACK = 'bg-warm text-mid'
