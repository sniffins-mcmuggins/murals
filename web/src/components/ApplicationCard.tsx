'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { components } from '@render/api-client'

type Application = components['schemas']['Application']
type ApplicationArtist = components['schemas']['ApplicationArtist']

interface ReviewCriterion {
  id: string
  label: string
  min: number
  max: number
}

interface Props {
  application: Application
  onSelect: (app: Application) => void
  onAccept: (id: string) => void
  onDecline: (id: string) => void
  onWaitlist: (id: string) => void
  onToggleShortlist: (id: string, current: boolean, reviewFlag: boolean) => void
  onToggleReviewFlag: (id: string, shortlisted: boolean, current: boolean) => void
  onScore: (id: string, score: number) => void
  isReviewer: boolean
  isPending: boolean
  criteria: ReviewCriterion[]
}

function initials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('')
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

const ACTION_TRANSITIONS: Record<string, string[]> = {
  submitted: ['accept', 'waitlist', 'decline'],
  accepted: ['decline'],
  waitlisted: ['accept', 'decline'],
  declined: [],
}

function StarControl({ appId, myScore, onScore }: { appId: string; myScore: number | null | undefined; onScore: (id: string, score: number) => void }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(n => (
        <button
          type="button"
          key={n}
          aria-label={`Score ${n}`}
          onClick={e => { e.stopPropagation(); onScore(appId, n) }}
          className={`text-lg leading-none ${(myScore ?? 0) >= n ? 'text-amber' : 'text-light hover:text-mid'}`}
        >
          ★
        </button>
      ))}
    </div>
  )
}

export function ApplicationCard({
  application,
  onSelect,
  onAccept,
  onDecline,
  onWaitlist,
  onToggleShortlist,
  onToggleReviewFlag,
  onScore,
  isReviewer,
  isPending,
  criteria,
}: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: application.id ?? '' })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const artist = application.artist as ApplicationArtist | undefined
  const isAnonymous = application.identity_hidden === true
  const name = isAnonymous ? 'Anonymous artist' : (artist?.display_name ?? 'Unknown Artist')
  const tags = artist?.medium_tags ?? []
  const actions = ACTION_TRANSITIONS[application.status ?? ''] ?? []
  const id = application.id ?? ''
  const myScore = application.my_score
  const avgScore = application.avg_score
  const scoreCount = application.score_count ?? 0
  const showAvg = myScore != null && scoreCount > 0

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-start gap-3 p-4 bg-warm border border-light rounded-lg"
    >
      {/* Drag handle — owner only */}
      {!isReviewer && (
        <button
          {...attributes}
          {...listeners}
          className="mt-1 cursor-grab text-light hover:text-mid touch-none flex-shrink-0"
          aria-label="Drag to reorder"
          tabIndex={-1}
        >
          ⠿
        </button>
      )}

      {/* Avatar */}
      <div
        className="w-10 h-10 rounded-full bg-clay flex items-center justify-center text-offwhite font-sans font-bold text-sm flex-shrink-0 cursor-pointer"
        onClick={() => onSelect(application)}
      >
        {isAnonymous ? '?' : initials(name)}
      </div>

      {/* Main content */}
      <div
        className="flex-1 min-w-0 cursor-pointer"
        onClick={() => onSelect(application)}
      >
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="font-sans font-semibold text-ink text-sm">{name}</span>
          {!isAnonymous && artist?.location_label && (
            <span className="font-sans text-xs text-mid">{artist.location_label}</span>
          )}
          {isAnonymous ? (
            <span className="font-sans text-xs text-mid italic">Score to reveal identity</span>
          ) : (
            <span className="font-sans text-xs text-mid">· Applied {formatDate(application.created_at ?? '')}</span>
          )}
        </div>
        {tags.length > 0 && (
          <div className="flex gap-1 flex-wrap mt-1">
            {tags.slice(0, 3).map(tag => (
              <span
                key={tag}
                className="font-mono text-xs text-mid bg-white border border-light rounded px-1.5 py-0.5 uppercase tracking-wider"
              >
                {tag}
              </span>
            ))}
            {tags.length > 3 && (
              <span className="font-mono text-xs text-mid px-1">+{tags.length - 3}</span>
            )}
          </div>
        )}
      </div>

      {/* Right slot: differs by role */}
      <div className="flex flex-col gap-2 items-end flex-shrink-0">
        {isReviewer ? (
          /* Reviewer: star control (no rubric) or Score button (rubric) + avg once scored */
          <>
            {showAvg && (
              <span className="font-mono text-xs text-mid">★ {avgScore?.toFixed(1)} · {scoreCount}</span>
            )}
            {criteria.length > 0 ? (
              <button
                type="button"
                onClick={e => { e.stopPropagation(); onSelect(application) }}
                className="font-sans text-xs text-mid border border-light px-2 py-1 rounded hover:border-amber hover:text-ink transition-colors"
              >
                {myScore != null ? 'Edit score' : 'Score →'}
              </button>
            ) : (
              <StarControl appId={id} myScore={myScore} onScore={onScore} />
            )}
          </>
        ) : (
          /* Owner: flags + actions + avg badge */
          <>
            <div className="flex items-center gap-2">
              {showAvg && (
                <span className="font-mono text-xs text-mid">★ {avgScore?.toFixed(1)} · {scoreCount}</span>
              )}
              <div className="flex gap-1">
                <button
                  onClick={() => onToggleShortlist(id, application.shortlisted ?? false, application.review_flag ?? false)}
                  disabled={isPending}
                  className={`text-base leading-none ${application.shortlisted ? 'text-amber' : 'text-light hover:text-mid'} disabled:opacity-50`}
                  title={application.shortlisted ? 'Remove shortlist' : 'Shortlist'}
                >
                  ⭐
                </button>
                <button
                  onClick={() => onToggleReviewFlag(id, application.shortlisted ?? false, application.review_flag ?? false)}
                  disabled={isPending}
                  className={`text-base leading-none ${application.review_flag ? 'text-clay' : 'text-light hover:text-mid'} disabled:opacity-50`}
                  title={application.review_flag ? 'Remove review flag' : 'Flag for review'}
                >
                  🚩
                </button>
              </div>
            </div>
            <div className="flex gap-1.5">
              {actions.includes('accept') && (
                <button onClick={() => onAccept(id)} disabled={isPending}
                  className="font-sans text-xs font-semibold bg-amber text-ink px-3 py-1.5 rounded-lg hover:opacity-90 disabled:opacity-50">
                  Accept
                </button>
              )}
              {actions.includes('waitlist') && (
                <button onClick={() => onWaitlist(id)} disabled={isPending}
                  className="font-sans text-xs text-mid border border-light px-3 py-1.5 rounded-lg hover:opacity-80 disabled:opacity-50">
                  Waitlist
                </button>
              )}
              {actions.includes('decline') && (
                <button onClick={() => onDecline(id)} disabled={isPending}
                  className="font-sans text-xs text-clay border border-clay/30 px-3 py-1.5 rounded-lg hover:opacity-80 disabled:opacity-50">
                  Decline
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
