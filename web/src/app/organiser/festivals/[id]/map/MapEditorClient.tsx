'use client'

import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { MapContainer, TileLayer, Marker, Popup, CircleMarker, useMapEvents, useMap } from 'react-leaflet'
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
type GeocodeSuggestion = components['schemas']['GeocodeSuggestion']

type HistoryEntry = {
  spot_id: string
  festival_id: string
  festival_name: string
  festival_year?: number | null
  lat: number
  lng: number
  mural_status: 'permanent' | 'temporary' | 'unknown'
}

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

// Provisional pin dropped at a searched address — visually distinct (dashed
// ring) until the organiser confirms it into a real spot.
const DraftIcon = L.divIcon({
  className: '',
  html: '<div style="width:20px;height:20px;background:rgba(196,92,58,.25);border:2.5px dashed #C45C3A;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,.25)"></div>',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
})

// ─── Map ref capture ──────────────────────────────────────────────────────────

function MapRefCapture({ onReady }: { onReady: (map: L.Map) => void }) {
  const map = useMap()
  useEffect(() => { onReady(map) }, [map, onReady])
  return null
}

// ─── Map view updater ─────────────────────────────────────────────────────────

function MapViewUpdater({ target }: { target: [number, number] | null }) {
  const map = useMap()
  useEffect(() => {
    if (target) map.setView(target, 16)
  }, [target, map])
  return null
}

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
  const [muralStatus, setMuralStatus] = useState<'permanent' | 'temporary' | 'unknown'>(
    (spot.mural_status as 'permanent' | 'temporary' | 'unknown') ?? 'unknown'
  )
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
    setMuralStatus((spot.mural_status as 'permanent' | 'temporary' | 'unknown') ?? 'unknown')
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
          mural_status: muralStatus,
        },
      })
      if (patchRes.error) throw new Error('Failed to save spot details')

      // Handle artist assignment change
      if (artistId && artistId !== spot.artist_id) {
        const putRes = await apiClient.PUT('/festivals/{festivalID}/spots/{spotID}/artist', {
          params: { path: { festivalID: festivalId, spotID: spot.id! } },
          body: { artist_id: artistId },
        })
        if (putRes.error) throw new Error('Details saved — but artist assignment failed. Refresh and try again.')
      } else if (!artistId && spot.artist_id) {
        const delRes = await apiClient.DELETE('/festivals/{festivalID}/spots/{spotID}/artist', {
          params: { path: { festivalID: festivalId, spotID: spot.id! } },
        })
        if (delRes.error) throw new Error('Details saved — but could not unassign artist. Refresh and try again.')
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
          <label className="font-sans text-xs text-mid block mb-1">Mural status</label>
          <select
            value={muralStatus}
            onChange={e => setMuralStatus(e.target.value as 'permanent' | 'temporary' | 'unknown')}
            className="w-full border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite focus:outline-none focus:border-amber"
            aria-label="Mural status"
          >
            <option value="unknown">Unknown</option>
            <option value="permanent">Permanent — mural still on the wall</option>
            <option value="temporary">Temporary — wall painted over</option>
          </select>
        </div>

        <div className="flex flex-wrap gap-3 pt-1 border-t border-light">
          <a
            href={
              spot.w3w
                ? `https://what3words.com/${spot.w3w}`
                : `https://what3words.com/${spot.lat},${spot.lng}`
            }
            target="_blank"
            rel="noreferrer"
            className="font-mono text-xs text-mid hover:text-ink uppercase tracking-widest"
            data-testid="link-w3w"
          >
            {'///'}w3w
          </a>
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${spot.lat},${spot.lng}`}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-xs text-mid hover:text-ink uppercase tracking-widest"
            data-testid="link-google"
          >
            Google Maps
          </a>
          <a
            href={`https://maps.apple.com/?q=${spot.lat},${spot.lng}`}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-xs text-mid hover:text-ink uppercase tracking-widest"
            data-testid="link-apple"
          >
            Apple Maps
          </a>
        </div>

        <div>
          <label className="font-sans text-xs text-mid block mb-1">Artist</label>
          <select value={artistId} onChange={e => setArtistId(e.target.value)}
            aria-label="Artist"
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
  const [searchQ, setSearchQ] = useState('')
  const [searchResults, setSearchResults] = useState<GeocodeSuggestion[]>([])
  const [mapTarget, setMapTarget] = useState<[number, number] | null>(null)
  const [searchError, setSearchError] = useState(false)
  const [draftPin, setDraftPin] = useState<{ lat: number; lng: number } | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [checkedFestivals, setCheckedFestivals] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (searchQ.trim().length < 3) {
      setSearchResults([])
      return
    }
    const timer = setTimeout(async () => {
      try {
        const res = await apiClient.GET('/geocode/search', {
          params: { query: { q: searchQ.trim() } },
        })
        if (res.data) {
          setSearchResults(res.data as GeocodeSuggestion[])
          setSearchError(false)
        }
      } catch {
        setSearchResults([])
        setSearchError(true)
      }
    }, 400)
    return () => clearTimeout(timer)
  }, [searchQ])

  const festivalQuery = useQuery({
    queryKey: ['festival', festivalId],
    queryFn: async () => {
      const res = await apiClient.GET('/festivals/{festivalID}', {
        params: { path: { festivalID: festivalId } },
      })
      return res.data ?? null
    },
  })

  const historyQuery = useQuery({
    queryKey: ['spots-history', festivalId],
    queryFn: async () => {
      const res = await apiClient.GET('/festivals/{festivalID}/spots/nearby-history', {
        params: { path: { festivalID: festivalId } },
      })
      return (res.data ?? []) as HistoryEntry[]
    },
  })

  function handleSelectResult(r: GeocodeSuggestion) {
    setMapTarget([r.lat, r.lng])
    // Drop a draft pin the organiser confirms (and can drag) before it becomes a spot.
    setDraftPin({ lat: r.lat, lng: r.lng })
    setSearchQ('')
    setSearchResults([])
    setSearchError(false)
    // Auto-save festival centre on first geocode selection
    if (!festivalQuery.data?.center_lat) {
      apiClient.PATCH('/festivals/{festivalID}', {
        params: { path: { festivalID: festivalId } },
        body: { center_lat: r.lat, center_lng: r.lng },
      }).catch(() => {})
    }
  }

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

  const dragSpotMutation = useMutation({
    mutationFn: async ({
      spotId,
      lat,
      lng,
      spot,
    }: {
      spotId: string
      lat: number
      lng: number
      spot: FestivalSpot
    }) => {
      const res = await apiClient.PATCH('/festivals/{festivalID}/spots/{spotID}', {
        params: { path: { festivalID: festivalId, spotID: spotId } },
        body: {
          lat,
          lng,
          // Must resend all mutable fields — UpdateSpotHandler is a full replace.
          // Omitting any of these silently clears the column.
          w3w: spot.w3w ?? null,
          width_m: spot.width_m ?? null,
          height_m: spot.height_m ?? null,
          notes: spot.notes ?? null,
          mural_status: (spot.mural_status as 'permanent' | 'temporary' | 'unknown') ?? 'unknown',
        },
      })
      if (res.error) throw new Error('Failed to move spot')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['spots', festivalId] }),
    onError: () => {
      // Snap the marker back to the server position on failure
      queryClient.invalidateQueries({ queryKey: ['spots', festivalId] })
    },
  })

  const assignArtistMutation = useMutation({
    mutationFn: async ({ spotId, artistId }: { spotId: string; artistId: string }) => {
      const res = await apiClient.PUT('/festivals/{festivalID}/spots/{spotID}/artist', {
        params: { path: { festivalID: festivalId, spotID: spotId } },
        body: { artist_id: artistId },
      })
      if (res.error) throw new Error('Failed to assign artist')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['spots', festivalId] }),
    onError: (e: Error) => setPlaceError(e.message),
  })

  const draggingArtistId = useRef<string | null>(null)
  const mapRef = useRef<L.Map | null>(null)

  function handleMapClick(lat: number, lng: number) {
    if (!placingSpot) return
    createSpotMutation.mutate({ lat, lng })
  }

  function handleMutated() {
    queryClient.invalidateQueries({ queryKey: ['spots', festivalId] })
  }

  const spots = spotsQuery.data?.spots ?? []
  const unassignedArtists = spotsQuery.data?.unassigned_artists ?? []
  const historyEntries: HistoryEntry[] = Array.isArray(historyQuery.data) ? historyQuery.data : []
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
            className={`w-full font-sans text-sm font-medium px-4 py-2 rounded-lg mb-2 transition-colors ${
              placingSpot
                ? 'bg-ink text-offwhite'
                : 'bg-amber text-ink hover:opacity-90'
            }`}
            data-testid="add-spot-btn"
          >
            {placingSpot ? 'Click map to place…' : '+ Add spot'}
          </button>

          {/* History overlay toggle */}
          <div className="relative mb-4">
            <button
              onClick={() => setHistoryOpen(o => !o)}
              className={`w-full font-mono text-xs uppercase tracking-widest px-3 py-2 rounded-lg border transition-colors ${historyOpen ? 'bg-amber/10 border-amber text-ink' : 'bg-offwhite border-light text-mid hover:text-ink'}`}
            >
              🕐 History {historyOpen ? '▲' : '▾'}
            </button>
            {historyOpen && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-offwhite border border-light rounded-lg shadow-lg z-50 p-3">
                <p className="font-mono text-xs text-mid uppercase tracking-widest mb-2">Overlay previous years</p>
                {(historyEntries).length === 0 && (
                  <p className="font-sans text-xs text-mid">No nearby festivals found.</p>
                )}
                {Array.from(
                  new Map((historyEntries).map((e: HistoryEntry) => [e.festival_id, e])).values()
                ).map((fest: HistoryEntry) => (
                  <label key={fest.festival_id} className="flex items-center gap-2 py-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      className="accent-amber"
                      checked={checkedFestivals.has(fest.festival_id)}
                      onChange={e => {
                        setCheckedFestivals(prev => {
                          const next = new Set(prev)
                          if (e.target.checked) next.add(fest.festival_id)
                          else next.delete(fest.festival_id)
                          return next
                        })
                      }}
                    />
                    <span className="font-sans text-xs text-ink">
                      {fest.festival_name}{fest.festival_year ? ` · ${fest.festival_year}` : ''}
                    </span>
                  </label>
                ))}
                <div className="mt-2 pt-2 border-t border-light space-y-1">
                  <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full inline-block bg-amber opacity-70" /><span className="font-mono text-xs text-mid">Permanent</span></div>
                  <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full inline-block bg-mid opacity-50" /><span className="font-mono text-xs text-mid">Temporary</span></div>
                  <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full inline-block bg-light" /><span className="font-mono text-xs text-mid">Unknown</span></div>
                </div>
              </div>
            )}
          </div>

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

          {/* Artist pool — drag cards onto a map pin to assign */}
          {unassignedArtists.length > 0 && (
            <div className="mt-6">
              <h2 className="font-mono text-xs text-mid uppercase tracking-widest mb-2">
                Unassigned · {unassignedArtists.length}
              </h2>
              <ul className="space-y-1" data-testid="artist-rail">
                {unassignedArtists.map(a => (
                  <li
                    key={a.artist_id}
                    draggable
                    onDragStart={(e) => {
                      if (a.artist_id) {
                        e.dataTransfer.setData('text/artist-id', a.artist_id)
                        draggingArtistId.current = a.artist_id
                      }
                    }}
                    onDragEnd={() => { draggingArtistId.current = null }}
                    className="cursor-grab active:cursor-grabbing bg-warm border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink hover:border-amber"
                  >
                    {a.name}
                  </li>
                ))}
              </ul>
              <p className="font-sans text-xs text-mid mt-2">Drag a name onto a pin to assign.</p>
            </div>
          )}
        </div>

        {/* Map */}
        <div className="flex-1">
          {/* Address search — recentres the map, never creates a spot */}
          <div className="relative mb-3" data-testid="geocode-search">
            <input
              type="text"
              value={searchQ}
              onChange={e => setSearchQ(e.target.value)}
              placeholder="Search address or postcode…"
              className="w-full border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite focus:outline-none focus:border-amber"
              aria-label="Search address"
              aria-autocomplete="list"
            />
            {searchError && (
              <p className="font-sans text-xs text-clay mt-1">Search unavailable</p>
            )}
            {searchResults.length > 0 && (
              <ul
                role="listbox"
                className="absolute z-[1000] top-full left-0 right-0 mt-1 bg-offwhite border border-light rounded-lg shadow-lg overflow-hidden"
                data-testid="geocode-results"
              >
                {searchResults.map((r, i) => (
                  <li key={i} role="option" aria-selected={false}>
                    <button
                      onClick={() => handleSelectResult(r)}
                      className="w-full text-left px-3 py-2 font-sans text-sm text-ink hover:bg-warm truncate"
                    >
                      {r.display_name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {draftPin && (
            <div className="mb-3 flex items-center gap-3 p-3 bg-warm border border-amber rounded-lg" data-testid="draft-pin-confirm">
              <span className="font-sans text-sm text-ink flex-1">
                Add a spot here? Drag the dashed pin to fine-tune the position first.
              </span>
              <button
                onClick={() => { createSpotMutation.mutate(draftPin); setDraftPin(null) }}
                className="font-sans text-sm bg-amber text-ink font-medium px-4 py-2 rounded-lg hover:opacity-90"
                data-testid="confirm-draft-spot"
              >
                Add spot here
              </button>
              <button
                onClick={() => setDraftPin(null)}
                className="font-sans text-sm text-mid hover:text-ink px-2"
              >
                Cancel
              </button>
            </div>
          )}

          {spotsQuery.isError && (
            <p role="alert" className="font-sans text-sm text-clay mb-4">Failed to load spots.</p>
          )}

          {!spotsQuery.isLoading && (
            <div
              className="border border-light rounded-lg overflow-hidden"
              style={{ height: '500px' }}
              onDragOver={(e) => { if (e.dataTransfer.types.includes('text/artist-id') || draggingArtistId.current) e.preventDefault() }}
              onDrop={(e) => {
                e.preventDefault()
                const artistId = e.dataTransfer.getData('text/artist-id') || draggingArtistId.current
                const map = mapRef.current
                if (!artistId || !map) return
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                const dropPt = L.point(e.clientX - rect.left, e.clientY - rect.top)
                // Find the nearest spot marker within 35px.
                let nearest: { id: string; dist: number } | null = null
                for (const s of spots) {
                  if (s.lat == null || s.lng == null || !s.id) continue
                  const pt = map.latLngToContainerPoint([s.lat, s.lng])
                  const dist = pt.distanceTo(dropPt)
                  if (dist <= 35 && (!nearest || dist < nearest.dist)) nearest = { id: s.id, dist }
                }
                draggingArtistId.current = null
                if (nearest) assignArtistMutation.mutate({ spotId: nearest.id, artistId })
              }}
            >
              <MapContainer center={center} zoom={zoom} className="w-full h-full bg-light">
                <TileLayer
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                />
                <MapClickCapture active={placingSpot} onMapClick={handleMapClick} />
                <MapViewUpdater target={mapTarget} />
                <MapRefCapture onReady={(m) => { mapRef.current = m }} />
                {(historyEntries)
                  .filter((e: HistoryEntry) => checkedFestivals.has(e.festival_id))
                  .map((e: HistoryEntry) => {
                    const color = e.mural_status === 'permanent' ? '#E8A838' : e.mural_status === 'temporary' ? '#8A8896' : '#E2DDD6'
                    const opacity = e.mural_status === 'permanent' ? 0.7 : 0.45
                    return (
                      <CircleMarker key={e.spot_id} center={[e.lat, e.lng]} radius={8} pathOptions={{ color, fillColor: color, fillOpacity: opacity, weight: 1 }}>
                        <Popup>
                          <span className="font-sans text-xs">
                            {e.festival_name}{e.festival_year ? ` ${e.festival_year}` : ''}<br />
                            <span className="capitalize">{e.mural_status}</span>
                          </span>
                        </Popup>
                      </CircleMarker>
                    )
                  })}
                {spots.map(s => (
                  <Marker
                    key={s.id}
                    position={[s.lat ?? 0, s.lng ?? 0]}
                    icon={s.artist_id ? TerracottaIcon : AmberIcon}
                    draggable={!placingSpot}
                    eventHandlers={{
                      click: () => setSelectedSpotId(s.id === selectedSpotId ? null : (s.id ?? null)),
                      dragend: (e) => {
                        const { lat, lng } = (e.target as L.Marker).getLatLng()
                        dragSpotMutation.mutate({ spotId: s.id!, lat, lng, spot: s })
                      },
                    }}
                  >
                    <Popup>
                      <span className="font-sans text-sm">
                        Spot {s.number}{s.artist_name ? ` — ${s.artist_name}` : ''}
                      </span>
                    </Popup>
                  </Marker>
                ))}
                {draftPin && (
                  <Marker
                    position={[draftPin.lat, draftPin.lng]}
                    icon={DraftIcon}
                    draggable
                    eventHandlers={{
                      dragend: (e) => {
                        const { lat, lng } = (e.target as L.Marker).getLatLng()
                        setDraftPin({ lat, lng })
                      },
                    }}
                  >
                    <Popup>
                      <span className="font-sans text-sm">Draft spot — confirm to add</span>
                    </Popup>
                  </Marker>
                )}
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
