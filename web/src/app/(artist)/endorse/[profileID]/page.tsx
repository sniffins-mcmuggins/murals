'use client'

import { useState, useEffect, use } from 'react'
import { useRouter } from 'next/navigation'
import { createApiClient } from '@render/api-client'
import type { components } from '@render/api-client'

type Festival = components['schemas']['Festival']

const client = createApiClient({
  baseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080',
})

export default function EndorsePage({ params }: { params: Promise<{ profileID: string }> }) {
  const { profileID } = use(params)
  const router = useRouter()

  const [kind, setKind] = useState<'peer' | 'organiser'>('peer')
  const [festivalID, setFestivalID] = useState('')
  const [body, setBody] = useState('')
  const [skillInput, setSkillInput] = useState('')
  const [skills, setSkills] = useState<string[]>([])
  const [ownedFestivals, setOwnedFestivals] = useState<Festival[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    client.GET('/festivals', {}).then(({ data }) => {
      if (data) setOwnedFestivals(data)
    })
  }, [])

  function addSkill(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      const s = skillInput.trim().toLowerCase()
      if (s && !skills.includes(s)) setSkills((prev) => [...prev, s])
      setSkillInput('')
    }
  }

  function removeSkill(s: string) {
    setSkills((prev) => prev.filter((x) => x !== s))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const { response } = await client.POST('/endorsements', {
        body: {
          endorsee_id: profileID,
          kind,
          festival_id: kind === 'organiser' && festivalID ? festivalID : undefined,
          body: body || undefined,
          skills,
        },
      })
      if (response.ok) {
        router.push(`/artists/${profileID}`)
      } else {
        const text = await response.text()
        let msg = `Error ${response.status}`
        try {
          const parsed = JSON.parse(text)
          msg = parsed.detail ?? parsed.message ?? msg
        } catch { /* ignore parse error */ }
        setError(msg)
      }
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <h1 className="font-serif text-4xl text-ink mb-2">Endorse this artist</h1>
      <p className="font-sans text-mid mb-8">Your words appear publicly on their profile.</p>

      <form onSubmit={submit} className="space-y-6 max-w-xl">
        {/* Kind */}
        <div>
          <label className="font-sans text-sm font-medium text-ink block mb-2">Endorsement type</label>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setKind('peer')}
              className={`font-mono text-xs uppercase tracking-widest px-4 py-2 rounded border transition-colors ${
                kind === 'peer' ? 'bg-ink text-offwhite border-ink' : 'bg-offwhite text-mid border-light'
              }`}
            >
              Artist peer
            </button>
            {ownedFestivals.length > 0 && (
              <button
                type="button"
                onClick={() => setKind('organiser')}
                className={`font-mono text-xs uppercase tracking-widest px-4 py-2 rounded border transition-colors ${
                  kind === 'organiser' ? 'bg-ink text-offwhite border-ink' : 'bg-offwhite text-mid border-light'
                }`}
              >
                Festival organiser
              </button>
            )}
          </div>
        </div>

        {/* Festival picker (organiser only) */}
        {kind === 'organiser' && (
          <div>
            <label className="font-sans text-sm font-medium text-ink block mb-2">Badge as festival</label>
            <select
              value={festivalID}
              onChange={(e) => setFestivalID(e.target.value)}
              required
              className="font-sans text-sm text-ink bg-offwhite border border-light rounded px-3 py-2 w-full"
            >
              <option value="">Select a festival…</option>
              {ownedFestivals.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Body */}
        <div>
          <label className="font-sans text-sm font-medium text-ink block mb-2">Message (optional)</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            placeholder="Share what makes this artist special…"
            className="font-serif text-base text-ink bg-offwhite border border-light rounded px-3 py-2 w-full resize-none focus:outline-none focus:border-amber"
          />
        </div>

        {/* Skills */}
        <div>
          <label className="font-sans text-sm font-medium text-ink block mb-2">
            Skills (optional — press Enter or comma to add)
          </label>
          <div className="flex flex-wrap gap-2 mb-2">
            {skills.map((s) => (
              <span key={s} className="font-mono text-xs uppercase tracking-wide bg-warm text-ink px-2 py-1 rounded flex items-center gap-1">
                {s}
                <button type="button" onClick={() => removeSkill(s)} className="text-mid hover:text-clay ml-1">×</button>
              </span>
            ))}
          </div>
          <input
            type="text"
            value={skillInput}
            onChange={(e) => setSkillInput(e.target.value)}
            onKeyDown={addSkill}
            placeholder="e.g. mural, stencil…"
            className="font-sans text-sm text-ink bg-offwhite border border-light rounded px-3 py-2 w-full focus:outline-none focus:border-amber"
          />
        </div>

        {error && <p className="font-sans text-sm text-clay">{error}</p>}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="font-mono text-xs uppercase tracking-widest bg-ink text-offwhite px-6 py-2 rounded hover:bg-amber hover:text-ink transition-colors disabled:opacity-50"
          >
            {submitting ? 'Submitting…' : 'Endorse'}
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="font-mono text-xs uppercase tracking-widest text-mid border border-light px-4 py-2 rounded hover:text-ink transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
