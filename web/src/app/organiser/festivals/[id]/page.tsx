'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { apiClient } from '@/lib/api'
import { ReviewersSection } from './ReviewersSection'
import { SpotAssignmentSummary } from './SpotAssignmentSummary'
import type { components } from '@render/api-client'

type Festival = components['schemas']['Festival']

type Props = { params: Promise<{ id: string }> }

function AnonymousReviewSection({ festivalId }: { festivalId: string }) {
  const queryClient = useQueryClient()

  const formQuery = useQuery({
    queryKey: ['festival-form', festivalId],
    queryFn: async () => {
      const res = await apiClient.GET('/festivals/{festivalID}/form', {
        params: { path: { festivalID: festivalId } },
      })
      if (res.error) return null
      return res.data ?? null
    },
  })

  const patchMutation = useMutation({
    mutationFn: async (anonymousReview: boolean) => {
      const res = await apiClient.PATCH('/festivals/{festivalID}/form', {
        params: { path: { festivalID: festivalId } },
        body: { anonymous_review: anonymousReview },
      })
      if (res.error) throw new Error('Failed to update')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['festival-form', festivalId] }),
  })

  if (formQuery.isLoading || formQuery.data == null) return null

  return (
    <div className="p-5 bg-warm border border-light rounded-lg mb-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-serif text-xl text-ink mb-1">Anonymous review</h2>
          <p className="font-sans text-sm text-mid">
            Reviewers see only the work and answers. Artist name, avatar, and location are hidden until they&apos;ve scored.
          </p>
        </div>
        <label className="flex items-center gap-2 cursor-pointer flex-shrink-0 mt-1">
          <input
            type="checkbox"
            checked={formQuery.data.anonymous_review ?? false}
            onChange={e => patchMutation.mutate(e.target.checked)}
            disabled={patchMutation.isPending}
            className="w-4 h-4 accent-amber"
          />
          <span className="font-sans text-sm text-mid">
            {formQuery.data.anonymous_review ? 'On' : 'Off'}
          </span>
        </label>
      </div>
    </div>
  )
}

interface ReviewCriterion { id: string; label: string; min: number; max: number }
interface CriterionInput  { id?: string; label: string; min: number; max: number }

function CriteriaSection({ festivalId }: { festivalId: string }) {
  const queryClient = useQueryClient()
  const [newLabel, setNewLabel] = useState('')
  const [newMax, setNewMax] = useState(5)

  const formQuery = useQuery({
    queryKey: ['festival-form', festivalId],
    queryFn: async () => {
      const res = await apiClient.GET('/festivals/{festivalID}/form', {
        params: { path: { festivalID: festivalId } },
      })
      if (res.error) return null
      return res.data ?? null
    },
  })

  const patchMutation = useMutation({
    mutationFn: async (criteria: CriterionInput[]) => {
      const res = await apiClient.PATCH('/festivals/{festivalID}/form', {
        params: { path: { festivalID: festivalId } },
        body: { review_criteria: criteria },
      })
      if (res.error) throw new Error('Failed to update criteria')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['festival-form', festivalId] }),
  })

  if (formQuery.isLoading || formQuery.data == null) return null

  const criteria = ((formQuery.data as { review_criteria?: ReviewCriterion[] }).review_criteria ?? [])

  const handleAdd = () => {
    const label = newLabel.trim()
    if (!label) return
    // Send existing criteria WITH their IDs (stable), new one without an id.
    const updated: CriterionInput[] = [
      ...criteria.map(c => ({ id: c.id, label: c.label, min: c.min, max: c.max })),
      { label, min: 1, max: newMax },
    ]
    patchMutation.mutate(updated)
    setNewLabel('')
    setNewMax(5)
  }

  const handleRemove = (id: string) => {
    const updated: CriterionInput[] = criteria
      .filter(c => c.id !== id)
      .map(c => ({ id: c.id, label: c.label, min: c.min, max: c.max }))
    patchMutation.mutate(updated)
  }

  return (
    <div className="p-5 bg-warm border border-light rounded-lg mb-6">
      <h2 className="font-serif text-xl text-ink mb-4">Scoring criteria</h2>
      {criteria.length === 0 && (
        <p className="font-sans text-sm text-mid mb-4">
          No criteria set. Reviewers score each application with a single 1–5 rating.
        </p>
      )}
      {criteria.length > 0 && (
        <ul className="space-y-2 mb-4">
          {criteria.map(c => (
            <li key={c.id} className="flex items-center gap-3">
              <span className="font-sans text-sm text-ink flex-1">{c.label}</span>
              <span className="font-mono text-xs text-mid">1–{c.max}</span>
              <button
                type="button"
                onClick={() => handleRemove(c.id)}
                disabled={patchMutation.isPending}
                className="font-sans text-xs text-clay hover:opacity-80 disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2 items-center">
        <input
          type="text"
          value={newLabel}
          onChange={e => setNewLabel(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
          placeholder="e.g. Artistic Quality"
          className="flex-1 border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite focus:outline-none focus:border-amber"
        />
        <select
          value={newMax}
          onChange={e => setNewMax(Number(e.target.value))}
          className="border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite focus:outline-none focus:border-amber"
        >
          {[3, 5, 7, 10].map(n => <option key={n} value={n}>1–{n}</option>)}
        </select>
        <button
          type="button"
          onClick={handleAdd}
          disabled={patchMutation.isPending || !newLabel.trim()}
          className="font-sans text-sm font-medium bg-amber text-ink px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </div>
  )
}

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
        <div className="flex items-center gap-4 mt-2">
          <Link
            href={`/organiser/festivals/${festivalId}/applications`}
            className="font-mono text-xs text-mid uppercase tracking-widest hover:text-ink transition-colors"
          >
            View applications
          </Link>
          <span className="font-mono text-xs text-mid uppercase tracking-wider">{festival.status}</span>
        </div>
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

      {/* Anonymous review */}
      <AnonymousReviewSection festivalId={festivalId} />

      {/* Scoring criteria */}
      <CriteriaSection festivalId={festivalId} />

      {/* Reviewers */}
      <ReviewersSection festivalId={festivalId} />

      {/* Spot assignment summary */}
      <SpotAssignmentSummary festivalId={festivalId} />

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
