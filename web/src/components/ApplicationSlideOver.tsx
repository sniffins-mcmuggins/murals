'use client'

import { useEffect } from 'react'
import { ApplicationNotes } from './ApplicationNotes'
import type { components } from '@render/api-client'

type Application = components['schemas']['Application']
type ApplicationArtist = components['schemas']['ApplicationArtist']
type ApplicationNote = components['schemas']['ApplicationNote']

interface FormField {
  id: string
  label: string
  type: string
  required: boolean
}

interface Props {
  application: Application | null
  formFields: FormField[]
  festivalId: string
  onClose: () => void
  onAccept: (id: string) => void
  onDecline: (id: string) => void
  onWaitlist: (id: string) => void
  onScore: (id: string, score: number) => void
  isReviewer: boolean
  isPending: boolean
}

const ACTION_TRANSITIONS: Record<string, string[]> = {
  submitted: ['accept', 'waitlist', 'decline'],
  accepted: ['decline'],
  waitlisted: ['accept', 'decline'],
  declined: [],
}

function initials(name: string): string {
  return name.split(' ').slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('')
}

export function ApplicationSlideOver({
  application, formFields, festivalId, onClose,
  onAccept, onDecline, onWaitlist, onScore, isReviewer, isPending,
}: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  if (!application) return null

  const artist = application.artist as ApplicationArtist | undefined
  const name = artist?.display_name ?? 'Unknown Artist'
  const answers = (application.answers ?? {}) as Record<string, string>
  const notes = (application.notes ?? []) as ApplicationNote[]
  const actions = ACTION_TRANSITIONS[application.status ?? ''] ?? []
  const id = application.id ?? ''
  const myScore = application.my_score
  const avgScore = application.avg_score
  const scoreCount = application.score_count ?? 0
  const showAvg = myScore != null && scoreCount > 0

  const labelFor = (fieldId: string): string =>
    formFields.find(f => f.id === fieldId)?.label ?? fieldId

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-ink/20 z-40"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 w-full max-w-lg bg-offwhite shadow-xl z-50 overflow-y-auto">
        <div className="p-6 space-y-6">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-clay flex items-center justify-center text-offwhite font-bold">
                {initials(name)}
              </div>
              <div>
                <h2 className="font-serif text-xl text-ink">{name}</h2>
                {artist?.location_label && (
                  <p className="font-sans text-sm text-mid">{artist.location_label}</p>
                )}
              </div>
            </div>
            <button onClick={onClose} className="font-sans text-mid hover:text-ink text-xl leading-none">✕</button>
          </div>

          {/* Medium tags */}
          {(artist?.medium_tags ?? []).length > 0 && (
            <div className="flex gap-1.5 flex-wrap">
              {(artist?.medium_tags ?? []).map(tag => (
                <span key={tag} className="font-mono text-xs text-mid bg-warm border border-light rounded px-2 py-0.5 uppercase tracking-wider">
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Actions — owner only */}
          {!isReviewer && actions.length > 0 && (
            <div className="flex gap-2">
              {actions.includes('accept') && (
                <button onClick={() => onAccept(id)} disabled={isPending}
                  className="font-sans text-sm font-semibold bg-amber text-ink px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50">
                  Accept
                </button>
              )}
              {actions.includes('waitlist') && (
                <button onClick={() => onWaitlist(id)} disabled={isPending}
                  className="font-sans text-sm text-mid border border-light px-4 py-2 rounded-lg hover:opacity-80 disabled:opacity-50">
                  Waitlist
                </button>
              )}
              {actions.includes('decline') && (
                <button onClick={() => onDecline(id)} disabled={isPending}
                  className="font-sans text-sm text-clay border border-clay/30 px-4 py-2 rounded-lg hover:opacity-80 disabled:opacity-50">
                  Decline
                </button>
              )}
            </div>
          )}

          {/* Score control */}
          <div>
            <h3 className="font-mono text-xs text-mid uppercase tracking-widest mb-2">Your Score</h3>
            <div className="flex gap-1 mb-1">
              {[1, 2, 3, 4, 5].map(n => (
                <button
                  type="button"
                  key={n}
                  aria-label={`Score ${n}`}
                  onClick={() => onScore(id, n)}
                  className={`text-2xl leading-none ${(myScore ?? 0) >= n ? 'text-amber' : 'text-light hover:text-mid'}`}
                >
                  ★
                </button>
              ))}
            </div>
            <p className="font-sans text-xs text-mid">
              {myScore != null ? `${myScore} / 5 · click to change` : 'Not yet scored'}
            </p>
          </div>

          {/* Panel average — only shown once scored */}
          {showAvg && (
            <div>
              <h3 className="font-mono text-xs text-mid uppercase tracking-widest mb-1">Panel average</h3>
              <p className="font-sans text-sm text-ink">
                ★ {avgScore?.toFixed(1)}
                <span className="text-mid ml-1">from {scoreCount} {scoreCount === 1 ? 'reviewer' : 'reviewers'}</span>
              </p>
            </div>
          )}

          {/* Application answers */}
          {Object.keys(answers).length > 0 && (
            <div>
              <h3 className="font-mono text-xs text-mid uppercase tracking-widest mb-3">Application</h3>
              <div className="space-y-4">
                {Object.entries(answers).map(([fieldId, value]) => (
                  <div key={fieldId}>
                    <p className="font-sans text-xs text-mid mb-1">{labelFor(fieldId)}</p>
                    <p className="font-sans text-sm text-ink">{value}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Notes */}
          <ApplicationNotes
            festivalId={festivalId}
            applicationId={id}
            notes={notes}
          />
        </div>
      </div>
    </>
  )
}
