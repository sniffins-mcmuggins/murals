'use client'

import { useState } from 'react'
import { apiClient } from '@/lib/api'

type FeedbackKind = 'idea' | 'bug' | 'direction' | 'praise'

const KINDS: { value: FeedbackKind; label: string }[] = [
  { value: 'idea', label: 'Idea' },
  { value: 'bug', label: 'Bug' },
  { value: 'direction', label: 'Direction' },
  { value: 'praise', label: 'Praise' },
]

export function BetaFeedbackWidget() {
  const [kind, setKind] = useState<FeedbackKind>('idea')
  const [body, setBody] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!body.trim()) return
    setStatus('sending')
    try {
      const { error } = await apiClient.POST('/beta/feedback', {
        body: { kind, body: body.trim() },
      })
      if (!error) {
        setStatus('sent')
        setBody('')
        setTimeout(() => setStatus('idle'), 3000)
      } else {
        setStatus('error')
      }
    } catch {
      setStatus('error')
    }
  }

  return (
    <section className="bg-warm border border-light rounded-lg p-6">
      <h2 className="font-serif text-2xl text-ink mb-1">Share feedback</h2>
      <p className="font-mono text-xs uppercase tracking-wider text-mid mb-4">
        Founding member channel
      </p>

      {status === 'sent' ? (
        <p className="font-sans text-sm text-ink">Thanks — feedback received.</p>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            {KINDS.map((k) => (
              <button
                key={k.value}
                type="button"
                onClick={() => setKind(k.value)}
                className={`font-mono text-xs uppercase tracking-wider px-3 py-1 rounded transition-colors ${
                  kind === k.value
                    ? 'bg-ink text-amber'
                    : 'bg-light text-mid hover:bg-ink hover:text-offwhite'
                }`}
              >
                {k.label}
              </button>
            ))}
          </div>

          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="What's on your mind?"
            rows={3}
            className="w-full font-sans text-sm text-ink bg-offwhite border border-light rounded px-3 py-2 resize-none focus:outline-none focus:border-ink"
          />

          {status === 'error' && (
            <p className="font-sans text-xs text-clay">Something went wrong — try again.</p>
          )}

          <button
            type="submit"
            disabled={status === 'sending' || !body.trim()}
            className="px-5 py-2 bg-amber text-ink font-sans text-sm rounded hover:bg-clay hover:text-offwhite transition-colors disabled:opacity-50"
          >
            {status === 'sending' ? 'Sending…' : 'Send'}
          </button>
        </form>
      )}
    </section>
  )
}
