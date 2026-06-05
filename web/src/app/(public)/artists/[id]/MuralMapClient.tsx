'use client'

import dynamic from 'next/dynamic'
import type { SpotEntry } from './MuralMap'

// next/dynamic with ssr:false is only allowed inside a 'use client' component.
// The public artist page is a Server Component, so the Leaflet map must be
// loaded through this client wrapper (mirrors FestivalMapClient.tsx).
const MuralMap = dynamic(() => import('./MuralMap'), {
  ssr: false,
  loading: () => (
    <div className="h-[280px] bg-warm rounded-xl flex items-center justify-center">
      <p className="font-sans text-sm text-mid">Loading map…</p>
    </div>
  ),
})

export default function MuralMapClient({ spots }: { spots: SpotEntry[] }) {
  return <MuralMap spots={spots} />
}
