'use client'

import type { components } from '@render/api-client'

type Application = components['schemas']['Application']
type ApplicationArtist = components['schemas']['ApplicationArtist']

interface Props {
  applications: Application[]
  festivalName: string
  roundOpen: boolean       // Phase 3 wires this; pass `true` until then
  onSelect: (app: Application) => void
}

function initials(name: string): string {
  return name.split(' ').slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('')
}

function isScored(app: Application): boolean {
  return app.my_score != null
}

export function ReviewerQueue({ applications, festivalName, roundOpen, onSelect }: Props) {
  const toScore = applications.filter(a => !isScored(a))
  const scored = applications.filter(isScored)
  const total = applications.length
  const done = scored.length
  const pct = total > 0 ? Math.round((done / total) * 100) : 0

  return (
    <div className="max-w-2xl">
      <div className={`rounded-lg px-5 py-3 mb-6 text-sm font-sans ${roundOpen ? 'bg-ink text-offwhite' : 'bg-warm text-mid border border-light'}`}>
        {roundOpen
          ? <>⏳ Review round is <span className="text-amber font-bold">open</span> — score each artist. The organiser closes it when ready.</>
          : <>Review round is <span className="font-bold">closed</span> — scoring is read-only.</>}
      </div>

      <h1 className="font-serif text-4xl text-ink mb-1">{festivalName}</h1>
      <p className="font-mono text-xs text-mid uppercase tracking-widest mb-2">You&apos;ve scored {done} of {total}</p>
      <div className="h-2 bg-warm rounded-full overflow-hidden mb-8">
        <div className="h-full bg-amber" style={{ width: `${pct}%` }} />
      </div>

      {toScore.length > 0 && (
        <>
          <h2 className="font-mono text-xs text-mid uppercase tracking-widest mb-2">To score ({toScore.length})</h2>
          <ul className="space-y-2 mb-8">
            {toScore.map(app => (
              <ReviewerRow key={app.id} app={app} onSelect={onSelect} scored={false} disabled={!roundOpen} />
            ))}
          </ul>
        </>
      )}

      {scored.length > 0 && (
        <>
          <h2 className="font-mono text-xs text-mid uppercase tracking-widest mb-2">Scored ({scored.length})</h2>
          <ul className="space-y-2">
            {scored.map(app => (
              <ReviewerRow key={app.id} app={app} onSelect={onSelect} scored disabled={!roundOpen} />
            ))}
          </ul>
        </>
      )}

      {total === 0 && (
        <p className="font-sans text-sm text-mid">No applications to review yet.</p>
      )}
    </div>
  )
}

function ReviewerRow({ app, onSelect, scored, disabled }: {
  app: Application; onSelect: (a: Application) => void; scored: boolean; disabled: boolean
}) {
  const artist = app.artist as ApplicationArtist | undefined
  const name = artist?.display_name ?? 'Unknown Artist'
  const tags = (artist?.medium_tags ?? []).slice(0, 2)

  return (
    <li className={`flex items-center gap-3 p-3 rounded-lg border ${scored ? 'bg-warm border-light' : 'bg-white border-light'}`}>
      <div className="w-10 h-10 rounded-full bg-clay flex items-center justify-center text-offwhite font-bold text-xs flex-shrink-0">
        {initials(name)}
      </div>
      <div className="min-w-0">
        <div className="font-sans font-semibold text-ink text-sm truncate">{name}</div>
        {tags.length > 0 && (
          <div className="font-mono text-mid uppercase tracking-wider" style={{ fontSize: '9px' }}>{tags.join(' · ')}</div>
        )}
      </div>
      <div className="ml-auto flex items-center gap-3 flex-shrink-0">
        {scored
          ? <>
              <span className="font-mono text-amber text-xs">★ {app.my_score}</span>
              <button onClick={() => onSelect(app)} className="font-mono text-mid text-xs underline disabled:opacity-50" disabled={disabled}>edit</button>
            </>
          : <button onClick={() => onSelect(app)} className="font-sans text-xs font-semibold bg-amber text-ink px-3.5 py-2 rounded-lg hover:opacity-90 disabled:opacity-50" disabled={disabled}>Score →</button>}
      </div>
    </li>
  )
}
