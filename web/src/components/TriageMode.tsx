'use client'

import { useState, useEffect } from 'react'
import type { components } from '@render/api-client'
import type { FormField } from '@/components/DynamicForm'
import { initialTriageIndex, clampIndex } from '@/lib/triage'
import { linkIconForPrefill } from '@/lib/favicon'
import { SharedLinks } from '@/components/SharedLinks'

type Application = components['schemas']['Application']

type Props = {
  apps: Application[]
  formFields: FormField[]
  detailOpen: boolean
  onShortlist: (id: string, shortlisted: boolean) => void
  onOpenDetail: (app: Application) => void
  onClose: () => void
}

export function TriageMode({ apps, formFields, detailOpen, onShortlist, onOpenDetail, onClose }: Props) {
  const [index, setIndex] = useState(() => initialTriageIndex(apps))
  const current = apps[index] ?? null
  const shortlistedCount = apps.filter(a => a.shortlisted).length

  function decide(shortlisted: boolean) {
    if (current?.id) onShortlist(current.id, shortlisted)
    setIndex(i => clampIndex(i + 1, apps.length))
  }

  // Re-bind each render so the handler closes over the current index/app.
  // Inert while the detail slide-over is open (parent owns that interaction).
  useEffect(() => {
    if (detailOpen) return
    function onKey(e: KeyboardEvent) {
      switch (e.key) {
        case 'ArrowRight': e.preventDefault(); decide(true); break
        case 'ArrowLeft': e.preventDefault(); decide(false); break
        case 'ArrowDown': e.preventDefault(); setIndex(i => clampIndex(i + 1, apps.length)); break
        case 'ArrowUp': e.preventDefault(); setIndex(i => clampIndex(i - 1, apps.length)); break
        case 'Enter': e.preventDefault(); if (current) onOpenDetail(current); break
        case 'Escape': e.preventDefault(); onClose(); break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, apps, detailOpen])

  const name = current?.artist?.display_name ?? 'Unknown artist'
  const answers = (current?.answers ?? {}) as Record<string, string>
  const labelFor = (fieldId: string) => formFields.find(f => f.id === fieldId)?.label ?? fieldId
  // Link fields render as favicons (below); keep their raw URLs out of the text answers.
  const linkFieldIds = new Set(
    formFields.filter(f => linkIconForPrefill(f.prefill)).map(f => f.id ?? f.label),
  )
  const textEntries = Object.entries(answers).filter(([id]) => !linkFieldIds.has(id)).slice(0, 4)

  return (
    <div className="fixed inset-0 z-40 bg-offwhite flex flex-col" data-testid="triage-mode">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-light">
        <span className="font-mono text-xs text-mid uppercase tracking-widest">
          Triage · {Math.min(index + 1, apps.length)} / {apps.length} · {shortlistedCount} shortlisted
        </span>
        <button onClick={onClose} className="font-sans text-sm text-mid hover:text-ink">Close ✕</button>
      </div>

      {/* Card */}
      <div className="flex-1 overflow-y-auto flex items-start justify-center p-8">
        {current ? (
          <div className="w-full max-w-xl bg-warm border border-light rounded-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-serif text-2xl text-ink">{name}</h2>
              {current.shortlisted && (
                <span className="font-mono text-xs text-amber uppercase tracking-widest">★ shortlisted</span>
              )}
            </div>
            <SharedLinks formFields={formFields} answers={answers} className="mb-4" />
            <div className="space-y-3">
              {textEntries.map(([fieldId, value]) => (
                <div key={fieldId}>
                  <p className="font-sans text-xs text-mid mb-0.5">{labelFor(fieldId)}</p>
                  <p className="font-sans text-sm text-ink line-clamp-3">{value}</p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="font-sans text-sm text-mid">No applications to triage.</p>
        )}
      </div>

      {/* Controls (mirror the keys) */}
      <div className="flex items-center justify-center gap-3 px-6 py-4 border-t border-light">
        <button onClick={() => decide(false)} disabled={!current}
          className="font-sans text-sm border border-light rounded-lg px-5 py-2 hover:border-clay disabled:opacity-40">
          ← No
        </button>
        <button onClick={() => current && onOpenDetail(current)} disabled={!current}
          className="font-sans text-sm border border-light rounded-lg px-5 py-2 hover:border-amber disabled:opacity-40">
          Details ↵
        </button>
        <button onClick={() => decide(true)} disabled={!current}
          className="font-sans text-sm bg-amber text-ink font-medium rounded-lg px-5 py-2 hover:opacity-90 disabled:opacity-40">
          Shortlist →
        </button>
      </div>
    </div>
  )
}
