'use client'

import dynamic from 'next/dynamic'

// Leaflet touches `window` at module level — must be loaded client-side only.
// This client wrapper enables ssr: false for the Server Component page shell.
const MapEditorClient = dynamic(() => import('./MapEditorClient'), {
  ssr: false,
  loading: () => <div className="font-sans text-mid text-sm p-8">Loading map…</div>,
})

export default function MapEditorWrapper({ festivalId }: { festivalId: string }) {
  return <MapEditorClient festivalId={festivalId} />
}
