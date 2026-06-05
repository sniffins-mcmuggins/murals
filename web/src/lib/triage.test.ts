import { describe, it, expect } from 'vitest'
import { initialTriageIndex, clampIndex } from '@/lib/triage'

describe('triage helpers', () => {
  it('initialTriageIndex returns the first not-yet-shortlisted index', () => {
    expect(initialTriageIndex([{ shortlisted: true }, { shortlisted: false }, { shortlisted: false }])).toBe(1)
  })
  it('initialTriageIndex returns 0 when all are shortlisted', () => {
    expect(initialTriageIndex([{ shortlisted: true }, { shortlisted: true }])).toBe(0)
  })
  it('initialTriageIndex returns 0 for an empty list', () => {
    expect(initialTriageIndex([])).toBe(0)
  })
  it('clampIndex keeps the index within [0, len-1]', () => {
    expect(clampIndex(-1, 3)).toBe(0)
    expect(clampIndex(3, 3)).toBe(2)
    expect(clampIndex(1, 3)).toBe(1)
    expect(clampIndex(0, 0)).toBe(0)
  })
})
