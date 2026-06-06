'use client'

import { ReactNode } from 'react'

type Props = {
  stepIndex: number // 0-based
  total: number
  title: string
  lede?: string
  saved: boolean
  onBack?: () => void
  onSkip?: () => void
  onContinue: () => void
  continueLabel?: string
  busy?: boolean
  children: ReactNode
}

export function StepShell({
  stepIndex,
  total,
  title,
  lede,
  saved,
  onBack,
  onSkip,
  onContinue,
  continueLabel = 'Continue →',
  busy,
  children,
}: Props) {
  return (
    <div className="max-w-xl mx-auto bg-offwhite border border-light rounded-2xl p-8 md:p-10 shadow-sm">
      <div className="flex items-center justify-between mb-7">
        <div className="flex gap-1.5" aria-hidden="true">
          {Array.from({ length: total }).map((_, i) => (
            <span
              key={i}
              className={`h-2 w-2 rounded-full ${
                i < stepIndex ? 'bg-ink' : i === stepIndex ? 'bg-amber scale-125' : 'bg-light'
              }`}
            />
          ))}
        </div>
        <span className="font-mono text-xs uppercase tracking-widest text-mid">
          Step {stepIndex + 1} / {total}
        </span>
      </div>

      <h1 className="font-serif text-3xl md:text-4xl text-ink mb-2">{title}</h1>
      {lede && <p className="font-sans text-mid mb-6 leading-relaxed">{lede}</p>}

      <div className="mb-2">{children}</div>

      <div className="mt-3 flex justify-end">
        <span className="font-mono text-xs text-mid" aria-live="polite">
          {saved ? '✓ Saved automatically' : ''}
        </span>
      </div>

      <div className="mt-6 flex items-center justify-between">
        {onBack ? (
          <button type="button" onClick={onBack} className="font-sans text-sm text-mid hover:text-ink">
            ← Back
          </button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-4">
          {onSkip && (
            <button type="button" onClick={onSkip} className="font-sans text-sm text-mid hover:text-ink">
              Skip for now
            </button>
          )}
          <button
            type="button"
            onClick={onContinue}
            disabled={busy}
            className="bg-amber text-ink font-sans font-medium text-sm rounded-full px-7 py-2.5 hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {busy ? 'Saving…' : continueLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
