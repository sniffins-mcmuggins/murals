import { describe, it, expect } from 'vitest'
import { formatDate, formatDateRange } from '@/lib/dates'

describe('formatDate', () => {
  it('formats an ISO timestamp as en-GB day month year', () => {
    expect(formatDate('2026-03-15T10:00:00Z')).toBe('15 Mar 2026')
  })
})

describe('formatDateRange', () => {
  it('returns TBC when both dates are missing', () => {
    expect(formatDateRange(null, null)).toBe('TBC')
    expect(formatDateRange(undefined, undefined)).toBe('TBC')
  })

  it('same-year range uses short start date', () => {
    expect(formatDateRange('2027-10-01', '2027-10-03')).toBe('1 Oct – 3 Oct 2027')
  })

  it('cross-year range uses full dates on both sides', () => {
    expect(formatDateRange('2026-12-30', '2027-01-02')).toBe('30 Dec 2026 – 2 Jan 2027')
  })

  it('start-only and end-only fall back to a single full date', () => {
    expect(formatDateRange('2027-10-01', null)).toBe('1 Oct 2027')
    expect(formatDateRange(null, '2027-10-03')).toBe('3 Oct 2027')
  })

  it('parses date-only strings without timezone shifting (regression)', () => {
    // new Date('2027-10-01') is UTC midnight; naive use can render 30 Sep in BST.
    expect(formatDateRange('2027-10-01', '2027-10-01')).toContain('1 Oct')
  })
})
