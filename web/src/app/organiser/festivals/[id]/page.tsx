'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { apiClient } from '@/lib/api'
import type { components } from '@render/api-client'

type Festival = components['schemas']['Festival']

type Props = { params: Promise<{ id: string }> }

export default function FestivalEditPage({ params }: Props) {
  const [festivalId, setFestivalId] = useState<string | null>(null)
  const queryClient = useQueryClient()

  if (!festivalId) {
    params.then(p => setFestivalId(p.id))
    return <div className="font-sans text-mid text-sm p-8">Loading…</div>
  }

  return <FestivalDetail festivalId={festivalId} queryClient={queryClient} />
}

function FestivalDetail({
  festivalId,
  queryClient,
}: {
  festivalId: string
  queryClient: ReturnType<typeof useQueryClient>
}) {
  const router = useRouter()
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const festivalQuery = useQuery({
    queryKey: ['festival', festivalId],
    queryFn: async () => {
      const res = await apiClient.GET('/festivals/{festivalID}', {
        params: { path: { festivalID: festivalId } },
      })
      if (res.error) throw new Error('Failed to load festival')
      return res.data as Festival
    },
  })

  const [form, setForm] = useState<{
    name: string
    slug: string
    description: string
    locationLabel: string
    startDate: string
    endDate: string
  } | null>(null)

  // Initialise form once festival data loads
  if (festivalQuery.data && form === null) {
    const f = festivalQuery.data
    setForm({
      name: f.name ?? '',
      slug: f.slug ?? '',
      description: f.description ?? '',
      locationLabel: f.location_label ?? '',
      startDate: f.start_date ?? '',
      endDate: f.end_date ?? '',
    })
  }

  const updateMutation = useMutation({
    mutationFn: async (data: NonNullable<typeof form>) => {
      const res = await apiClient.PATCH('/festivals/{festivalID}', {
        params: { path: { festivalID: festivalId } },
        body: {
          name: data.name,
          slug: data.slug,
          ...(data.description ? { description: data.description } : {}),
          ...(data.locationLabel ? { locationLabel: data.locationLabel } : {}),
          ...(data.startDate ? { startDate: data.startDate } : { startDate: null }),
          ...(data.endDate ? { endDate: data.endDate } : { endDate: null }),
        },
      })
      if (res.error) throw new Error('Failed to save festival')
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['festival', festivalId] })
      queryClient.invalidateQueries({ queryKey: ['organiser-festivals'] })
      setSaveError(null)
    },
    onError: (err: Error) => setSaveError(err.message),
  })

  const statusMutation = useMutation({
    mutationFn: async (newStatus: 'open' | 'draft') => {
      const res = await apiClient.PATCH('/festivals/{festivalID}', {
        params: { path: { festivalID: festivalId } },
        body: { status: newStatus },
      })
      if (res.error) throw new Error('Failed to update status')
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['festival', festivalId] })
      queryClient.invalidateQueries({ queryKey: ['organiser-festivals'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.DELETE('/festivals/{festivalID}', {
        params: { path: { festivalID: festivalId } },
      })
      if (res.error) throw new Error('Failed to delete festival')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organiser-festivals'] })
      router.push('/organiser/festivals')
    },
  })

  if (festivalQuery.isLoading || form === null) {
    return <div className="font-sans text-mid text-sm">Loading…</div>
  }

  if (!festivalQuery.data) {
    return <div className="font-sans text-mid text-sm">Festival not found.</div>
  }

  const festival = festivalQuery.data
  const isLive = festival.status === 'open' || festival.status === 'live'

  return (
    <div>
      <div className="mb-6">
        <Link
          href="/organiser/festivals"
          className="font-mono text-xs text-mid uppercase tracking-widest hover:text-ink transition-colors"
        >
          ← Festivals
        </Link>
      </div>

      <div className="flex items-start justify-between mb-6">
        <h1 className="font-serif text-4xl text-ink">{festival.name}</h1>
        <span className="font-mono text-xs text-mid uppercase tracking-wider mt-2">{festival.status}</span>
      </div>

      {/* Edit form */}
      <div className="p-5 bg-warm border border-light rounded-lg mb-6">
        <h2 className="font-serif text-xl text-ink mb-4">Edit festival</h2>
        <div className="space-y-3 max-w-sm">
          <input
            type="text"
            placeholder="Name *"
            value={form.name}
            onChange={e => setForm(f => f ? { ...f, name: e.target.value } : f)}
            className="w-full border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite focus:outline-none focus:border-amber"
          />
          <input
            type="text"
            placeholder="Slug *"
            value={form.slug}
            onChange={e => setForm(f => f ? { ...f, slug: e.target.value } : f)}
            className="w-full border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite focus:outline-none focus:border-amber"
          />
          <textarea
            placeholder="Description"
            value={form.description}
            onChange={e => setForm(f => f ? { ...f, description: e.target.value } : f)}
            rows={2}
            className="w-full border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite focus:outline-none focus:border-amber resize-none"
          />
          <input
            type="text"
            placeholder="Location (e.g. Cheltenham, UK)"
            value={form.locationLabel}
            onChange={e => setForm(f => f ? { ...f, locationLabel: e.target.value } : f)}
            className="w-full border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite focus:outline-none focus:border-amber"
          />
          <div className="flex gap-2">
            <input
              type="date"
              value={form.startDate}
              onChange={e => setForm(f => f ? { ...f, startDate: e.target.value } : f)}
              className="flex-1 border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite focus:outline-none focus:border-amber"
            />
            <input
              type="date"
              value={form.endDate}
              onChange={e => setForm(f => f ? { ...f, endDate: e.target.value } : f)}
              className="flex-1 border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite focus:outline-none focus:border-amber"
            />
          </div>
          {saveError && <p role="alert" className="font-sans text-sm text-clay">{saveError}</p>}
          <button
            onClick={() => updateMutation.mutate(form)}
            disabled={!form.name.trim() || !form.slug.trim() || updateMutation.isPending}
            className="font-sans text-sm bg-amber text-ink font-medium px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50"
          >
            {updateMutation.isPending ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>

      {/* Publish / unpublish */}
      <div className="p-5 bg-warm border border-light rounded-lg mb-6">
        <h2 className="font-serif text-xl text-ink mb-2">Visibility</h2>
        <p className="font-sans text-sm text-mid mb-4">
          {isLive
            ? 'This festival is currently visible to artists. Unpublish to hide it.'
            : 'This festival is a draft. Publish to make it visible to artists.'}
        </p>
        {isLive ? (
          <button
            onClick={() => statusMutation.mutate('draft')}
            disabled={statusMutation.isPending}
            className="font-sans text-sm border border-light text-mid hover:text-ink px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
          >
            {statusMutation.isPending ? 'Updating…' : 'Unpublish'}
          </button>
        ) : (
          <button
            onClick={() => statusMutation.mutate('open')}
            disabled={statusMutation.isPending}
            className="font-sans text-sm bg-amber text-ink font-medium px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50"
          >
            {statusMutation.isPending ? 'Updating…' : 'Publish'}
          </button>
        )}
      </div>

      {/* Danger zone */}
      <div className="p-5 border border-light rounded-lg">
        <h2 className="font-serif text-xl text-ink mb-2">Danger zone</h2>
        {!deleteConfirm ? (
          <button
            onClick={() => setDeleteConfirm(true)}
            className="font-sans text-sm text-clay hover:opacity-80 transition-opacity"
          >
            Delete festival
          </button>
        ) : (
          <div className="space-y-3">
            <p className="font-sans text-sm text-ink">Are you sure? This cannot be undone.</p>
            <div className="flex gap-2">
              <button
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                className="font-sans text-sm bg-clay text-offwhite font-medium px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50"
              >
                {deleteMutation.isPending ? 'Deleting…' : 'Yes, delete'}
              </button>
              <button
                onClick={() => setDeleteConfirm(false)}
                className="font-sans text-sm text-mid hover:text-ink px-4 py-2"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
