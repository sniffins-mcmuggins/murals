/** Format an ISO timestamp (e.g. created_at) as "15 Mar 2026" (en-GB). */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/** Parse a date-only "YYYY-MM-DD" string as a LOCAL date (avoids UTC-midnight shift). */
function parseDateOnly(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function formatDateOnly(dateStr: string): string {
  return parseDateOnly(dateStr).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function formatDateOnlyShort(dateStr: string): string {
  return parseDateOnly(dateStr).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  })
}

/**
 * Human date range for date-only strings ("YYYY-MM-DD").
 * Same-year ranges shorten the start ("1 Oct – 3 Oct 2027"); returns "TBC"
 * when both ends are missing.
 */
export function formatDateRange(
  startDate?: string | null,
  endDate?: string | null,
): string {
  if (!startDate && !endDate) return 'TBC'

  if (startDate && endDate) {
    const [sy] = startDate.split('-').map(Number)
    const [ey] = endDate.split('-').map(Number)
    if (sy === ey) {
      return `${formatDateOnlyShort(startDate)} – ${formatDateOnly(endDate)}`
    }
    return `${formatDateOnly(startDate)} – ${formatDateOnly(endDate)}`
  }

  if (startDate) return formatDateOnly(startDate)
  return formatDateOnly(endDate!)
}
