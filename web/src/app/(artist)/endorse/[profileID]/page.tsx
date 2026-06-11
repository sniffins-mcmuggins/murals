'use client'

import { useState, use } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { components } from '@render/api-client'

type Festival = components['schemas']['Festival']

export default function EndorsePage({ params }: { params: Promise<{ profileID: string }> }) {
  const { profileID } = use(params)
  const router = useRouter()

  const [kind, setKind] = useState<'peer' | 'organiser'>('peer')
  const [festivalID, setFestivalID] = useState('')
  const [body, setBody] = useState('')
  const [skillInput, setSkillInput] = useState('')
  const [skills, setSkills] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const festivalsQuery = useQuery({
    queryKey: ['my-festivals'],
    queryFn: async () => {
      const res = await apiClient.GET('/festivals', {})
      if (res.error) throw new Error('Failed to load festivals')
      return (res.data ?? []) as Festival[]
    },
  })
  const ownedFestivals = festivalsQuery.data ?? []

  // You can't endorse your own profile. The API rejects it (400), but guard the
  // form too so the viewer never gets that far. `/profiles/me` 404s for users
  // without an artist profile — they're never the endorsee, so treat as not-self.
  const myProfileQuery = useQuery({
    queryKey: ['my-profile'],
    queryFn: async () => {
      const res = await apiClient.GET('/profiles/me', {})
      if (res.error) return null
      return res.data ?? null
    },
  })
  const isSelf = myProfileQuery.data?.id === profileID

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
      const { response } = await apiClient.POST('/endorsements', {
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

  // Don't flash the form before we know whose profile this is.
  if (myProfileQuery.isLoading) {
    return <p className="font-sans text-mid">Loading…</p>
  }

  if (isSelf) {
    return (
      <div>
        <h1 className="font-serif text-4xl text-ink mb-2">You can&apos;t endorse yourself</h1>
        <p className="font-sans text-mid mb-8">
          Endorsements come from other artists and organisers. Share your
          profile so others can vouch for you.
        </p>
        <Link
          href={`/artists/${profileID}`}
          className="inline-block font-mono text-xs uppercase tracking-widest bg-ink text-offwhite px-6 py-2 rounded hover:bg-amber hover:text-ink transition-colors"
        >
          View your profile
        </Link>
      </div>
    )
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
