import { describe, it, expect } from 'vitest'
import { muralStatusColour, MURAL_STATUS_COLOURS } from '@/lib/murals'

describe('muralStatusColour', () => {
  it('maps each known status to its design-token hex', () => {
    expect(muralStatusColour('permanent')).toBe('#E8A838') // --color-amber
    expect(muralStatusColour('temporary')).toBe('#8A8896') // --color-mid
    expect(muralStatusColour('unknown')).toBe('#E2DDD6') // --color-light
  })

  it('falls back to the unknown colour for missing/unrecognised statuses', () => {
    expect(muralStatusColour(undefined)).toBe(MURAL_STATUS_COLOURS.unknown)
    expect(muralStatusColour(null)).toBe(MURAL_STATUS_COLOURS.unknown)
    expect(muralStatusColour('graffiti')).toBe(MURAL_STATUS_COLOURS.unknown)
  })
})
