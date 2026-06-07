'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { SocialIcon, SOCIAL_PLATFORMS } from './SocialIcon'
import { parseEmbed } from '@/lib/embeds'
import type { components } from '@render/api-client'

type Application = components['schemas']['Application']
type ApplicationArtist = components['schemas']['ApplicationArtist']

interface ReviewCriterion { id: string; label: string; min: number; max: number }

interface Props {
  application: Application
  onSelect: (app: Application) => void
  onToggleShortlist: (id: string, current: boolean, reviewFlag: boolean) => void
  onScore: (id: string, score: number, criterionId?: string) => void
  isReviewer: boolean
  isPending: boolean
  criteria: ReviewCriterion[]
  isDraggable: boolean
  columnKey: string
  isReleased: boolean
}

function initials(name: string): string {
  return name.split(' ').slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('')
}

export function ApplicationCard({
  application, onSelect, onToggleShortlist, onScore,
  isReviewer, isPending, criteria, isDraggable, columnKey, isReleased,
}: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: application.id ?? '', disabled: !isDraggable })

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const artist = application.artist as ApplicationArtist | undefined
  const name = artist?.display_name ?? 'Unknown Artist'
  const tags = artist?.medium_tags ?? []
  const id = application.id ?? ''
  const myScore = application.my_score
  const avgScore = application.avg_score
  const scoreCount = application.score_count ?? 0
  const showAvg = avgScore != null && scoreCount > 0

  const answers = (application.answers ?? {}) as Record<string, string>
  const firstEmbed = Object.values(answers).map(v => v && parseEmbed(v)).find(Boolean) || null

  // Compact social icons, surfaced live from the artist profile (E28 M1). Fixed-size
  // icons (not truncated text) so they never collapse to zero width on a dense card.
  const socialLinks = (artist?.social_links ?? {}) as Record<string, string>
  const presentSocials = SOCIAL_PLATFORMS.filter(p => (socialLinks[p.key] ?? '').trim()).slice(0, 4)

  const isDecisionColumn = ['accept', 'waitlist', 'decline'].includes(columnKey)
  const cardBg = isDecisionColumn
    ? columnKey === 'accept'   ? 'bg-green-50 border-green-200'
    : columnKey === 'waitlist' ? 'bg-amber/10 border-amber/30'
    :                            'bg-red-50 border-red-200'
    : 'bg-warm border-light'

  const dimmed = isReleased && !isDecisionColumn

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-start gap-2 p-3 ${cardBg} border rounded-lg cursor-pointer ${dimmed ? 'opacity-60' : ''}`}
      onClick={() => onSelect(application)}
    >
      {isDraggable && (
        <button
          {...attributes}
          {...listeners}
          className="mt-0.5 cursor-grab text-light hover:text-mid touch-none flex-shrink-0 text-sm"
          aria-label="Drag to reorder"
          tabIndex={-1}
          onClick={e => e.stopPropagation()}
        >
          ⠿
        </button>
      )}

      {artist?.avatar_s3_key
        ? <img
            src={artist.avatar_s3_key}
            alt={name}
            className="w-8 h-8 rounded-full object-cover flex-shrink-0"
          />
        : <div className="w-8 h-8 rounded-full bg-clay flex items-center justify-center text-offwhite font-bold text-xs flex-shrink-0">
            {initials(name)}
          </div>}

      <div className="flex-1 min-w-0">
        <div className="font-sans font-semibold text-ink text-xs truncate">{name}</div>
        {tags.length > 0 && (
          <div className="flex gap-1 flex-wrap mt-0.5">
            {tags.slice(0, 2).map(tag => (
              <span key={tag} className="font-mono text-mid bg-white border border-light rounded px-1 py-0.5 uppercase tracking-wider" style={{ fontSize: '9px' }}>
                {tag}
              </span>
            ))}
          </div>
        )}
        {presentSocials.length > 0 && (
          <div className="flex items-center gap-1.5 mt-1" data-testid="card-socials">
            {presentSocials.map(p => (
              <a
                key={p.key}
                href={socialLinks[p.key]}
                target="_blank"
                rel="noopener noreferrer"
                title={p.label}
                aria-label={p.label}
                onClick={e => e.stopPropagation()}
                className="text-mid hover:text-ink transition-colors flex-shrink-0"
              >
                <SocialIcon platform={p.key} className="w-3.5 h-3.5" />
              </a>
            ))}
          </div>
        )}
        {firstEmbed && (
          <span data-testid="embed-chip" className="font-mono text-[10px] uppercase tracking-widest bg-warm border border-light rounded px-1.5 py-0.5 text-mid">
            {firstEmbed.provider === 'sketchfab' ? '◆ 3D' : '▶ Video'}
          </span>
        )}
        {isReleased && isDecisionColumn && (
          <div className="font-mono text-mid mt-0.5" style={{ fontSize: '9px' }}>
            Notified ✓
          </div>
        )}
      </div>

      <div className="flex flex-col items-end gap-1 flex-shrink-0">
        {showAvg && (
          <span className="font-mono text-mid" style={{ fontSize: '9px' }}>★ {avgScore?.toFixed(1)}</span>
        )}
        {!isReviewer && !isReleased && (
          <button
            onClick={e => {
              e.stopPropagation()
              onToggleShortlist(id, application.shortlisted ?? false, application.review_flag ?? false)
            }}
            disabled={isPending}
            className={`text-sm leading-none ${application.shortlisted ? 'text-amber' : 'text-light hover:text-mid'} disabled:opacity-50`}
            title={application.shortlisted ? 'Remove shortlist' : 'Shortlist'}
          >
            ⭐
          </button>
        )}
        {isReviewer && (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onSelect(application) }}
            className="font-sans border border-light rounded px-1.5 py-0.5 hover:border-amber hover:text-ink transition-colors text-mid"
            style={{ fontSize: '9px' }}
          >
            {myScore != null ? 'Edit score' : 'Score'}
          </button>
        )}
      </div>
    </div>
  )
}
