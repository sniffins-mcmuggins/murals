'use client'

import dynamic from 'next/dynamic'
import type { MapPin } from './FestivalMap'

const FestivalMap = dynamic(() => import('./FestivalMap'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full bg-warm">
      <p className="font-sans text-mid text-sm">Loading map…</p>
    </div>
  ),
})

export default function FestivalMapClient({ pins, festivalName }: { pins: MapPin[]; festivalName: string }) {
  return <FestivalMap pins={pins} festivalName={festivalName} />
}
