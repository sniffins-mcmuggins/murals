'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { apiClient } from '@/lib/api'
import type { components } from '@render/api-client'

type FestivalSummary = components['schemas']['FestivalSummary']

export default function OrganiserDashboardPage() {
  const reviewingQuery = useQuery({
    queryKey: ['me-reviewing'],
    queryFn: async () => {
      const res = await apiClient.GET('/me/reviewing')
      if (res.error) throw new Error('Failed to load reviewing festivals')
      return (res.data ?? []) as FestivalSummary[]
    },
  })

  const reviewing = reviewingQuery.data ?? []

  return (
    <div>
      <h1 className="font-serif text-4xl text-ink mb-2">Organiser Dashboard</h1>
      <p className="font-sans text-mid mb-8">Manage your festivals and applications.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/organiser/festivals"
          className="block p-5 bg-warm border border-light rounded-lg hover:border-amber transition-colors"
        >
          <h2 className="font-serif text-xl text-ink mb-1">Festivals</h2>
          <p className="font-sans text-sm text-mid">Create and manage your paint festivals.</p>
        </Link>

        {reviewing.length > 0 && (
          <Link
            href="/organiser/reviewing"
            className="block p-5 bg-warm border border-light rounded-lg hover:border-amber transition-colors"
          >
            <h2 className="font-serif text-xl text-ink mb-1">
              Reviewing ({reviewing.length})
            </h2>
            <p className="font-sans text-sm text-mid">Festivals you&apos;ve been invited to review.</p>
          </Link>
        )}
      </div>
    </div>
  )
}
