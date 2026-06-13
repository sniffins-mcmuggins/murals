'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { components } from '@render/api-client'

export type Application = components['schemas']['Application']
export interface FormField { id: string; label: string; type: string; required: boolean }
export interface ReviewCriterion { id: string; label: string; min: number; max: number }

const REVIEWER_SENTINEL = 'REVIEWER' as const

/**
 * Owns the entire data layer of the organiser applications board: the four
 * reads (applications, festival, reviewers, form), the optimistic `localApps`
 * mirror, and the seven mutations (stage, release, patch, score, reorder,
 * open/close round). The page consumes this and stays layout + UI handlers.
 *
 * Optimistic updates write through `setLocalApps`; the page reads `allApps`
 * (localApps with the server response as fallback). Each mutating call
 * snapshots `localApps` in `onMutate` and restores it in `onError`.
 */
export function useApplicationReview(festivalId: string) {
  const queryClient = useQueryClient()
  const [localApps, setLocalApps] = useState<Application[] | null>(null)

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

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['festival-applications', festivalId] })

  const stageMutation = useMutation({
    mutationFn: async ({ appId, decision, shortlisted, reviewFlag }: {
      appId: string
      decision: string
      shortlisted: boolean
      reviewFlag: boolean
    }) => {
      const res = await apiClient.PATCH('/festivals/{festivalID}/applications/{applicationID}', {
        params: { path: { festivalID: festivalId, applicationID: appId } },
        body: {
          shortlisted,
          review_flag: reviewFlag,
          decision: decision as 'undecided' | 'accept' | 'waitlist' | 'decline',
        },
      })
      if (res.error) throw new Error('Stage failed')
    },
    onMutate: ({ appId, decision, shortlisted }) => {
      const snapshot = localApps
      setLocalApps(prev => prev?.map(a =>
        a.id === appId ? { ...a, decision: decision as Application['decision'], shortlisted } : a
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
      queryClient.invalidateQueries({ queryKey: ['festival-applications', festivalId] })
      queryClient.invalidateQueries({ queryKey: ['festival', festivalId] })
    },
  })

  const patchMutation = useMutation({
    mutationFn: async ({ id, shortlisted, reviewFlag }: { id: string; shortlisted: boolean; reviewFlag: boolean }) => {
      const app = (localApps ?? []).find(a => a.id === id)
      const res = await apiClient.PATCH('/festivals/{festivalID}/applications/{applicationID}', {
        params: { path: { festivalID: festivalId, applicationID: id } },
        body: {
          shortlisted,
          review_flag: reviewFlag,
          decision: (app?.decision ?? 'undecided') as 'undecided' | 'accept' | 'waitlist' | 'decline',
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

  const reorderMutation = useMutation({
    mutationFn: async ({ status, ids }: { status: string; ids: string[] }) => {
      const res = await apiClient.POST('/festivals/{festivalID}/applications/reorder', {
        params: { path: { festivalID: festivalId } },
        body: { status, ids },
      })
      if (res.error) throw new Error('Reorder failed')
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ['festival-applications', festivalId] })
    },
  })

  const openRoundMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.POST('/festivals/{festivalID}/review/open', {
        params: { path: { festivalID: festivalId } },
      })
      if (res.error) throw new Error('Open failed')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['festival', festivalId] }),
  })

  const closeRoundMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.POST('/festivals/{festivalID}/review/close', {
        params: { path: { festivalID: festivalId } },
      })
      if (res.error) throw new Error('Close failed')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['festival', festivalId] }),
  })

  const allApps = useMemo(
    () => localApps ?? applicationsQuery.data ?? [],
    [localApps, applicationsQuery.data],
  )

  const festivalData = festivalQuery.data as
    { review_status?: string; name?: string } | undefined
  // Release state now lives per-application: a festival is "released" once any
  // application has a released_at stamp.
  const isReleased = allApps.some(a => a.released_at != null)
  const releasedAt = allApps.find(a => a.released_at != null)?.released_at ?? null
  const reviewStatus = festivalData?.review_status ?? 'not_started'
  const roundOpen = reviewStatus === 'open'

  const formFields: FormField[] = (formQuery.data as { fields?: FormField[] })?.fields ?? []
  const criteria: ReviewCriterion[] =
    (formQuery.data as { review_criteria?: ReviewCriterion[] })?.review_criteria ?? []

  const isPending = stageMutation.isPending || patchMutation.isPending || scoreMutation.isPending

  return {
    // queries
    applicationsQuery,
    festivalQuery,
    reviewersQuery,
    isReviewer,
    // optimistic state
    localApps,
    setLocalApps,
    allApps,
    // derived festival/round state
    isReleased,
    releasedAt,
    reviewStatus,
    roundOpen,
    formFields,
    criteria,
    isPending,
    // mutations
    stageMutation,
    releaseMutation,
    patchMutation,
    scoreMutation,
    reorderMutation,
    openRoundMutation,
    closeRoundMutation,
  }
}
