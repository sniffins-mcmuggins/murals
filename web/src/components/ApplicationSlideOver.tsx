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
  application,
  formFields,
  festivalId,
  onClose,
  onAccept,
  onDecline,
  onWaitlist,
  isPending,
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

          {/* Actions */}
          {actions.length > 0 && (
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
