'use client'

import { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { DndContext, DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import Link from 'next/link'
import { apiClient } from '@/lib/api'
import { ApplicationCard } from '@/components/ApplicationCard'
import { ApplicationSlideOver } from '@/components/ApplicationSlideOver'
import { KanbanColumn } from '@/components/KanbanColumn'
import type { components } from '@render/api-client'

type Application = components['schemas']['Application']

interface FormField { id: string; label: string; type: string; required: boolean }
interface ReviewCriterion { id: string; label: string; min: number; max: number }

type ColumnKey = 'undecided' | 'shortlisted' | 'accept' | 'waitlist' | 'decline'

const COLUMN_META: Record<ColumnKey, { label: string; headerClass: string; borderColor: string }> = {
  undecided:   { label: 'Undecided',    headerClass: 'text-mid',         borderColor: 'border-light' },
  shortlisted: { label: '⭐ Shortlisted', headerClass: 'text-amber',      borderColor: 'border-amber' },
  accept:      { label: '✓ Accept',     headerClass: 'text-green-700',   borderColor: 'border-green-500' },
  waitlist:    { label: '~ Waitlist',   headerClass: 'text-amber',       borderColor: 'border-amber' },
  decline:     { label: '✗ Decline',    headerClass: 'text-clay',        borderColor: 'border-clay' },
}

function getColumn(app: Application, isReleased: boolean): ColumnKey {
  if (isReleased) {
    if (app.status === 'accepted') return 'accept'
    if (app.status === 'waitlisted') return 'waitlist'
    if (app.status === 'declined') return 'decline'
    return app.shortlisted ? 'shortlisted' : 'undecided'
  }
  if (app.staged_decision === 'accept') return 'accept'
  if (app.staged_decision === 'waitlist') return 'waitlist'
  if (app.staged_decision === 'decline') return 'decline'
  if (app.shortlisted) return 'shortlisted'
  return 'undecided'
}

const REVIEWER_SENTINEL = 'REVIEWER' as const

type Props = { params: Promise<{ id: string }> }

export default function ApplicationsReviewPage({ params }: Props) {
  const [festivalId, setFestivalId] = useState<string | null>(null)
  if (!festivalId) {
    params.then(p => setFestivalId(p.id))
    return <div className="font-sans text-mid text-sm p-8">Loading…</div>
  }
  return <KanbanView festivalId={festivalId} />
}

function KanbanView({ festivalId }: { festivalId: string }) {
  const [selectedApp, setSelectedApp] = useState<Application | null>(null)
  const [localApps, setLocalApps] = useState<Application[] | null>(null)
  const [showReleaseModal, setShowReleaseModal] = useState(false)
  const [releaseConfirmed, setReleaseConfirmed] = useState(false)
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

  const festivalQuery = useQuery({
    queryKey: ['festival', festivalId],
    queryFn: async () => {
      const res = await apiClient.GET('/festivals/{festivalID}', {
        params: { path: { festivalID: festivalId } },
      })
      if (res.error) throw new Error('Failed to load festival')
      return res.data
    },
  })

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

  useEffect(() => {
    if (applicationsQuery.data) setLocalApps(applicationsQuery.data)
  }, [applicationsQuery.data])

  useEffect(() => {
    if (!applicationsQuery.data) return
    setSelectedApp(prev => {
      if (!prev) return prev
      const fresh = applicationsQuery.data.find((a: Application) => a.id === prev.id)
      return fresh ?? prev
    })
  }, [applicationsQuery.data])

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['festival-applications', festivalId] })

  const stageMutation = useMutation({
    mutationFn: async ({ appId, stagedDecision, shortlisted, reviewFlag }: {
      appId: string
      stagedDecision: string | null
      shortlisted: boolean
      reviewFlag: boolean
    }) => {
      const res = await apiClient.PATCH('/festivals/{festivalID}/applications/{applicationID}', {
        params: { path: { festivalID: festivalId, applicationID: appId } },
        body: {
          shortlisted,
          review_flag: reviewFlag,
          staged_decision: stagedDecision as 'accept' | 'waitlist' | 'decline' | null | undefined,
        },
      })
      if (res.error) throw new Error('Stage failed')
    },
    onMutate: ({ appId, stagedDecision, shortlisted }) => {
      const snapshot = localApps
      setLocalApps(prev => prev?.map(a =>
        a.id === appId ? { ...a, staged_decision: stagedDecision as Application['staged_decision'], shortlisted } : a
      ) ?? null)
      return { snapshot }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.snapshot !== undefined) setLocalApps(ctx.snapshot)
    },
    onSuccess: invalidate,
  })

  const releaseMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.POST('/festivals/{festivalID}/applications/release-decisions', {
        params: { path: { festivalID: festivalId } },
      })
      if (res.error) throw new Error('Release failed')
      return res.data
    },
    onSuccess: () => {
      setShowReleaseModal(false)
      setReleaseConfirmed(false)
      queryClient.invalidateQueries({ queryKey: ['festival-applications', festivalId] })
      queryClient.invalidateQueries({ queryKey: ['festival', festivalId] })
    },
  })

  const closeReleaseModal = () => {
    setShowReleaseModal(false)
    setReleaseConfirmed(false)
  }

  const patchMutation = useMutation({
    mutationFn: async ({ id, shortlisted, reviewFlag }: { id: string; shortlisted: boolean; reviewFlag: boolean }) => {
      const app = (localApps ?? []).find(a => a.id === id)
      const res = await apiClient.PATCH('/festivals/{festivalID}/applications/{applicationID}', {
        params: { path: { festivalID: festivalId, applicationID: id } },
        body: {
          shortlisted,
          review_flag: reviewFlag,
          staged_decision: (app?.staged_decision ?? null) as 'accept' | 'waitlist' | 'decline' | null | undefined,
        },
      })
      if (res.error) throw new Error('Patch failed')
    },
    onMutate: ({ id, shortlisted }) => {
      const snapshot = localApps
      setLocalApps(prev => prev?.map(a => a.id === id ? { ...a, shortlisted } : a) ?? null)
      return { snapshot }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.snapshot !== undefined) setLocalApps(ctx.snapshot)
    },
    onSuccess: invalidate,
  })

  const scoreMutation = useMutation({
    mutationFn: async ({ applicationId, score, criterionId }: {
      applicationId: string; score: number; criterionId: string
    }) => {
      const res = await apiClient.PUT('/festivals/{festivalID}/applications/{applicationID}/score', {
        params: { path: { festivalID: festivalId, applicationID: applicationId } },
        body: criterionId === 'overall' ? { score } : { score, criterion_id: criterionId },
      })
      if (res.error) throw new Error('Score failed')
    },
    onMutate: ({ applicationId, score, criterionId }) => {
      const snapshot = localApps
      setLocalApps(prev => prev?.map(a => {
        if (a.id !== applicationId) return a
        if (criterionId === 'overall') return { ...a, my_score: score }
        const criterionScores = (a.criterion_scores ?? []).map(
          (cs: NonNullable<Application['criterion_scores']>[number]) =>
            cs.criterion_id === criterionId ? { ...cs, my_score: score } : cs
        )
        const scored = criterionScores.filter(
          (cs: NonNullable<Application['criterion_scores']>[number]) => cs.my_score != null
        )
        const mean = scored.length > 0
          ? Math.round(scored.reduce((s: number, cs: NonNullable<Application['criterion_scores']>[number]) => s + (cs.my_score ?? 0), 0) / scored.length)
          : a.my_score
        return { ...a, criterion_scores: criterionScores, my_score: mean }
      }) ?? null)
      return { snapshot }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.snapshot !== undefined) setLocalApps(ctx.snapshot)
    },
    onSuccess: invalidate,
  })

  const handleScore = (applicationId: string, score: number, criterionId = 'overall') => {
    scoreMutation.mutate({ applicationId, score, criterionId })
    if (selectedApp?.id === applicationId) {
      if (criterionId === 'overall') {
        setSelectedApp(prev => prev ? { ...prev, my_score: score } : null)
      } else {
        setSelectedApp(prev => {
          if (!prev) return null
          const criterionScores = (prev.criterion_scores ?? []).map(
            (cs: NonNullable<Application['criterion_scores']>[number]) =>
              cs.criterion_id === criterionId ? { ...cs, my_score: score } : cs
          )
          const scored = criterionScores.filter(
            (cs: NonNullable<Application['criterion_scores']>[number]) => cs.my_score != null
          )
          const mean = scored.length > 0
            ? Math.round(scored.reduce((s: number, cs: NonNullable<Application['criterion_scores']>[number]) => s + (cs.my_score ?? 0), 0) / scored.length)
            : prev.my_score
          return { ...prev, criterion_scores: criterionScores, my_score: mean }
        })
      }
    }
  }

  const allApps = useMemo(
    () => localApps ?? applicationsQuery.data ?? [],
    [localApps, applicationsQuery.data],
  )
  const festivalData = festivalQuery.data as { decisions_released_at?: string | null } | undefined
  const isReleased = !!(festivalData?.decisions_released_at)

  const columns = useMemo<Record<ColumnKey, Application[]>>(() => {
    const result: Record<ColumnKey, Application[]> = {
      undecided: [], shortlisted: [], accept: [], waitlist: [], decline: [],
    }
    for (const app of allApps) {
      result[getColumn(app, isReleased)].push(app)
    }
    return result
  }, [allApps, isReleased])

  const stagedCount = allApps.filter(a => a.staged_decision != null).length
  const submittedUndecided = allApps.filter(a => a.status === 'submitted' && !a.staged_decision).length

  const sensors = useSensors(useSensor(PointerSensor))

  const handleDragEnd = (event: DragEndEvent) => {
    if (isReleased) return
    const { active, over } = event
    if (!over || active.id === over.id) return

    const appId = active.id as string
    const targetColumn = over.id as ColumnKey
    const app = allApps.find(a => a.id === appId)
    if (!app) return

    const decisionMap: Partial<Record<ColumnKey, string | null>> = {
      accept: 'accept', waitlist: 'waitlist', decline: 'decline',
      undecided: null, shortlisted: null,
    }
    if (!(targetColumn in decisionMap)) return

    stageMutation.mutate({
      appId,
      stagedDecision: decisionMap[targetColumn] ?? null,
      shortlisted: targetColumn === 'shortlisted',
      reviewFlag: app.review_flag ?? false,
    })
  }

  const formFields: FormField[] = (formQuery.data as { fields?: FormField[] })?.fields ?? []
  const criteria: ReviewCriterion[] = (formQuery.data as { review_criteria?: ReviewCriterion[] })?.review_criteria ?? []
  const isPending = stageMutation.isPending || patchMutation.isPending || scoreMutation.isPending

  const releasedAt = festivalData?.decisions_released_at

  return (
    <div>
      <div className="mb-6">
        <Link href={`/organiser/festivals/${festivalId}`}
          className="font-mono text-xs text-mid uppercase tracking-widest hover:text-ink transition-colors">
          ← Festival
        </Link>
      </div>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="font-serif text-4xl text-ink">Applications</h1>
          {!isReleased && (
            <p className="font-mono text-xs text-mid mt-1 uppercase tracking-widest">
              {allApps.length} total · {stagedCount} staged
            </p>
          )}
        </div>
        {!isReviewer && !isReleased && (
          <div className="flex flex-col items-end gap-1">
            <button
              onClick={() => setShowReleaseModal(true)}
              disabled={submittedUndecided > 0 || stagedCount === 0}
              className="font-sans text-sm font-bold bg-amber text-ink px-5 py-2.5 rounded-lg hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Release {stagedCount > 0 ? `${stagedCount} ` : ''}decisions →
            </button>
            {submittedUndecided > 0 && (
              <p className="font-mono text-xs text-mid">
                {submittedUndecided} still need a decision
              </p>
            )}
          </div>
        )}
      </div>

      {isReleased && releasedAt && (
        <div className="bg-ink text-offwhite rounded-lg px-5 py-3 mb-6 flex justify-between items-center">
          <div>
            <span className="font-sans text-sm font-bold text-amber">Decisions released</span>
            <span className="font-mono text-xs text-mid ml-3">
              {new Date(releasedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
              {' · '}artists notified by email
            </span>
          </div>
          <span className="font-mono text-xs text-mid uppercase tracking-widest">read-only</span>
        </div>
      )}

      {applicationsQuery.isError && (
        <p role="alert" className="font-sans text-sm text-clay mb-4">Failed to load applications.</p>
      )}

      {applicationsQuery.isLoading ? (
        <p className="font-sans text-mid text-sm">Loading…</p>
      ) : (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <div className="grid grid-cols-5 gap-4">
            {(Object.keys(COLUMN_META) as ColumnKey[]).map(col => (
              <KanbanColumn
                key={col}
                id={col}
                label={COLUMN_META[col].label}
                count={columns[col].length}
                headerClass={COLUMN_META[col].headerClass}
                borderColor={COLUMN_META[col].borderColor}
                isReleased={isReleased}
              >
                {columns[col].map(app => (
                  <ApplicationCard
                    key={app.id}
                    application={app}
                    onSelect={setSelectedApp}
                    onToggleShortlist={(id, shortlisted, reviewFlag) =>
                      patchMutation.mutate({ id, shortlisted: !shortlisted, reviewFlag })
                    }
                    onScore={handleScore}
                    isReviewer={isReviewer}
                    isPending={isPending}
                    criteria={criteria}
                    isDraggable={!isReleased && !isReviewer}
                    columnKey={col}
                    isReleased={isReleased}
                  />
                ))}
                {columns[col].length === 0 && (
                  <div className="border border-dashed border-light rounded-lg p-3 text-center">
                    <span className="font-mono text-xs text-light">empty</span>
                  </div>
                )}
              </KanbanColumn>
            ))}
          </div>
        </DndContext>
      )}

      {showReleaseModal && (
        <div className="fixed inset-0 bg-ink/40 z-50 flex items-center justify-center">
          <div className="bg-offwhite rounded-xl p-8 max-w-sm w-full mx-4 shadow-xl">
            <h2 className="font-serif text-2xl text-ink mb-2">Release decisions?</h2>
            <p className="font-sans text-sm text-mid mb-5">
              Decisions will be sent to {stagedCount} {stagedCount === 1 ? 'artist' : 'artists'} simultaneously. This cannot be undone.
            </p>
            <label className="flex items-start gap-3 cursor-pointer mb-6">
              <input
                type="checkbox"
                checked={releaseConfirmed}
                onChange={e => setReleaseConfirmed(e.target.checked)}
                className="mt-0.5 accent-amber h-4 w-4 flex-shrink-0"
              />
              <span className="font-sans text-sm text-ink">
                I understand all {stagedCount} {stagedCount === 1 ? 'artist' : 'artists'} will be notified at the same time and this cannot be undone
              </span>
            </label>
            <div className="flex gap-3 justify-end">
              <button
                onClick={closeReleaseModal}
                className="font-sans text-sm text-mid border border-light px-4 py-2 rounded-lg hover:opacity-80"
              >
                Cancel
              </button>
              <button
                onClick={() => releaseMutation.mutate()}
                disabled={!releaseConfirmed || releaseMutation.isPending}
                className="font-sans text-sm font-bold bg-amber text-ink px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {releaseMutation.isPending ? 'Sending…' : 'Yes, release'}
              </button>
            </div>
            {releaseMutation.isError && (
              <p className="font-sans text-xs text-clay mt-3">Failed to release. Please try again.</p>
            )}
          </div>
        </div>
      )}

      <ApplicationSlideOver
        application={selectedApp}
        formFields={formFields}
        festivalId={festivalId}
        onClose={() => setSelectedApp(null)}
        onStage={(id, decision) => {
          const app = allApps.find(a => a.id === id)
          if (!app) return
          stageMutation.mutate({
            appId: id,
            stagedDecision: decision,
            shortlisted: app.shortlisted ?? false,
            reviewFlag: app.review_flag ?? false,
          })
        }}
        onScore={handleScore}
        isReviewer={isReviewer}
        isPending={isPending}
        criteria={criteria}
        isReleased={isReleased}
      />
    </div>
  )
}
