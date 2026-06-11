import L from 'leaflet'
// Installs Leaflet's default marker icon (bundler-agnostic) as a side effect —
// the single source of truth for the marker-icon import fix.
import '@/lib/leaflet'

// Marker colours are inlined into the divIcon HTML strings below because CSS
// classes can't reach into a Leaflet `L.divIcon` string. They mirror the design
// tokens in globals.css — keep them in sync (amber = --color-amber, terracotta
// = --color-clay). See lib/murals.ts for the status→colour mapping used by the
// history overlay circle markers.

export const AmberIcon = L.divIcon({
  className: '',
  html: '<div style="width:18px;height:18px;background:#E8A838;border-radius:50%;border:2.5px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3)"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
})

export const TerracottaIcon = L.divIcon({
  className: '',
  html: '<div style="width:18px;height:18px;background:#C45C3A;border-radius:50%;border:2.5px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3)"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
})

// Provisional pin dropped at a searched address — visually distinct (dashed
// ring) until the organiser confirms it into a real spot.
export const DraftIcon = L.divIcon({
  className: '',
  html: '<div style="width:20px;height:20px;background:rgba(196,92,58,.25);border:2.5px dashed #C45C3A;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,.25)"></div>',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
})
