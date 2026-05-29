'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { components } from '@render/api-client'

type Reviewer = components['schemas']['ReviewerResponse']

function ReviewerRow({ reviewer, festivalId }: { reviewer: Reviewer; festivalId: string }) {
  const queryClient = useQueryClient()
  const [removeError, setRemoveError] = useState<string | null>(null)

  const removeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.DELETE('/festivals/{festivalID}/reviewers/{userID}', {
        params: { path: { festivalID: festivalId, userID: reviewer.user_id } },
      })
      if (res.error) throw new Error('Remove failed')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['festival-reviewers', festivalId] }),
    onError: () => setRemoveError('Failed to remove reviewer.'),
  })

  return (
    <li className="flex items-center gap-3">
      <span className="font-sans text-sm text-ink flex-1">{reviewer.email}</span>
      <span className={`font-mono text-xs px-2 py-0.5 rounded-full border ${
        reviewer.accepted_at
          ? 'text-ink bg-amber/20 border-amber/40'
          : 'text-mid bg-warm border-light'
      }`}>
        {reviewer.accepted_at ? 'accepted' : 'pending'}
      </span>
      {removeError && <span className="font-sans text-xs text-clay">{removeError}</span>}
      <button
        type="button"
        onClick={() => removeMutation.mutate()}
        disabled={removeMutation.isPending}
        className="font-sans text-xs text-clay hover:opacity-80 disabled:opacity-50"
      >
        {removeMutation.isPending ? 'Removing…' : 'Remove'}
      </button>
    </li>
  )
}

export function ReviewersSection({ festivalId }: { festivalId: string }) {
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteError, setInviteError] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const reviewersQuery = useQuery({
    queryKey: ['festival-reviewers', festivalId],
    queryFn: async () => {
      const res = await apiClient.GET('/festivals/{festivalID}/reviewers', {
        params: { path: { festivalID: festivalId } },
      })
      if (res.error) return [] as Reviewer[]
      return (res.data ?? []) as Reviewer[]
    },
  })

  const inviteMutation = useMutation({
    mutationFn: async (email: string) => {
      const res = await apiClient.POST('/festivals/{festivalID}/reviewers', {
        params: { path: { festivalID: festivalId } },
        body: { email },
      })
      if (res.error) throw new Error('Invite failed')
    },
    onSuccess: () => {
      setInviteEmail('')
      setInviteError(null)
      queryClient.invalidateQueries({ queryKey: ['festival-reviewers', festivalId] })
    },
    onError: () => setInviteError('Failed to send invite. Check the email address.'),
  })

  const handleInvite = () => {
    const email = inviteEmail.trim()
    if (!email || !email.includes('@')) return
    setInviteError(null)
    inviteMutation.mutate(email)
  }

  const reviewers = (reviewersQuery.data ?? []) as Reviewer[]

  return (
    <div className="p-5 bg-warm border border-light rounded-lg mb-6">
      <h2 className="font-serif text-xl text-ink mb-4">Reviewers</h2>

      {!reviewersQuery.isLoading && reviewers.length === 0 && (
        <p className="font-sans text-sm text-mid mb-4">
          No reviewers yet. Invite someone by email to score applications.
        </p>
      )}

      {!reviewersQuery.isLoading && reviewers.length > 0 && (
        <ul className="space-y-2 mb-4">
          {reviewers.map(r => (
            <ReviewerRow key={r.user_id} reviewer={r} festivalId={festivalId} />
          ))}
        </ul>
      )}

      <div className="flex gap-2 max-w-sm">
        <input
          type="email"
          value={inviteEmail}
          onChange={e => setInviteEmail(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleInvite()}
          placeholder="email@example.com"
          className="flex-1 border border-light rounded-lg px-3 py-2 font-sans text-sm text-ink bg-offwhite focus:outline-none focus:border-amber"
        />
        <button
          type="button"
          onClick={handleInvite}
          disabled={inviteMutation.isPending}
          className="font-sans text-sm font-medium bg-amber text-ink px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50"
        >
          {inviteMutation.isPending ? 'Inviting…' : 'Invite'}
        </button>
      </div>
      {inviteError && <p role="alert" className="font-sans text-xs text-clay mt-2">{inviteError}</p>}
    </div>
  )
}
