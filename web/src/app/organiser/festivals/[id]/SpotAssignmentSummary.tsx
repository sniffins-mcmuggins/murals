'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { components } from '@render/api-client'

type FestivalSpotsResponse = components['schemas']['FestivalSpotsResponse']

export function SpotAssignmentSummary({ festivalId }: { festivalId: string }) {
  const { data } = useQuery({
    queryKey: ['spots', festivalId],
    queryFn: async () => {
      const res = await apiClient.GET('/festivals/{festivalID}/spots', {
        params: { path: { festivalID: festivalId } },
      })
      if (res.error) throw new Error('Failed to load spots')
      return res.data as FestivalSpotsResponse
    },
  })

  const spots = data?.spots ?? []
  const unassigned = data?.unassigned_artists ?? []
  const assigned = spots.filter(s => s.artist_id)

  return (
    <section className="mt-8" data-testid="spot-assignment-summary">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-serif text-2xl text-ink">Spot assignments</h2>
        <Link href={`/organiser/festivals/${festivalId}/map`}
          className="font-mono text-xs text-mid uppercase tracking-widest hover:text-ink">
          Map editor{unassigned.length > 0 ? ` · ${unassigned.length} unassigned` : ''} →
        </Link>
      </div>
      <ul className="space-y-1">
        {assigned.map(s => (
          <li key={s.id} className="flex justify-between font-sans text-sm">
            <span className="text-ink">{s.artist_name}</span>
            <span className="text-mid">Spot {s.number} ✓</span>
          </li>
        ))}
        {unassigned.map(a => (
          <li key={a.artist_id} className="flex justify-between font-sans text-sm">
            <span className="text-ink">{a.name}</span>
            <span className="text-clay">unassigned ⚠</span>
          </li>
        ))}
        {assigned.length === 0 && unassigned.length === 0 && (
          <li className="font-sans text-sm text-mid">No accepted artists to place yet.</li>
        )}
      </ul>
    </section>
  )
}
