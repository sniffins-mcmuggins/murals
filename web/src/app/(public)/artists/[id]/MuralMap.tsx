'use client'

import { useEffect } from 'react'
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'

export interface SpotEntry {
  spot_id: string
  festival_id: string
  festival_name: string
  festival_year?: number | null
  lat: number
  lng: number
  mural_status: 'permanent' | 'temporary' | 'unknown'
}

function FitBounds({ spots }: { spots: SpotEntry[] }) {
  const map = useMap()
  useEffect(() => {
    if (spots.length === 0) return
    const lats = spots.map(s => s.lat)
    const lngs = spots.map(s => s.lng)
    map.fitBounds(
      [[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]],
      { padding: [40, 40], maxZoom: 15 },
    )
  }, [spots, map])
  return null
}

export default function MuralMap({ spots }: { spots: SpotEntry[] }) {
  if (spots.length === 0) return null

  const center: [number, number] = [spots[0].lat, spots[0].lng]
  const statusColor = (s: string) =>
    s === 'permanent' ? '#E8A838' : s === 'temporary' ? '#8A8896' : '#C0BDB8'

  return (
    <MapContainer center={center} zoom={13} style={{ height: 280 }} scrollWheelZoom={false}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitBounds spots={spots} />
      {spots.map(s => (
        <CircleMarker
          key={s.spot_id}
          center={[s.lat, s.lng]}
          radius={9}
          pathOptions={{ color: statusColor(s.mural_status), fillColor: statusColor(s.mural_status), fillOpacity: 0.75, weight: 1.5 }}
        >
          <Popup>
            <span className="font-sans text-xs">
              {s.festival_name}{s.festival_year ? ` ${s.festival_year}` : ''}<br />
              <span className="capitalize text-mid">{s.mural_status}</span>
            </span>
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  )
}
