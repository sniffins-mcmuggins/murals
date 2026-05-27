'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { apiClient } from '@/lib/api'
import type { components } from '@render/api-client'

type Festival = components['schemas']['Festival']
type FestivalStatus = components['schemas']['FestivalStatus']

const STATUS_COLORS: Record<FestivalStatus, string> = {
  draft: 'text-mid',
  open: 'text-amber',
  live: 'text-clay',
  archived: 'text-mid',
}

export default function FestivalsPage() {
  const queryClient = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({
    name: '',
    slug: '',
    description: '',
    locationLabel: '',
    startDate: '',
    endDate: '',
  })
  const [createError, setCreateError] = useState<string | null>(null)

  const festivalsQuery = useQuery({
    queryKey: ['organiser-festivals'],
    queryFn: async () => {
      const res = await apiClient.GET('/festivals', {})
      return res.data ?? []
    },
  })

  const createMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const res = await apiClient.POST('/festivals', {
        body: {
          name: data.name,
          slug: data.slug,
          ...(data.description ? { description: data.description } : {}),
          ...(data.locationLabel ? { locationLabel: data.locationLabel } : {}),
          ...(data.startDate ? { startDate: data.startDate } : {}),
          ...(data.endDate ? { endDate: data.endDate } : {}),
        },
      })
      if (res.error) throw new Error('Failed to create festival')
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organiser-festivals'] })
      setCreating(false)
      setForm({ name: '', slug: '', description: '', locationLabel: '', startDate: '', endDate: '' })
      setCreateError(null)
    },
    onError: (err: Error) => setCreateError(err.message),
  })

  const festivals: Festival[] = (festivalsQuery.data ?? []) as Festival[]

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-serif text-4xl text-ink">Festivals</h1>
        <button
          onClick={() => setCreating(true)}
          className="font-sans text-sm bg-amber text-ink font-medium px-4 py-2 rounded-lg hover:opacity-90 transition-opacity"
        >
          New festival
        </button>
      </div>

      {creating && (
        <div className="mb-6 p-5 bg-warm border border-light rounded-lg">
          <h2 className="font-serif text-xl text-ink mb-4">New festival</h2>
          <div className="space-y-3 max-w-sm">
            <input
              type="text"
              placeholder="Name *"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="w-full border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite focus:outline-none focus:border-amber"
            />
            <input
              type="text"
              placeholder="Slug * (e.g. cpf-2027)"
              value={form.slug}
              onChange={e => setForm(f => ({ ...f, slug: e.target.value }))}
              className="w-full border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite focus:outline-none focus:border-amber"
            />
            <textarea
              placeholder="Description"
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              rows={2}
              className="w-full border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite focus:outline-none focus:border-amber resize-none"
            />
            <input
              type="text"
              placeholder="Location (e.g. Cheltenham, UK)"
              value={form.locationLabel}
              onChange={e => setForm(f => ({ ...f, locationLabel: e.target.value }))}
              className="w-full border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite focus:outline-none focus:border-amber"
            />
            <div className="flex gap-2">
              <input
                type="date"
                placeholder="Start date"
                value={form.startDate}
                onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))}
                className="flex-1 border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite focus:outline-none focus:border-amber"
              />
              <input
                type="date"
                placeholder="End date"
                value={form.endDate}
                onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))}
                className="flex-1 border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite focus:outline-none focus:border-amber"
              />
            </div>
            {createError && <p role="alert" className="font-sans text-sm text-clay">{createError}</p>}
            <div className="flex gap-2">
              <button
                onClick={() => createMutation.mutate(form)}
                disabled={!form.name.trim() || !form.slug.trim() || createMutation.isPending}
                className="font-sans text-sm bg-amber text-ink font-medium px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50"
              >
                {createMutation.isPending ? 'Creating…' : 'Create'}
              </button>
              <button
                onClick={() => { setCreating(false); setCreateError(null) }}
                className="font-sans text-sm text-mid hover:text-ink px-4 py-2"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {festivalsQuery.isLoading && <p className="font-sans text-mid text-sm">Loading…</p>}

      {festivals.length === 0 && !festivalsQuery.isLoading && (
        <p className="font-sans text-mid">No festivals yet. Create one to get started.</p>
      )}

      <ul className="space-y-3">
        {festivals.map((f) => (
          <li key={f.id} className="flex items-center justify-between p-4 bg-warm border border-light rounded-lg">
            <div>
              <Link
                href={`/organiser/festivals/${f.id}`}
                className="font-serif text-xl text-ink hover:text-amber transition-colors"
              >
                {f.name}
              </Link>
              {f.location_label && (
                <p className="font-sans text-sm text-mid mt-0.5">{f.location_label}</p>
              )}
              {f.start_date && (
                <p className="font-sans text-xs text-mid mt-0.5">{f.start_date}{f.end_date ? ` – ${f.end_date}` : ''}</p>
              )}
              <span className={`font-mono text-xs uppercase tracking-wider mt-1 inline-block ${STATUS_COLORS[f.status as FestivalStatus] ?? 'text-mid'}`}>
                {f.status}
              </span>
            </div>
            <Link
              href={`/organiser/festivals/${f.id}`}
              className="font-sans text-xs text-mid hover:text-ink transition-colors ml-4"
            >
              Edit
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
