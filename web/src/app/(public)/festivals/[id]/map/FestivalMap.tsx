'use client'

import { useEffect, useState } from 'react'
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import Link from 'next/link'
// Installs Leaflet's default marker icon (bundler-agnostic) as a side effect.
import '@/lib/leaflet'

export type MapPin = {
  artist_id: string
  name: string
  lat: number
  lng: number
  w3w?: string | null | undefined
}

type SelectedPin = MapPin | null

function MapClickHandler({ onDeselect }: { onDeselect: () => void }) {
  useMapEvents({
    click() {
      onDeselect()
    },
  })
  return null
}

function NavLinks({ pin }: { pin: MapPin }) {
  const googleUrl = `https://www.google.com/maps/search/?api=1&query=${pin.lat},${pin.lng}`
  const appleUrl = `https://maps.apple.com/?ll=${pin.lat},${pin.lng}`
  const w3wPattern = /^[a-z]+\.[a-z]+\.[a-z]+$/
  const w3wUrl = pin.w3w && w3wPattern.test(pin.w3w) ? `https://w3w.co/${pin.w3w}` : null

  return (
    <div className="flex flex-col gap-2 mt-3">
      <p className="font-mono text-xs text-mid uppercase tracking-widest mb-1">Navigate</p>
      <a
        href={googleUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="font-sans text-sm text-ink hover:text-amber transition-colors flex items-center gap-1"
      >
        Google Maps
      </a>
      <a
        href={appleUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="font-sans text-sm text-ink hover:text-amber transition-colors"
      >
        Apple Maps
      </a>
      {w3wUrl && (
        <a
          href={w3wUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="font-sans text-sm text-ink hover:text-amber transition-colors"
        >
          What3Words: ///{pin.w3w}
        </a>
      )}
    </div>
  )
}

type Props = {
  pins: MapPin[]
  festivalName: string
}

export default function FestivalMap({ pins, festivalName }: Props) {
  const [selected, setSelected] = useState<SelectedPin>(null)

  // Calculate map center from pins, or default to UK centre
  const center: [number, number] =
    pins.length > 0
      ? [
          pins.reduce((sum, p) => sum + p.lat, 0) / pins.length,
          pins.reduce((sum, p) => sum + p.lng, 0) / pins.length,
        ]
      : [52.4, -1.5]

  const zoom = pins.length > 0 ? 15 : 6

  // Close panel on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(null)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <div className="relative w-full h-full">
      {/* Map */}
      <MapContainer
        center={center}
        zoom={zoom}
        className="w-full h-full"
        style={{ background: '#E2DDD6' }}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        />
        <MapClickHandler onDeselect={() => setSelected(null)} />
        {pins.map((pin) => (
          <Marker
            key={pin.artist_id}
            position={[pin.lat, pin.lng]}
            eventHandlers={{
              click(e) {
                e.originalEvent.stopPropagation()
                setSelected(pin)
              },
            }}
          />
        ))}
      </MapContainer>

      {/* Empty state overlay */}
      {pins.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[400]">
          <div className="bg-offwhite/90 border border-light rounded-lg px-6 py-4 shadow-sm">
            <p className="font-sans text-mid text-sm">No artists placed yet</p>
          </div>
        </div>
      )}

      {/* Side panel / bottom sheet */}
      {selected && (
        <>
          {/* Backdrop for mobile */}
          <div
            className="fixed inset-0 z-[450] md:hidden bg-ink/20"
            onClick={() => setSelected(null)}
          />

          <div
            data-testid="map-pin-panel"
            className={[
              'absolute z-[500] bg-offwhite shadow-lg border border-light',
              // Desktop: right sidebar
              'md:top-4 md:right-4 md:bottom-4 md:w-72 md:rounded-lg md:overflow-y-auto',
              // Mobile: bottom sheet
              'bottom-0 left-0 right-0 rounded-t-xl px-6 py-5',
              'md:px-6 md:py-5',
            ].join(' ')}
          >
            {/* Close button */}
            <button
              onClick={() => setSelected(null)}
              className="absolute top-4 right-4 font-mono text-mid hover:text-ink transition-colors text-lg leading-none"
              aria-label="Close panel"
            >
              ×
            </button>

            {/* Artist name */}
            <Link
              href={`/artists/${selected.artist_id}`}
              className="block font-serif text-2xl text-ink hover:text-amber transition-colors leading-tight pr-8"
            >
              {selected.name}
            </Link>

            {/* Navigation links */}
            <NavLinks pin={selected} />
          </div>
        </>
      )}

      {/* Festival name watermark (top-left) */}
      <div className="absolute top-4 left-4 z-[400] pointer-events-none">
        <span className="font-mono text-xs text-ink uppercase tracking-widest bg-offwhite/80 px-3 py-1 rounded border border-light">
          {festivalName}
        </span>
      </div>
    </div>
  )
}
