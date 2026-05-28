'use client'

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import icon from 'leaflet/dist/images/marker-icon.png'
import iconShadow from 'leaflet/dist/images/marker-shadow.png'
import Link from 'next/link'
import { apiClient } from '@/lib/api'
import type { components } from '@render/api-client'

type FestivalSpot = components['schemas']['FestivalSpot']
type FestivalSpotsResponse = components['schemas']['FestivalSpotsResponse']
type UnassignedArtist = components['schemas']['UnassignedArtist']

// Fix default Leaflet icon broken by webpack
const DefaultIcon = L.icon({
  iconUrl: (icon as { src: string }).src,
  shadowUrl: (iconShadow as { src: string }).src,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
})
L.Marker.prototype.options.icon = DefaultIcon

const AmberIcon = L.divIcon({
  className: '',
  html: '<div style="width:18px;height:18px;background:#E8A838;border-radius:50%;border:2.5px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3)"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
})

const TerracottaIcon = L.divIcon({
  className: '',
  html: '<div style="width:18px;height:18px;background:#C45C3A;border-radius:50%;border:2.5px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3)"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
})

// ─── Map click capture ────────────────────────────────────────────────────────

function MapClickCapture({ active, onMapClick }: { active: boolean; onMapClick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      if (active) onMapClick(e.latlng.lat, e.latlng.lng)
    },
  })
  return null
}

// ─── Spot panel ───────────────────────────────────────────────────────────────

type SpotPanelProps = {
  spot: FestivalSpot
  unassignedArtists: UnassignedArtist[]
  festivalId: string
  onClose: () => void
  onMutated: () => void
}

function SpotPanel({ spot, unassignedArtists, festivalId, onClose, onMutated }: SpotPanelProps) {
  const [lat, setLat] = useState(String(spot.lat ?? ''))
  const [lng, setLng] = useState(String(spot.lng ?? ''))
  const [w3w, setW3w] = useState(spot.w3w ?? '')
  const [widthM, setWidthM] = useState(spot.width_m != null ? String(spot.width_m) : '')
  const [heightM, setHeightM] = useState(spot.height_m != null ? String(spot.height_m) : '')
  const [notes, setNotes] = useState(spot.notes ?? '')
  const [artistId, setArtistId] = useState(spot.artist_id ?? '')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Rebuild local state when the spot prop changes (e.g. after another save)
  useEffect(() => {
    setLat(String(spot.lat ?? ''))
    setLng(String(spot.lng ?? ''))
    setW3w(spot.w3w ?? '')
    setWidthM(spot.width_m != null ? String(spot.width_m) : '')
    setHeightM(spot.height_m != null ? String(spot.height_m) : '')
    setNotes(spot.notes ?? '')
    setArtistId(spot.artist_id ?? '')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spot])

  const artistOptions: UnassignedArtist[] = spot.artist_id
    ? [{ artist_id: spot.artist_id, name: spot.artist_name ?? spot.artist_id }, ...unassignedArtists]
    : unassignedArtists

  async function handleSave() {
    setSaving(true)
    setSaveError(null)
    try {
      const latNum = parseFloat(lat)
      const lngNum = parseFloat(lng)
      if (isNaN(latNum) || isNaN(lngNum)) {
        setSaveError('Lat/lng must be valid numbers')
        return
      }

      // Update spot details
      const patchRes = await apiClient.PATCH('/festivals/{festivalID}/spots/{spotID}', {
        params: { path: { festivalID: festivalId, spotID: spot.id! } },
        body: {
          lat: latNum,
          lng: lngNum,
          w3w: w3w.trim() || null,
          width_m: widthM ? parseFloat(widthM) : null,
          height_m: heightM ? parseFloat(heightM) : null,
          notes: notes.trim() || null,
        },
      })
      if (patchRes.error) throw new Error('Failed to update spot')

      // Handle artist assignment change
      if (artistId && artistId !== spot.artist_id) {
        const putRes = await apiClient.PUT('/festivals/{festivalID}/spots/{spotID}/artist', {
          params: { path: { festivalID: festivalId, spotID: spot.id! } },
          body: { artist_id: artistId },
        })
        if (putRes.error) throw new Error('Failed to assign artist')
      } else if (!artistId && spot.artist_id) {
        const delRes = await apiClient.DELETE('/festivals/{festivalID}/spots/{spotID}/artist', {
          params: { path: { festivalID: festivalId, spotID: spot.id! } },
        })
        if (delRes.error) throw new Error('Failed to unassign artist')
      }

      onMutated()
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    setSaving(true)
    try {
      const res = await apiClient.DELETE('/festivals/{festivalID}/spots/{spotID}', {
        params: { path: { festivalID: festivalId, spotID: spot.id! } },
      })
      if (res.error) {
        setSaveError('Failed to delete spot')
        return
      }
      onMutated()
      onClose()
    } catch {
      setSaveError('Failed to delete spot')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-4 p-5 bg-warm border border-light rounded-lg" data-testid="spot-panel">
      <div className="flex justify-between items-start mb-3">
        <h2 className="font-serif text-xl text-ink">Spot {spot.number}</h2>
        <button onClick={onClose} aria-label="Close" className="font-sans text-xs text-mid hover:text-ink">✕</button>
      </div>

      <div className="space-y-3 max-w-sm">
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="font-sans text-xs text-mid block mb-1">Lat</label>
            <input value={lat} onChange={e => setLat(e.target.value)}
              className="w-full border border-light rounded-lg px-3 py-2 font-mono text-sm text-ink bg-offwhite focus:outline-none focus:border-amber" />
          </div>
          <div className="flex-1">
            <label className="font-sans text-xs text-mid block mb-1">Lng</label>
            <input value={lng} onChange={e => setLng(e.target.value)}
              className="w-full border border-light rounded-lg px-3 py-2 font-mono text-sm text-ink bg-offwhite focus:outline-none focus:border-amber" />
          </div>
        </div>

        <div>
          <label className="font-sans text-xs text-mid block mb-1">What3Words (optional)</label>
          <input value={w3w} onChange={e => setW3w(e.target.value)} placeholder="e.g. filled.count.soap"
            className="w-full border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite focus:outline-none focus:border-amber" />
        </div>

        <div className="flex gap-2">
          <div className="flex-1">
            <label className="font-sans text-xs text-mid block mb-1">Width (m)</label>
            <input value={widthM} onChange={e => setWidthM(e.target.value)} placeholder="—"
              className="w-full border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite focus:outline-none focus:border-amber" />
          </div>
          <div className="flex-1">
            <label className="font-sans text-xs text-mid block mb-1">Height (m)</label>
            <input value={heightM} onChange={e => setHeightM(e.target.value)} placeholder="—"
              className="w-full border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite focus:outline-none focus:border-amber" />
          </div>
        </div>

        <div>
          <label className="font-sans text-xs text-mid block mb-1">Notes (internal)</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
            placeholder="e.g. needs cherry picker"
            className="w-full border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite focus:outline-none focus:border-amber resize-none" />
        </div>

        <div>
          <label className="font-sans text-xs text-mid block mb-1">Artist</label>
          <select value={artistId} onChange={e => setArtistId(e.target.value)}
            className="w-full border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite focus:outline-none focus:border-amber">
            <option value="">— unassigned —</option>
            {artistOptions.map(a => (
              <option key={a.artist_id} value={a.artist_id ?? ''}>{a.name}</option>
            ))}
          </select>
        </div>

        {saveError && <p role="alert" className="font-sans text-sm text-clay">{saveError}</p>}

        <div className="flex gap-3 items-center">
          <button onClick={handleSave} disabled={saving}
            className="font-sans text-sm bg-amber text-ink font-medium px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={handleDelete} disabled={saving}
            className="font-sans text-sm text-clay hover:opacity-80 disabled:opacity-50">
            Delete spot
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Map editor ───────────────────────────────────────────────────────────────

export default function MapEditorClient({ festivalId }: { festivalId: string }) {
  const queryClient = useQueryClient()
  const [placingSpot, setPlacingSpot] = useState(false)
  const [selectedSpotId, setSelectedSpotId] = useState<string | null>(null)
  const [placeError, setPlaceError] = useState<string | null>(null)

  const spotsQuery = useQuery({
    queryKey: ['spots', festivalId],
    queryFn: async () => {
      const res = await apiClient.GET('/festivals/{festivalID}/spots', {
        params: { path: { festivalID: festivalId } },
      })
      if (res.error) throw new Error('Failed to load spots')
      return res.data as FestivalSpotsResponse
    },
  })

  const createSpotMutation = useMutation({
    mutationFn: async ({ lat, lng }: { lat: number; lng: number }) => {
      const res = await apiClient.POST('/festivals/{festivalID}/spots', {
        params: { path: { festivalID: festivalId } },
        body: { lat, lng },
      })
      if (res.error) throw new Error('Failed to create spot')
      return res.data as FestivalSpot
    },
    onSuccess: (spot) => {
      queryClient.invalidateQueries({ queryKey: ['spots', festivalId] })
      setPlacingSpot(false)
      setSelectedSpotId(spot.id ?? null)
      setPlaceError(null)
    },
    onError: (e: Error) => setPlaceError(e.message),
  })

  function handleMapClick(lat: number, lng: number) {
    if (!placingSpot) return
    createSpotMutation.mutate({ lat, lng })
  }

  function handleMutated() {
    queryClient.invalidateQueries({ queryKey: ['spots', festivalId] })
  }

  const spots = spotsQuery.data?.spots ?? []
  const unassignedArtists = spotsQuery.data?.unassigned_artists ?? []
  const selectedSpot = spots.find(s => s.id === selectedSpotId) ?? null
  const assignedCount = spots.filter(s => s.artist_id).length

  const center: [number, number] = spots.length > 0
    ? [spots.reduce((s, p) => s + (p.lat ?? 0), 0) / spots.length,
       spots.reduce((s, p) => s + (p.lng ?? 0), 0) / spots.length]
    : [52.4, -1.5]
  const zoom = spots.length > 0 ? 15 : 6

  return (
    <div>
      <div className="mb-6">
        <Link href={`/organiser/festivals/${festivalId}`}
          className="font-mono text-xs text-mid uppercase tracking-widest hover:text-ink transition-colors">
          ← Festival
        </Link>
      </div>

      <h1 className="font-serif text-4xl text-ink mb-2">Map editor</h1>

      <div className="flex gap-6 items-start mt-4">
        {/* Sidebar */}
        <div className="w-56 flex-shrink-0">
          <button
            onClick={() => { setPlacingSpot(v => !v); setPlaceError(null) }}
            className={`w-full font-sans text-sm font-medium px-4 py-2 rounded-lg mb-4 transition-colors ${
              placingSpot
                ? 'bg-ink text-offwhite'
                : 'bg-amber text-ink hover:opacity-90'
            }`}
            data-testid="add-spot-btn"
          >
            {placingSpot ? 'Click map to place…' : '+ Add spot'}
          </button>

          {placeError && (
            <p role="alert" className="font-sans text-xs text-clay mb-3">{placeError}</p>
          )}

          {spots.length > 0 && (
            <ul className="space-y-1" data-testid="spots-list">
              {spots.map(s => (
                <li key={s.id}>
                  <button
                    onClick={() => setSelectedSpotId(s.id === selectedSpotId ? null : (s.id ?? null))}
                    className={`w-full text-left rounded-lg px-3 py-2 text-sm transition-colors ${
                      s.id === selectedSpotId
                        ? 'bg-amber/20 border border-amber'
                        : 'bg-warm border border-light hover:border-amber'
                    }`}
                  >
                    <span className="font-sans font-medium text-ink">Spot {s.number}</span>
                    <span className={`ml-2 font-mono text-xs uppercase tracking-widest px-1.5 py-0.5 rounded-full ${
                      s.artist_id ? 'bg-clay text-offwhite' : 'bg-amber/30 text-ink'
                    }`}>
                      {s.artist_id ? 'assigned' : 'empty'}
                    </span>
                    {s.artist_id && (
                      <div className="font-sans text-xs text-mid mt-0.5 truncate">{s.artist_name}</div>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {spots.length === 0 && !spotsQuery.isLoading && (
            <p className="font-sans text-xs text-mid">No spots yet.</p>
          )}

          {spots.length > 0 && (
            <p className="font-mono text-xs text-mid uppercase tracking-widest mt-3">
              {spots.length} spots · {assignedCount} assigned
            </p>
          )}
        </div>

        {/* Map */}
        <div className="flex-1">
          {spotsQuery.isError && (
            <p role="alert" className="font-sans text-sm text-clay mb-4">Failed to load spots.</p>
          )}

          {!spotsQuery.isLoading && (
            <div className="border border-light rounded-lg overflow-hidden" style={{ height: '500px' }}>
              <MapContainer center={center} zoom={zoom} className="w-full h-full bg-light">
                <TileLayer
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                />
                <MapClickCapture active={placingSpot} onMapClick={handleMapClick} />
                {spots.map(s => (
                  <Marker
                    key={s.id}
                    position={[s.lat ?? 0, s.lng ?? 0]}
                    icon={s.artist_id ? TerracottaIcon : AmberIcon}
                    eventHandlers={{ click: () => setSelectedSpotId(s.id === selectedSpotId ? null : (s.id ?? null)) }}
                  >
                    <Popup>
                      <span className="font-sans text-sm">
                        Spot {s.number}{s.artist_name ? ` — ${s.artist_name}` : ''}
                      </span>
                    </Popup>
                  </Marker>
                ))}
              </MapContainer>
            </div>
          )}

          {selectedSpot && (
            <SpotPanel
              spot={selectedSpot}
              unassignedArtists={unassignedArtists}
              festivalId={festivalId}
              onClose={() => setSelectedSpotId(null)}
              onMutated={handleMutated}
            />
          )}
        </div>
      </div>
    </div>
  )
}
