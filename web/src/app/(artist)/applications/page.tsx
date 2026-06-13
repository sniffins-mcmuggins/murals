'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { apiClient } from '@/lib/api'
import { formatDate, formatDateRange } from '@/lib/dates'
import type { components } from '@render/api-client'

type MyApplication = components['schemas']['MyApplication']
type Festival = components['schemas']['Festival']

// Artist-facing outcome: decision is null until the organiser releases decisions.
const DECISION_DISPLAY: Record<string, { label: string; colour: string }> = {
  accept: { label: 'Accepted', colour: 'bg-green-100 text-green-800' },
  waitlist: { label: 'Waitlisted', colour: 'bg-amber/20 text-amber' },
  decline: { label: 'Declined', colour: 'bg-clay/20 text-clay' },
}
const PENDING_DISPLAY = { label: 'Under review', colour: 'bg-light text-mid' }

export default function ApplicationsPage() {
  const applicationsQuery = useQuery({
    queryKey: ['my-applications'],
    queryFn: async () => {
      const res = await apiClient.GET('/me/applications', {})
      if (res.error) throw new Error('Failed to load applications')
      return (res.data ?? []) as MyApplication[]
    },
  })

  const festivalsQuery = useQuery({
    queryKey: ['public-festivals-open'],
    queryFn: async () => {
      const res = await apiClient.GET('/public/festivals', {
        params: { query: { status: 'open' } },
      })
      if (res.error) throw new Error('Failed to load festivals')
      return (res.data ?? []) as Festival[]
    },
  })

  const applications = applicationsQuery.data ?? []
  const festivals = festivalsQuery.data ?? []
  const isLoading = applicationsQuery.isLoading || festivalsQuery.isLoading
  const isError = applicationsQuery.isError || festivalsQuery.isError

  return (
    <div>
      <h1 className="font-serif text-4xl text-ink mb-8">Applications</h1>

      {/* My applications */}
      <section className="mb-10">
        <h2 className="font-serif text-2xl text-ink mb-4">My applications</h2>

        {isLoading && <p className="font-sans text-mid text-sm">Loading…</p>}

        {isError && (
          <p role="alert" className="font-sans text-sm text-clay">
            Couldn&apos;t load your applications. Refresh to try again.
          </p>
        )}

        {!isLoading && !isError && applications.length === 0 && (
          <p className="font-sans text-mid">No applications yet. Browse open festivals below to apply.</p>
        )}

        {!isLoading && applications.length > 0 && (
          <ul className="space-y-3">
            {applications.map((app, i) => {
              const display = app.decision ? (DECISION_DISPLAY[app.decision] ?? PENDING_DISPLAY) : PENDING_DISPLAY
              return (
                <li
                  key={app.id}
                  className="flex items-center justify-between p-4 bg-warm border border-light rounded-lg"
                >
                  <div>
                    <p className="font-sans text-sm text-ink font-medium">Application #{i + 1}</p>
                    {app.created_at && (
                      <p className="font-sans text-xs text-mid mt-0.5">
                        Submitted {formatDate(app.created_at)}
                      </p>
                    )}
                  </div>
                  <span
                    className={`font-mono text-xs uppercase tracking-wider px-2 py-0.5 rounded ${display.colour}`}
                  >
                    {display.label}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* Browse open festivals */}
      <section>
        <h2 className="font-serif text-2xl text-ink mb-4">Open festivals</h2>

        {!isLoading && !isError && festivals.length === 0 && (
          <p className="font-sans text-mid">No festivals are currently accepting applications.</p>
        )}

        {festivals.length > 0 && (
          <ul className="space-y-3">
            {festivals.map((festival) => (
              <li
                key={festival.id}
                className="flex items-center justify-between p-4 bg-warm border border-light rounded-lg"
              >
                <div>
                  <p className="font-sans text-sm text-ink font-medium">{festival.name}</p>
                  {festival.location_label && (
                    <p className="font-sans text-xs text-mid mt-0.5">{festival.location_label}</p>
                  )}
                  {festival.start_date && festival.end_date && (
                    <p className="font-sans text-xs text-mid">
                      {formatDateRange(festival.start_date, festival.end_date)}
                    </p>
                  )}
                </div>
                <Link
                  href={`/applications/apply/${festival.id}`}
                  className="font-sans text-sm bg-amber text-ink font-medium px-4 py-2 rounded-lg hover:opacity-90 transition-opacity"
                >
                  Apply
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
