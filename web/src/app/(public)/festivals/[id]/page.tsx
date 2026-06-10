import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { apiClient } from '@/lib/api'
import { formatDateRange } from '@/lib/dates'

type Props = {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const res = await apiClient.GET('/festivals/{festivalID}', {
    params: { path: { festivalID: id } },
  })
  if (res.error || !res.data) {
    return { title: 'Festival not found | Painttrace' }
  }
  return {
    title: `${res.data.name} | Painttrace`,
    description: res.data.description,
  }
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  open: 'Open',
  live: 'Live',
  archived: 'Archived',
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-warm text-mid border-light',
  open: 'bg-amber/20 text-amber border-amber/30',
  live: 'bg-clay/20 text-clay border-clay/30',
  archived: 'bg-warm text-mid border-light',
}

export default async function FestivalPage({ params }: Props) {
  const { id } = await params

  const festivalRes = await apiClient.GET('/festivals/{festivalID}', {
    params: { path: { festivalID: id } },
  })

  if (festivalRes.error || !festivalRes.data) {
    notFound()
  }

  const festival = festivalRes.data

  const mapRes = await apiClient.GET('/festivals/slug/{slug}/map', {
    params: { path: { slug: festival.slug! } },
  })
  const pins = mapRes.data?.pins ?? []

  const status = festival.status ?? 'draft'
  const statusLabel = STATUS_LABELS[status] ?? status
  const statusColor = STATUS_COLORS[status] ?? STATUS_COLORS.draft

  return (
    <main className="min-h-screen bg-offwhite">
      <div className="max-w-3xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-start gap-4 flex-wrap">
            <h1 className="font-serif text-5xl text-ink leading-tight flex-1">
              {festival.name}
            </h1>
            <span
              className={`inline-block font-mono text-xs uppercase tracking-widest px-3 py-1 border rounded mt-2 ${statusColor}`}
            >
              {statusLabel}
            </span>
          </div>

          {festival.location_label && (
            <p className="mt-3 font-sans text-mid text-lg">{festival.location_label}</p>
          )}

          <p className="mt-2 font-mono text-sm text-mid uppercase tracking-wider">
            {formatDateRange(festival.start_date, festival.end_date)}
          </p>
        </div>

        {/* Description */}
        {festival.description && (
          <div className="mb-10 border-t border-light pt-8">
            <p className="font-sans text-ink text-lg leading-relaxed">{festival.description}</p>
          </div>
        )}

        {/* Apply CTA */}
        {festival.status === 'open' && (
          <div className="mb-10 bg-amber/10 border border-amber/30 rounded-lg p-6">
            <p className="font-sans text-ink mb-4">
              Applications are open for this festival.
            </p>
            <Link
              href={`/festivals/${id}/apply`}
              className="inline-block bg-amber text-ink font-sans font-semibold px-6 py-3 rounded hover:bg-amber/90 transition-colors"
            >
              Apply to exhibit
            </Link>
          </div>
        )}

        {/* Map link */}
        {festival.status === 'live' && (
          <div className="mb-10">
            <Link
              href={`/festivals/${id}/map`}
              className="inline-block font-sans font-semibold text-ink bg-amber px-6 py-3 rounded hover:bg-amber/90 transition-colors"
            >
              View map
            </Link>
          </div>
        )}

        {/* Accepted Artists */}
        <div className="border-t border-light pt-8">
          <h2 className="font-serif text-2xl text-ink mb-6">Accepted Artists</h2>
          {pins.length > 0 ? (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {pins.map((pin) => (
                <li key={pin.artist_id}>
                  <Link
                    href={`/artists/${pin.artist_id}`}
                    className="block font-sans text-ink hover:text-amber transition-colors py-1"
                  >
                    {pin.name}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="font-sans text-mid">No artists announced yet.</p>
          )}
        </div>
      </div>
    </main>
  )
}
