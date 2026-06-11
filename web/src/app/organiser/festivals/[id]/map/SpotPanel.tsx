'use client'

import { useState, useEffect } from 'react'
import { apiClient } from '@/lib/api'
import type { components } from '@render/api-client'

type FestivalSpot = components['schemas']['FestivalSpot']
type UnassignedArtist = components['schemas']['UnassignedArtist']

type SpotPanelProps = {
  spot: FestivalSpot
  unassignedArtists: UnassignedArtist[]
  festivalId: string
  onClose: () => void
  onMutated: () => void
}

export function SpotPanel({ spot, unassignedArtists, festivalId, onClose, onMutated }: SpotPanelProps) {
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
