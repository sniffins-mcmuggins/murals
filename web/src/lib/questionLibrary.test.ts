import { describe, it, expect } from 'vitest'
import { QUESTION_LIBRARY, STARTER_TEMPLATE } from '@/lib/questionLibrary'

describe('questionLibrary', () => {
  it('every preset has a group, type, and label', () => {
    for (const p of QUESTION_LIBRARY) {
      expect(p.group).toBeTruthy()
      expect(['text', 'textarea', 'select', 'embed']).toContain(p.type)
      expect(p.label).toBeTruthy()
      if (p.type === 'select') expect((p.options ?? []).length).toBeGreaterThan(0)
    }
  })

  it('starter template is non-empty and select fields have options', () => {
    expect(STARTER_TEMPLATE.length).toBeGreaterThan(0)
    for (const f of STARTER_TEMPLATE) {
      if (f.type === 'select') expect((f.options ?? []).length).toBeGreaterThan(0)
    }
  })
})
