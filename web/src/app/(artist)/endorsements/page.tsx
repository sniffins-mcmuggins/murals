'use client'

import { useState, useEffect } from 'react'
import { createApiClient } from '@render/api-client'
import type { components } from '@render/api-client'

type Endorsement = components['schemas']['EndorsementResponse']

const client = createApiClient({
  baseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080',
})

export default function EndorsementsPage() {
  const [endorsements, setEndorsements] = useState<Endorsement[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    client.GET('/endorsements/received', {}).then(({ data }) => {
      setEndorsements(data?.endorsements ?? [])
      setLoading(false)
    })
  }, [])

  async function toggleVisibility(id: string, currentHidden: boolean) {
    const { data } = await client.PATCH('/endorsements/{endorsementID}/visibility', {
      params: { path: { endorsementID: id } },
      body: { hidden: !currentHidden },
    })
    if (data) {
      setEndorsements((prev) => prev.map((e) => (e.id === id ? data : e)))
    }
  }

  if (loading) {
    return <p className="font-sans text-mid">Loading…</p>
  }

  return (
    <div>
      <h1 className="font-serif text-4xl text-ink mb-2">Endorsements</h1>
      <p className="font-sans text-mid mb-8">
        Control which endorsements appear on your public profile.
      </p>

      {endorsements.length === 0 && (
        <p className="font-sans text-mid">No endorsements yet.</p>
      )}

      <ul className="space-y-4">
        {endorsements.map((e) => (
          <li
            key={e.id}
            className={`p-4 border rounded-lg transition-opacity ${
              e.hidden_by_endorsee ? 'border-light bg-warm opacity-60' : 'border-light bg-offwhite'
            }`}
          >
            <div className="flex items-start gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  {e.kind === 'organiser' && e.festival_name && (
                    <span className="font-mono text-xs uppercase tracking-widest bg-amber text-ink px-2 py-0.5 rounded">
                      {e.festival_name}
                    </span>
                  )}
                  <span className="font-sans text-sm font-medium text-ink">
                    {e.endorser_display_name ?? 'Anonymous'}
                  </span>
                  <span className="font-mono text-xs uppercase tracking-widest text-mid">
                    {e.kind}
                  </span>
                  {e.hidden_by_endorsee && (
                    <span className="font-mono text-xs uppercase tracking-widest text-mid">(hidden)</span>
                  )}
                </div>
                {e.body && (
                  <p className="font-serif text-base text-ink leading-relaxed">{e.body}</p>
                )}
                {e.skills && e.skills.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {e.skills.map((s) => (
                      <span key={s} className="font-mono text-xs uppercase tracking-wide bg-light text-ink px-2 py-0.5 rounded">
                        {s}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <button
                onClick={() => toggleVisibility(e.id, e.hidden_by_endorsee)}
                className={`font-mono text-xs uppercase tracking-widest px-3 py-1.5 rounded border shrink-0 transition-colors ${
                  e.hidden_by_endorsee
                    ? 'border-light text-mid hover:text-ink hover:border-ink'
                    : 'border-light text-mid hover:text-clay hover:border-clay'
                }`}
              >
                {e.hidden_by_endorsee ? 'Show' : 'Hide'}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
