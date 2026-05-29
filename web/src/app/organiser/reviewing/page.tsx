'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { apiClient } from '@/lib/api'
import type { components } from '@render/api-client'

type FestivalSummary = components['schemas']['FestivalSummary']

export default function ReviewingPage() {
  const reviewingQuery = useQuery({
    queryKey: ['me-reviewing'],
    queryFn: async () => {
      const res = await apiClient.GET('/me/reviewing')
      if (res.error) return [] as FestivalSummary[]
      return (res.data ?? []) as FestivalSummary[]
    },
  })

  const festivals = reviewingQuery.data ?? []

  return (
    <div>
      <div className="mb-6">
        <Link
          href="/organiser/dashboard"
          className="font-mono text-xs text-mid uppercase tracking-widest hover:text-ink transition-colors"
        >
          ← Dashboard
        </Link>
      </div>

      <h1 className="font-serif text-4xl text-ink mb-2">Reviewing</h1>
      <p className="font-sans text-mid mb-8">Festivals you&apos;ve been invited to review.</p>

      {reviewingQuery.isLoading && (
        <p className="font-sans text-mid text-sm">Loading…</p>
      )}

      {!reviewingQuery.isLoading && festivals.length === 0 && (
        <p className="font-sans text-sm text-mid">
          You haven&apos;t been invited to review any festivals yet.
        </p>
      )}

      {festivals.length > 0 && (
        <ul className="space-y-3">
          {festivals.map(fest => (
            <li key={fest.id}>
              <div className="flex items-center justify-between p-5 bg-warm border border-light rounded-lg">
                <div>
                  <h2 className="font-serif text-lg text-ink">{fest.name}</h2>
                  <span className="font-mono text-xs text-mid uppercase tracking-widest">
                    {fest.status}
                  </span>
                </div>
                <Link
                  href={`/organiser/festivals/${fest.id}/applications`}
                  className="font-sans text-sm font-medium bg-amber text-ink px-4 py-2 rounded-lg hover:opacity-90"
                >
                  Go to applications →
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
