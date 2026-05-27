import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { apiClient } from '@/lib/api'
import type { MapPin } from './FestivalMap'
import FestivalMapClient from './FestivalMapClient'

type Props = {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const res = await apiClient.GET('/festivals/{festivalID}', {
    params: { path: { festivalID: id } },
  })
  const name = res.data?.name ?? 'Festival'
  return { title: `${name} — Map | Render` }
}

export default async function FestivalMapPage({ params }: Props) {
  const { id } = await params

  const festivalRes = await apiClient.GET('/festivals/{festivalID}', {
    params: { path: { festivalID: id } },
  })

  if (festivalRes.error || !festivalRes.data) {
    notFound()
  }

  const festival = festivalRes.data
  const festivalName = festival.name ?? 'Festival'

  if (!festival.slug) {
    notFound()
  }

  const mapRes = await apiClient.GET('/festivals/slug/{slug}/map', {
    params: { path: { slug: festival.slug } },
  })

  // Filter out any pins that are missing required fields (API type marks all fields as optional)
  const pins: MapPin[] = (mapRes.data?.pins ?? []).filter(
    (p): p is MapPin =>
      typeof p.artist_id === 'string' &&
      typeof p.name === 'string' &&
      typeof p.lat === 'number' &&
      typeof p.lng === 'number',
  )

  return (
    <div className="fixed inset-0 flex flex-col">
      {/* Top bar */}
      <header className="flex items-center gap-4 px-4 py-3 bg-offwhite border-b border-light shrink-0 z-[600]">
        <Link
          href={`/festivals/${id}`}
          className="font-mono text-xs text-mid uppercase tracking-widest hover:text-ink transition-colors"
        >
          ← Back
        </Link>
        <h1 className="font-serif text-lg text-ink leading-tight flex-1 truncate">
          {festivalName}
        </h1>
        <span className="font-mono text-xs text-mid uppercase tracking-widest hidden sm:block">
          Map
        </span>
      </header>

      {/* Full-height map */}
      <div className="flex-1 relative overflow-hidden">
        <FestivalMapClient pins={pins} festivalName={festivalName} />
      </div>
    </div>
  )
}
