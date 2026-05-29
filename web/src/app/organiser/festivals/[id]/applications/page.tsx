'use client'

import { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import Link from 'next/link'
import { apiClient } from '@/lib/api'
import { ApplicationCard } from '@/components/ApplicationCard'
import { ApplicationSlideOver } from '@/components/ApplicationSlideOver'
import { useApplicationReorder } from '@/hooks/useApplicationReorder'
import type { components } from '@render/api-client'

type Application = components['schemas']['Application']

interface FormField {
  id: string
  label: string
  type: string
  required: boolean
}

type TabKey = 'pending' | 'shortlisted' | 'accepted' | 'waitlisted' | 'declined'

const TAB_LABELS: Record<TabKey, string> = {
  pending: 'Pending', shortlisted: 'Shortlisted', accepted: 'Accepted',
  waitlisted: 'Waitlisted', declined: 'Declined',
}

function filterTab(apps: Application[], tab: TabKey): Application[] {
  switch (tab) {
    case 'pending':     return apps.filter(a => a.status === 'submitted' && !a.shortlisted)
    case 'shortlisted': return apps.filter(a => a.status === 'submitted' && a.shortlisted)
    case 'accepted':    return apps.filter(a => a.status === 'accepted')
    case 'waitlisted':  return apps.filter(a => a.status === 'waitlisted')
    case 'declined':    return apps.filter(a => a.status === 'declined')
  }
}

// Sentinel distinguishes 403 (caller is a reviewer) from 200 with empty list (owner with no reviewers).
const REVIEWER_SENTINEL = 'REVIEWER' as const

type Props = { params: Promise<{ id: string }> }

export default function ApplicationsReviewPage({ params }: Props) {
  const [festivalId, setFestivalId] = useState<string | null>(null)
  if (!festivalId) {
    params.then(p => setFestivalId(p.id))
    return <div className="font-sans text-mid text-sm p-8">Loading…</div>
  }
  return <ApplicationsView festivalId={festivalId} />
}

function ApplicationsView({ festivalId }: { festivalId: string }) {
  const [activeTab, setActiveTab] = useState<TabKey>('pending')
  const [selectedApp, setSelectedApp] = useState<Application | null>(null)
  const [localApps, setLocalApps] = useState<Application[] | null>(null)
  const queryClient = useQueryClient()

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

  // Detect owner vs reviewer: a 403 on the reviewers endpoint means the caller is a reviewer.
  const reviewersQuery = useQuery({
    queryKey: ['festival-reviewers', festivalId],
    queryFn: async () => {
      const res = await apiClient.GET('/festivals/{festivalID}/reviewers', {
        params: { path: { festivalID: festivalId } },
      })
      if (res.response.status === 403) return REVIEWER_SENTINEL
      return res.data ?? []
    },
  })
  const isReviewer = reviewersQuery.data === REVIEWER_SENTINEL

  useEffect(() => {
    if (applicationsQuery.data) setLocalApps(applicationsQuery.data)
  }, [applicationsQuery.data])

  const formQuery = useQuery({
    queryKey: ['festival-form', festivalId],
    queryFn: async () => {
      const res = await apiClient.GET('/festivals/{festivalID}/form', {
        params: { path: { festivalID: festivalId } },
      })
      if (res.error) return { fields: [] }
      return res.data
    },
  })

  const allApps = localApps ?? applicationsQuery.data ?? []
  const tabApps = useMemo(() => filterTab(allApps, activeTab), [allApps, activeTab])

  const setTabApps = (updated: Application[]) => {
    setLocalApps(prev => {
      if (!prev) return updated
      const tabIds = new Set(tabApps.map(a => a.id))
      return [...prev.filter(a => !tabIds.has(a.id)), ...updated]
    })
  }

  const { handleDragEnd } = useApplicationReorder(
    festivalId, tabApps,
    activeTab === 'shortlisted' ? 'submitted' : activeTab,
    setTabApps,
  )

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['festival-applications', festivalId] })

  const acceptMutation = useMutation({
    mutationFn: async (applicationId: string) => {
      const res = await apiClient.POST('/festivals/{festivalID}/applications/{applicationID}/accept', {
        params: { path: { festivalID: festivalId, applicationID: applicationId } },
      })
      if (res.error) throw new Error('Accept failed')
    },
    onSuccess: () => { setSelectedApp(null); invalidate() },
  })

  const declineMutation = useMutation({
    mutationFn: async (applicationId: string) => {
      const res = await apiClient.POST('/festivals/{festivalID}/applications/{applicationID}/decline', {
        params: { path: { festivalID: festivalId, applicationID: applicationId } },
      })
      if (res.error) throw new Error('Decline failed')
    },
    onSuccess: () => { setSelectedApp(null); invalidate() },
  })

  const waitlistMutation = useMutation({
    mutationFn: async (applicationId: string) => {
      const res = await apiClient.POST('/festivals/{festivalID}/applications/{applicationID}/waitlist', {
        params: { path: { festivalID: festivalId, applicationID: applicationId } },
      })
      if (res.error) throw new Error('Waitlist failed')
    },
    onSuccess: () => { setSelectedApp(null); invalidate() },
  })

  const patchMutation = useMutation({
    mutationFn: async ({ id, shortlisted, reviewFlag }: { id: string; shortlisted: boolean; reviewFlag: boolean }) => {
      const res = await apiClient.PATCH('/festivals/{festivalID}/applications/{applicationID}', {
        params: { path: { festivalID: festivalId, applicationID: id } },
        body: { shortlisted, review_flag: reviewFlag },
      })
      if (res.error) throw new Error('Patch failed')
    },
    onSuccess: invalidate,
  })

  const scoreMutation = useMutation({
    mutationFn: async ({ applicationId, score }: { applicationId: string; score: number }) => {
      const res = await apiClient.PUT('/festivals/{festivalID}/applications/{applicationID}/score', {
        params: { path: { festivalID: festivalId, applicationID: applicationId } },
        body: { score },
      })
      if (res.error) throw new Error('Score failed')
    },
    onMutate: ({ applicationId, score }) => {
      const snapshot = localApps
      setLocalApps(prev => prev?.map(a =>
        a.id === applicationId ? { ...a, my_score: score } : a
      ) ?? null)
      return { snapshot }
    },
    onError: (_err, _vars, context) => {
      if (context?.snapshot !== undefined) setLocalApps(context.snapshot)
    },
    onSuccess: invalidate,
  })

  const handleScore = (applicationId: string, score: number) => {
    scoreMutation.mutate({ applicationId, score })
    // Also update the selected app in the slide-over optimistically
    if (selectedApp?.id === applicationId) {
      setSelectedApp(prev => prev ? { ...prev, my_score: score } : null)
    }
  }

  const isPending =
    acceptMutation.isPending || declineMutation.isPending ||
    waitlistMutation.isPending || patchMutation.isPending || scoreMutation.isPending

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const formFields: FormField[] = (formQuery.data as { fields?: FormField[] })?.fields ?? []

  const counts: Record<TabKey, number> = {
    pending: filterTab(allApps, 'pending').length,
    shortlisted: filterTab(allApps, 'shortlisted').length,
    accepted: filterTab(allApps, 'accepted').length,
    waitlisted: filterTab(allApps, 'waitlisted').length,
    declined: filterTab(allApps, 'declined').length,
  }

  const cardList = (
    <ul className="space-y-3">
      {tabApps.map(app => (
        <li key={app.id}>
          <ApplicationCard
            application={app}
            onSelect={setSelectedApp}
            onAccept={id => acceptMutation.mutate(id)}
            onDecline={id => declineMutation.mutate(id)}
            onWaitlist={id => waitlistMutation.mutate(id)}
            onToggleShortlist={(id, shortlisted, reviewFlag) =>
              patchMutation.mutate({ id, shortlisted: !shortlisted, reviewFlag })
            }
            onToggleReviewFlag={(id, shortlisted, reviewFlag) =>
              patchMutation.mutate({ id, shortlisted, reviewFlag: !reviewFlag })
            }
            onScore={handleScore}
            isReviewer={isReviewer}
            isPending={isPending}
          />
        </li>
      ))}
    </ul>
  )

  return (
    <div>
      <div className="mb-6">
        <Link href={`/organiser/festivals/${festivalId}`}
          className="font-mono text-xs text-mid uppercase tracking-widest hover:text-ink transition-colors">
          ← Festival
        </Link>
      </div>

      <h1 className="font-serif text-4xl text-ink mb-6">Applications</h1>

      {applicationsQuery.isError && (
        <p role="alert" className="font-sans text-sm text-clay mb-4">Failed to load applications.</p>
      )}

      {/* Tabs */}
      <div className="flex gap-0 border-b border-light mb-6 overflow-x-auto">
        {(Object.keys(TAB_LABELS) as TabKey[]).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`font-sans text-sm px-4 py-2 whitespace-nowrap border-b-2 -mb-px transition-colors ${
              activeTab === tab ? 'border-amber text-ink font-semibold' : 'border-transparent text-mid hover:text-ink'
            }`}
          >
            {TAB_LABELS[tab]}
            <span className="ml-1.5 font-mono text-xs">({counts[tab]})</span>
          </button>
        ))}
      </div>

      {applicationsQuery.isLoading && <p className="font-sans text-mid text-sm">Loading…</p>}

      {!applicationsQuery.isLoading && tabApps.length === 0 && (
        <p className="font-sans text-mid text-sm">No applications here.</p>
      )}

      {tabApps.length > 0 && !reviewersQuery.isLoading && (
        isReviewer ? cardList : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={tabApps.map(a => a.id ?? '')} strategy={verticalListSortingStrategy}>
              {cardList}
            </SortableContext>
          </DndContext>
        )
      )}

      <ApplicationSlideOver
        application={selectedApp}
        formFields={formFields}
        festivalId={festivalId}
        onClose={() => setSelectedApp(null)}
        onAccept={id => acceptMutation.mutate(id)}
        onDecline={id => declineMutation.mutate(id)}
        onWaitlist={id => waitlistMutation.mutate(id)}
        onScore={handleScore}
        isReviewer={isReviewer}
        isPending={isPending}
      />
    </div>
  )
}
