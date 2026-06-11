'use client'

import { useState, useMemo, useEffect } from 'react'
import { DndContext, DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import Link from 'next/link'
import { formatDate } from '@/lib/dates'
import { ApplicationCard } from '@/components/ApplicationCard'
import { ApplicationSlideOver } from '@/components/ApplicationSlideOver'
import { KanbanColumn } from '@/components/KanbanColumn'
import { TriageMode } from '@/components/TriageMode'
import { ReviewerQueue } from '@/components/ReviewerQueue'
import { useApplicationReview, type Application } from './useApplicationReview'

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
  const [triageOpen, setTriageOpen] = useState(false)
  const [showReleaseModal, setShowReleaseModal] = useState(false)
  const [releaseConfirmed, setReleaseConfirmed] = useState(false)

  const {
    applicationsQuery,
    festivalQuery,
    reviewersQuery,
    isReviewer,
    setLocalApps,
    allApps,
    isReleased,
    releasedAt,
    reviewStatus,
    roundOpen,
    formFields,
    criteria,
    isPending,
    stageMutation,
    releaseMutation,
    patchMutation,
    scoreMutation,
    reorderMutation,
    openRoundMutation,
    closeRoundMutation,
  } = useApplicationReview(festivalId)

  // Keep the open slide-over pointed at the freshly-fetched copy of its app.
  useEffect(() => {
    if (!applicationsQuery.data) return
    setSelectedApp(prev => {
      if (!prev) return prev
      const fresh = applicationsQuery.data.find((a: Application) => a.id === prev.id)
      return fresh ?? prev
    })
  }, [applicationsQuery.data])

  const closeReleaseModal = () => {
    setShowReleaseModal(false)
    setReleaseConfirmed(false)
  }

  // The release mutation lives in the hook (it owns the cache invalidation);
  // closing the modal is UI state, so react to its success here.
  useEffect(() => {
    if (releaseMutation.isSuccess) closeReleaseModal()
  }, [releaseMutation.isSuccess])

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
  const submittedApps = allApps.filter(a => a.status === 'submitted')

  function handleTriageShortlist(id: string, shortlisted: boolean) {
    const app = allApps.find(a => a.id === id)
    patchMutation.mutate({ id, shortlisted, reviewFlag: app?.review_flag ?? false })
  }

  const sensors = useSensors(useSensor(PointerSensor))

  const handleDragEnd = (event: DragEndEvent) => {
    if (isReleased || roundOpen) return
    const { active, over } = event
    if (!over || active.id === over.id) return

    const appId = active.id as string
    const app = allApps.find(a => a.id === appId)
    if (!app) return

    const activeColumn = getColumn(app, isReleased)

    // Resolve the target column: over.id is either a column key or a card id.
    const overId = over.id as string
    let targetColumn: ColumnKey
    if (overId in COLUMN_META) {
      targetColumn = overId as ColumnKey
    } else {
      const overApp = allApps.find(a => a.id === overId)
      if (!overApp) return
      targetColumn = getColumn(overApp, isReleased)
    }

    // Same column AND dropped on a card → reorder within the column.
    if (activeColumn === targetColumn && !(overId in COLUMN_META)) {
      const colApps = columns[activeColumn]
      const oldIndex = colApps.findIndex(a => a.id === appId)
      const newIndex = colApps.findIndex(a => a.id === overId)
      if (oldIndex === -1 || newIndex === -1) return

      const reordered = arrayMove(colApps, oldIndex, newIndex)
      const reorderedIds = new Set(reordered.map(a => a.id))
      setLocalApps(prev => {
        const base = prev ?? allApps
        const others = base.filter(a => !reorderedIds.has(a.id))
        return [...others, ...reordered]
      })
      reorderMutation.mutate(reordered.map(a => a.id ?? ''))
      return
    }

    // Same column but dropped on empty background → no-op.
    if (activeColumn === targetColumn) return

    // Different column → stage a decision (or clear it).
    const decisionMap: Partial<Record<ColumnKey, string | null>> = {
      accept: 'accept', waitlist: 'waitlist', decline: 'decline',
      undecided: null, shortlisted: null,
    }
    stageMutation.mutate({
      appId,
      stagedDecision: decisionMap[targetColumn] ?? null,
      shortlisted: targetColumn === 'shortlisted',
      reviewFlag: app.review_flag ?? false,
    })
  }

  if (reviewersQuery.isLoading) {
    return <p className="font-sans text-mid text-sm">Loading…</p>
  }

  if (isReviewer) {
    const festName = (festivalQuery.data as { name?: string } | undefined)?.name ?? 'Festival'
    return (
      <div>
        <div className="mb-6">
          <Link href="/organiser/reviewing"
            className="font-mono text-xs text-mid uppercase tracking-widest hover:text-ink transition-colors">
            ← Reviewing
          </Link>
        </div>
        {applicationsQuery.isLoading
          ? <p className="font-sans text-mid text-sm">Loading…</p>
          : <ReviewerQueue
              applications={allApps}
              festivalName={festName}
              roundOpen={roundOpen}
              onSelect={setSelectedApp}
            />}
        <ApplicationSlideOver
          application={selectedApp}
          formFields={formFields}
          festivalId={festivalId}
          onClose={() => setSelectedApp(null)}
          onStage={() => {}}
          onScore={handleScore}
          isReviewer={true}
          isPending={isPending}
          criteria={criteria}
          isReleased={false}
        />
      </div>
    )
  }

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
            <div className="flex items-center gap-2">
              <button
                onClick={() => setTriageOpen(true)}
                disabled={submittedApps.length === 0}
                className="font-sans text-sm border border-light rounded-lg px-4 py-2 hover:border-amber disabled:opacity-40"
                data-testid="open-triage"
              >
                Triage
              </button>
              <button
                onClick={() => setShowReleaseModal(true)}
                disabled={submittedUndecided > 0 || stagedCount === 0}
                className="font-sans text-sm font-bold bg-amber text-ink px-5 py-2.5 rounded-lg hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Release {stagedCount > 0 ? `${stagedCount} ` : ''}decisions →
              </button>
            </div>
            {submittedUndecided > 0 && (
              <p className="font-mono text-xs text-mid">
                {submittedUndecided} still need a decision
              </p>
            )}
          </div>
        )}
      </div>

      {!isReviewer && !isReleased && (
        <div className="mb-6">
          {reviewStatus === 'not_started' && (
            <div className="flex items-center justify-between bg-warm border border-light rounded-lg px-5 py-3">
              <span className="font-sans text-sm text-mid">Optional: run a reviewer scoring round before making decisions.</span>
              <button
                onClick={() => openRoundMutation.mutate()}
                disabled={openRoundMutation.isPending}
                className="font-sans text-sm font-bold bg-ink text-offwhite px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50"
              >
                Open review round
              </button>
            </div>
          )}
          {roundOpen && (
            <div className="flex items-center justify-between bg-ink text-offwhite rounded-lg px-5 py-3">
              <span className="font-sans text-sm">⏳ Review round <span className="text-amber font-bold">open</span> — decisions are locked until you close it.</span>
              <button
                onClick={() => closeRoundMutation.mutate()}
                disabled={closeRoundMutation.isPending}
                className="font-sans text-sm font-bold bg-amber text-ink px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50"
              >
                Close round
              </button>
            </div>
          )}
          {reviewStatus === 'closed' && (
            <div className="bg-warm border border-light rounded-lg px-5 py-2">
              <span className="font-mono text-xs text-mid uppercase tracking-widest">Review round closed · scores final</span>
            </div>
          )}
        </div>
      )}

      {isReleased && releasedAt && (
        <div className="bg-ink text-offwhite rounded-lg px-5 py-3 mb-6 flex justify-between items-center">
          <div>
            <span className="font-sans text-sm font-bold text-amber">Decisions released</span>
            <span className="font-mono text-xs text-mid ml-3">
              {formatDate(releasedAt)}
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
                itemIds={columns[col].map(a => a.id ?? '')}
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
                    isDraggable={!isReleased && !isReviewer && !roundOpen}
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

      {triageOpen && (
        <TriageMode
          apps={submittedApps}
          formFields={formFields}
          detailOpen={!!selectedApp}
          onShortlist={handleTriageShortlist}
          onOpenDetail={setSelectedApp}
          onClose={() => setTriageOpen(false)}
        />
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
        decisionsLocked={roundOpen}
      />
    </div>
  )
}
