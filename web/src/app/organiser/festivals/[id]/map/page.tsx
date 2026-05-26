'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import icon from 'leaflet/dist/images/marker-icon.png'
import iconShadow from 'leaflet/dist/images/marker-shadow.png'
import Link from 'next/link'
import { apiClient } from '@/lib/api'
import type { components } from '@render/api-client'

// Fix default marker icon broken by webpack
const DefaultIcon = L.icon({
  iconUrl: (icon as { src: string }).src,
  shadowUrl: (iconShadow as { src: string }).src,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
})
L.Marker.prototype.options.icon = DefaultIcon

type AcceptedArtist = components['schemas']['AcceptedArtist']

// ─── Map click handler ────────────────────────────────────────────────────────

type ClickCoords = { lat: number; lng: number }

function MapClickCapture({ onMapClick }: { onMapClick: (coords: ClickCoords) => void }) {
  useMapEvents({
    click(e) {
      onMapClick({ lat: e.latlng.lat, lng: e.latlng.lng })
    },
  })
  return null
}

// ─── Place-pin panel ──────────────────────────────────────────────────────────

type PlacePinPanelProps = {
  coords: ClickCoords
  artists: AcceptedArtist[]
  isPending: boolean
  error: string | null
  onSave: (artistId: string, w3w: string) => void
  onCancel: () => void
}

const W3W_RE = /^[a-z]+\.[a-z]+\.[a-z]+$/

function PlacePinPanel({ coords, artists, isPending, error, onSave, onCancel }: PlacePinPanelProps) {
  const [selectedArtistId, setSelectedArtistId] = useState('')
  const [w3w, setW3w] = useState('')
  const w3wTrimmed = w3w.trim()
  const w3wInvalid = w3wTrimmed.length > 0 && !W3W_RE.test(w3wTrimmed)

  return (
    <div className="mt-4 p-5 bg-warm border border-light rounded-lg">
      <h2 className="font-serif text-xl text-ink mb-1">Place pin</h2>
      <p className="font-mono text-xs text-mid uppercase tracking-widest mb-4">
        {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
      </p>

      <div className="space-y-3 max-w-sm">
        <div>
          <label htmlFor="artist-select" className="font-sans text-xs text-mid block mb-1">
            Artist
          </label>
          <select
            id="artist-select"
            value={selectedArtistId}
            onChange={e => setSelectedArtistId(e.target.value)}
            className="w-full border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite focus:outline-none focus:border-amber"
          >
            <option value="">— Select artist —</option>
            {artists.map(a => (
              <option key={a.artist_id} value={a.artist_id ?? ''}>
                {a.name ?? a.artist_id ?? 'Unknown artist'}
                {a.pin_lat != null ? ' (pin set)' : ''}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="w3w-input" className="font-sans text-xs text-mid block mb-1">
            What3Words (optional)
          </label>
          <input
            id="w3w-input"
            type="text"
            placeholder="e.g. filled.count.soap"
            value={w3w}
            onChange={e => setW3w(e.target.value)}
            className="w-full border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite focus:outline-none focus:border-amber"
          />
        </div>

        {w3wInvalid && (
          <p className="font-sans text-xs text-clay">
            W3W must be three words separated by dots (e.g. filled.count.soap)
          </p>
        )}

        {error && (
          <p role="alert" className="font-sans text-sm text-clay">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <button
            onClick={() => onSave(selectedArtistId, w3w)}
            disabled={!selectedArtistId || isPending || w3wInvalid}
            className="font-sans text-sm bg-amber text-ink font-medium px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50"
          >
            {isPending ? 'Saving…' : 'Save pin'}
          </button>
          <button
            onClick={onCancel}
            disabled={isPending}
            className="font-sans text-sm text-mid hover:text-ink px-4 py-2 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Map editor inner component ───────────────────────────────────────────────

function OrgFestivalMapEditor({
  festivalId,
  queryClient,
}: {
  festivalId: string
  queryClient: ReturnType<typeof useQueryClient>
}) {
  const [pendingCoords, setPendingCoords] = useState<ClickCoords | null>(null)
  const [pinError, setPinError] = useState<string | null>(null)

  const artistsQuery = useQuery({
    queryKey: ['accepted-artists', festivalId],
    queryFn: async () => {
      const res = await apiClient.GET('/festivals/{festivalID}/artists/accepted', {
        params: { path: { festivalID: festivalId } },
      })
      if (res.error) throw new Error('Failed to load accepted artists')
      return (res.data ?? []) as AcceptedArtist[]
    },
  })

  const pinMutation = useMutation({
    mutationFn: async ({
      artistId,
      lat,
      lng,
      w3w,
    }: {
      artistId: string
      lat: number
      lng: number
      w3w?: string | null
    }) => {
      const res = await apiClient.PATCH('/festivals/{festivalID}/artists/{artistID}/pin', {
        params: { path: { festivalID: festivalId, artistID: artistId } },
        body: { lat, lng, ...(w3w ? { w3w } : { w3w: null }) },
      })
      if (res.error) throw new Error('Failed to save pin')
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accepted-artists', festivalId] })
      setPendingCoords(null)
      setPinError(null)
    },
    onError: (err: Error) => setPinError(err.message),
  })

  const artists = artistsQuery.data ?? []
  const pinnedArtists = artists.filter(a => a.pin_lat != null && a.pin_lng != null)

  // Default to UK centre if no pins exist yet
  const center: [number, number] =
    pinnedArtists.length > 0
      ? [
          pinnedArtists.reduce((sum, a) => sum + (a.pin_lat ?? 0), 0) / pinnedArtists.length,
          pinnedArtists.reduce((sum, a) => sum + (a.pin_lng ?? 0), 0) / pinnedArtists.length,
        ]
      : [52.4, -1.5]

  const zoom = pinnedArtists.length > 0 ? 15 : 6

  return (
    <div>
      {/* Back link */}
      <div className="mb-6">
        <Link
          href={`/organiser/festivals/${festivalId}`}
          className="font-mono text-xs text-mid uppercase tracking-widest hover:text-ink transition-colors"
        >
          ← Festival
        </Link>
      </div>

      <h1 className="font-serif text-4xl text-ink mb-2">Map editor</h1>
      <p className="font-sans text-sm text-mid mb-6">
        Click anywhere on the map to place a pin for an accepted artist.
      </p>

      {/* Error loading artists */}
      {artistsQuery.isError && (
        <p role="alert" className="font-sans text-sm text-clay mb-4">
          Failed to load accepted artists.
        </p>
      )}

      {/* Loading */}
      {artistsQuery.isLoading && (
        <p className="font-sans text-mid text-sm mb-4">Loading…</p>
      )}

      {/* Map */}
      {!artistsQuery.isLoading && (
        <div className="w-full border border-light rounded-lg overflow-hidden" style={{ height: '500px' }}>
          <MapContainer
            center={center}
            zoom={zoom}
            className="w-full h-full bg-light"
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            />
            <MapClickCapture onMapClick={coords => { setPendingCoords(coords); setPinError(null) }} />

            {/* Existing pins */}
            {pinnedArtists.map(a => (
              <Marker
                key={a.artist_id}
                position={[a.pin_lat as number, a.pin_lng as number]}
              >
                <Popup>
                  <span className="font-sans text-sm text-ink">
                    {a.name ?? a.artist_id ?? 'Unknown artist'}
                  </span>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>
      )}

      {/* Accepted artists list summary */}
      {!artistsQuery.isLoading && !artistsQuery.isError && artists.length > 0 && (
        <div className="mt-4">
          <p className="font-mono text-xs text-mid uppercase tracking-widest mb-2">
            Accepted artists ({artists.length})
          </p>
          <ul className="space-y-1">
            {artists.map(a => (
              <li key={a.artist_id} className="flex items-center gap-3">
                <span className="font-sans text-sm text-ink">
                  {a.name ?? a.artist_id ?? 'Unknown artist'}
                </span>
                {a.pin_lat != null && a.pin_lng != null ? (
                  <span className="font-mono text-xs text-mid">
                    {a.pin_lat.toFixed(4)}, {a.pin_lng.toFixed(4)}
                    {a.w3w ? ` · ///${a.w3w}` : ''}
                  </span>
                ) : (
                  <span className="font-mono text-xs text-mid">no pin</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!artistsQuery.isLoading && !artistsQuery.isError && artists.length === 0 && (
        <p className="font-sans text-mid text-sm mt-4">No accepted artists yet.</p>
      )}

      {/* Place-pin panel */}
      {pendingCoords && (
        <PlacePinPanel
          coords={pendingCoords}
          artists={artists}
          isPending={pinMutation.isPending}
          error={pinError}
          onSave={(artistId, w3w) => {
            pinMutation.mutate({
              artistId,
              lat: pendingCoords.lat,
              lng: pendingCoords.lng,
              w3w: w3w.trim() || null,
            })
          }}
          onCancel={() => { setPendingCoords(null); setPinError(null) }}
        />
      )}
    </div>
  )
}

// ─── Page shell (resolves async params) ──────────────────────────────────────

type Props = { params: Promise<{ id: string }> }

export default function OrgFestivalMapPage({ params }: Props) {
  const [festivalId, setFestivalId] = useState<string | null>(null)
  const queryClient = useQueryClient()

  if (!festivalId) {
    params.then(p => setFestivalId(p.id))
    return <div className="font-sans text-mid text-sm p-8">Loading…</div>
  }

  return <OrgFestivalMapEditor festivalId={festivalId} queryClient={queryClient} />
}
