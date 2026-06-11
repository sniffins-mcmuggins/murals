import { useEffect } from 'react'
import { useMapEvents, useMap } from 'react-leaflet'
import type L from 'leaflet'

// Headless react-leaflet children: each subscribes to the map instance/events
// and renders nothing. Kept out of MapEditorClient so the editor reads as
// markup + handlers rather than a pile of map-lifecycle plumbing.

/** Hand the live Leaflet map instance back to the parent once it mounts. */
export function MapRefCapture({ onReady }: { onReady: (map: L.Map) => void }) {
  const map = useMap()
  useEffect(() => {
    onReady(map)
  }, [map, onReady])
  return null
}

/** Recentre the map at zoom 16 whenever `target` changes (geocode selection). */
export function MapViewUpdater({ target }: { target: [number, number] | null }) {
  const map = useMap()
  useEffect(() => {
    if (target) map.setView(target, 16)
  }, [target, map])
  return null
}

/** Forward map clicks to `onMapClick` only while `active` (spot-placing mode). */
export function MapClickCapture({
  active,
  onMapClick,
}: {
  active: boolean
  onMapClick: (lat: number, lng: number) => void
}) {
  useMapEvents({
    click(e) {
      if (active) onMapClick(e.latlng.lat, e.latlng.lng)
    },
  })
  return null
}
