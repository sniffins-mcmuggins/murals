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

interface ReviewCriterion {
  id: string
  label: string
  min: number
  max: number
}

interface Props {
  application: Application | null
  formFields: FormField[]
  festivalId: string
  onClose: () => void
  onStage: (id: string, decision: string | null) => void
  onScore: (id: string, score: number, criterionId?: string) => void
  isReviewer: boolean
  isPending: boolean
  criteria: ReviewCriterion[]
  isReleased: boolean
  decisionsLocked?: boolean
}

function initials(name: string): string {
  return name.split(' ').slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('')
}

export function ApplicationSlideOver({
  application, formFields, festivalId, onClose,
  onStage, onScore, isReviewer, isPending, criteria, isReleased, decisionsLocked,
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

          {/* Staged decision selector — owner only, pre-release, round not open */}
          {!isReviewer && !isReleased && !decisionsLocked && (
            <div>
              <h3 className="font-mono text-xs text-mid uppercase tracking-widest mb-2">Decision</h3>
              <div className="flex gap-2 flex-wrap">
                {(['accept', 'waitlist', 'decline'] as const).map(decision => {
                  const isActive = application.staged_decision === decision
                  const styles: Record<string, string> = {
                    accept: isActive ? 'bg-green-100 border-green-400 text-green-800' : 'border-light text-mid hover:border-green-300',
                    waitlist: isActive ? 'bg-amber/20 border-amber text-ink' : 'border-light text-mid hover:border-amber',
                    decline: isActive ? 'bg-red-100 border-red-400 text-clay' : 'border-light text-mid hover:border-red-300',
                  }
                  return (
                    <button
                      key={decision}
                      onClick={() => onStage(id, isActive ? null : decision)}
                      disabled={isPending}
                      className={`font-sans text-xs border px-3 py-1.5 rounded-lg capitalize transition-colors disabled:opacity-50 ${styles[decision]}`}
                    >
                      {decision === 'accept' ? '✓ Accept' : decision === 'waitlist' ? '~ Waitlist' : '✗ Decline'}
                    </button>
                  )
                })}
              </div>
              {application.staged_decision && (
                <button
                  onClick={() => onStage(id, null)}
                  disabled={isPending}
                  className="font-mono text-xs text-mid hover:text-ink mt-1 disabled:opacity-50"
                >
                  Unstage
                </button>
              )}
            </div>
          )}

          {/* Post-release status badge — owner only */}
          {!isReviewer && isReleased && (
            <div>
              <h3 className="font-mono text-xs text-mid uppercase tracking-widest mb-2">Decision</h3>
              <span className={`font-mono text-xs uppercase tracking-widest px-2 py-1 rounded ${
                application.status === 'accepted' ? 'bg-green-100 text-green-800' :
                application.status === 'waitlisted' ? 'bg-amber/20 text-ink' :
                application.status === 'declined' ? 'bg-red-100 text-clay' :
                'bg-warm text-mid'
              }`}>
                {application.status}
              </span>
            </div>
          )}

          {/* Score control */}
          <div>
            <h3 className="font-mono text-xs text-mid uppercase tracking-widest mb-2">Your Score</h3>
            {criteria.length > 0 ? (
              <div className="space-y-4">
                {criteria.map(c => {
                  const cs = (application.criterion_scores ?? []).find(
                    s => s.criterion_id === c.id
                  )
                  const myCs = cs?.my_score ?? null
                  return (
                    <div key={c.id}>
                      <p className="font-sans text-xs text-mid mb-1">{c.label}</p>
                      <div className="flex gap-1 mb-0.5">
                        {Array.from({ length: c.max }, (_, i) => i + 1).map(n => (
                          <button
                            type="button"
                            key={n}
                            aria-label={`Score ${c.label} ${n}`}
                            onClick={() => onScore(id, n, c.id)}
                            className={`text-xl leading-none ${(myCs ?? 0) >= n ? 'text-amber' : 'text-light hover:text-mid'}`}
                          >★</button>
                        ))}
                      </div>
                      <p className="font-sans text-xs text-mid">
                        {myCs != null ? `${myCs} / ${c.max} · click to change` : 'Not yet scored'}
                      </p>
                    </div>
                  )
                })}
              </div>
            ) : (
              <>
                <div className="flex gap-1 mb-1">
                  {[1, 2, 3, 4, 5].map(n => (
                    <button
                      type="button"
                      key={n}
                      aria-label={`Score ${n}`}
                      onClick={() => onScore(id, n)}
                      className={`text-2xl leading-none ${(myScore ?? 0) >= n ? 'text-amber' : 'text-light hover:text-mid'}`}
                    >★</button>
                  ))}
                </div>
                <p className="font-sans text-xs text-mid">
                  {myScore != null ? `${myScore} / 5 · click to change` : 'Not yet scored'}
                </p>
              </>
            )}
          </div>

          {/* Panel average — only shown once scored */}
          {showAvg && (
            <div>
              <h3 className="font-mono text-xs text-mid uppercase tracking-widest mb-1">Panel average</h3>
              <p className="font-sans text-sm text-ink mb-2">
                ★ {avgScore?.toFixed(1)}
                <span className="text-mid ml-1">from {scoreCount} {scoreCount === 1 ? 'reviewer' : 'reviewers'}</span>
              </p>
              {criteria.length > 0 && (
                <div className="space-y-1">
                  {(application.criterion_scores ?? []).map(cs => (
                    <p key={cs.criterion_id} className="font-sans text-xs text-mid">
                      {cs.label}
                      {cs.avg_score != null && (
                        <span className="ml-2 text-ink">★ {cs.avg_score.toFixed(1)}</span>
                      )}
                    </p>
                  ))}
                </div>
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
          {!isReviewer && (
            <ApplicationNotes
              festivalId={festivalId}
              applicationId={id}
              notes={notes}
            />
          )}
        </div>
      </div>
    </>
  )
}
