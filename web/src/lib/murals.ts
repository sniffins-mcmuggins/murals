/**
 * Mural-status → marker colour, shared by the public MuralMap and the
 * organiser map editor. Hexes mirror the design tokens in globals.css
 * (Leaflet divIcon/CircleMarker HTML can't use Tailwind classes).
 */
export const MURAL_STATUS_COLOURS: Record<string, string> = {
  permanent: '#E8A838', // --color-amber
  temporary: '#8A8896', // --color-mid
  unknown: '#E2DDD6', // --color-light
}

export function muralStatusColour(status: string | null | undefined): string {
  return MURAL_STATUS_COLOURS[status ?? 'unknown'] ?? MURAL_STATUS_COLOURS.unknown
}
