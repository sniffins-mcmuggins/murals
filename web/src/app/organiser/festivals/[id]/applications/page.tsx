'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { apiClient } from '@/lib/api'
import type { components } from '@render/api-client'

type Application = components['schemas']['Application']

type Props = { params: Promise<{ id: string }> }

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

const STATUS_BADGE: Record<string, string> = {
  submitted: 'bg-amber/20 text-amber',
  accepted: 'bg-amber/30 text-ink',
  declined: 'bg-light text-mid',
}

export default function ApplicationsReviewPage({ params }: Props) {
  const [festivalId, setFestivalId] = useState<string | null>(null)
  const queryClient = useQueryClient()

  if (!festivalId) {
    params.then(p => setFestivalId(p.id))
    return <div className="font-sans text-mid text-sm p-8">Loading…</div>
  }

  return <ApplicationsList festivalId={festivalId} queryClient={queryClient} />
}

function ApplicationsList({
  festivalId,
  queryClient,
}: {
  festivalId: string
  queryClient: ReturnType<typeof useQueryClient>
}) {
  const applicationsQuery = useQuery({
    queryKey: ['festival-applications', festivalId],
    queryFn: async () => {
      const res = await apiClient.GET('/festivals/{festivalID}/applications', {
        params: { path: { festivalID: festivalId } },
      })
      if (res.error) throw new Error('Failed to load applications')
      return (res.data ?? []) as Application[]
    },
  })

  const acceptMutation = useMutation({
    mutationFn: async (applicationId: string) => {
      const res = await apiClient.POST(
        '/festivals/{festivalID}/applications/{applicationID}/accept',
        {
          params: { path: { festivalID: festivalId, applicationID: applicationId } },
        }
      )
      if (res.error) throw new Error('Failed to accept application')
      return res.data as Application
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['festival-applications', festivalId] })
    },
  })

  const declineMutation = useMutation({
    mutationFn: async (applicationId: string) => {
      const res = await apiClient.POST(
        '/festivals/{festivalID}/applications/{applicationID}/decline',
        {
          params: { path: { festivalID: festivalId, applicationID: applicationId } },
        }
      )
      if (res.error) throw new Error('Failed to decline application')
      return res.data as Application
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['festival-applications', festivalId] })
    },
  })

  const applications = applicationsQuery.data ?? []
  const isLoading = applicationsQuery.isLoading

  return (
    <div>
      <div className="mb-6">
        <Link
          href={`/organiser/festivals/${festivalId}`}
          className="font-mono text-xs text-mid uppercase tracking-widest hover:text-ink transition-colors"
        >
          ← Festival
        </Link>
      </div>

      <h1 className="font-serif text-4xl text-ink mb-8">Applications</h1>

      {isLoading && (
        <p className="font-sans text-mid text-sm">Loading…</p>
      )}

      {applicationsQuery.isError && (
        <p role="alert" className="font-sans text-sm text-clay">Failed to load applications.</p>
      )}

      {!isLoading && !applicationsQuery.isError && applications.length === 0 && (
        <p className="font-sans text-mid">No applications yet.</p>
      )}

      {!isLoading && !applicationsQuery.isError && applications.length > 0 && (
        <ul className="space-y-4">
          {applications.map(app => {
            const badgeClass = STATUS_BADGE[app.status ?? ''] ?? 'bg-light text-mid'
            const displayName = app.artist_id
              ? `Artist ${app.artist_id.slice(0, 8)}`
              : 'Applicant'
            const answersEntries = app.answers
              ? Object.entries(app.answers as Record<string, unknown>)
              : []

            return (
              <li
                key={app.id}
                className="p-5 bg-warm border border-light rounded-lg"
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="font-sans text-sm text-ink font-medium">{displayName}</p>
                    {app.created_at && (
                      <p className="font-sans text-xs text-mid mt-0.5">
                        Submitted {formatDate(app.created_at)}
                      </p>
                    )}
                  </div>
                  <span
                    className={`font-mono text-xs uppercase tracking-wider px-2 py-0.5 rounded ${badgeClass}`}
                  >
                    {app.status}
                  </span>
                </div>

                {answersEntries.length > 0 && (
                  <div className="mb-4 space-y-2">
                    {answersEntries.map(([label, value]) => (
                      <div key={label}>
                        <p className="font-sans text-xs text-mid">{label}</p>
                        <p className="font-sans text-sm text-ink">{String(value)}</p>
                      </div>
                    ))}
                  </div>
                )}

                {app.status === 'submitted' && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => app.id && acceptMutation.mutate(app.id)}
                      disabled={acceptMutation.isPending || declineMutation.isPending}
                      className="font-sans text-sm bg-amber text-ink font-medium px-4 py-1.5 rounded-lg hover:opacity-90 disabled:opacity-50"
                    >
                      Accept
                    </button>
                    <button
                      onClick={() => app.id && declineMutation.mutate(app.id)}
                      disabled={acceptMutation.isPending || declineMutation.isPending}
                      className="font-sans text-sm text-clay border border-clay/30 px-4 py-1.5 rounded-lg hover:opacity-80 disabled:opacity-50"
                    >
                      Decline
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
