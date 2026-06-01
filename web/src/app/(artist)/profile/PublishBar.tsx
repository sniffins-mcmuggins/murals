'use client'

import { useState } from 'react'
import Link from 'next/link'
import { apiClient } from '@/lib/api'
import type { components } from '@render/api-client'

type ArtistProfile = components['schemas']['ArtistProfile']

export default function PublishBar({ initialProfile }: { initialProfile: ArtistProfile | null }) {
  const [profile, setProfile] = useState(initialProfile)
  const [showUpsell, setShowUpsell] = useState(false)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!profile) return null

  async function handlePublish() {
    setBusy(true)
    setError(null)
    setShowUpsell(false)
    const res = await apiClient.POST('/profiles/me/publish', {})
    setBusy(false)
    if (res.response.status === 402) {
      setShowUpsell(true)
      return
    }
    if (!res.data) {
      setError('Something went wrong. Please try again.')
      return
    }
    setProfile(res.data)
  }

  async function handleUnpublish() {
    setBusy(true)
    setError(null)
    const res = await apiClient.POST('/profiles/me/unpublish', {})
    setBusy(false)
    if (!res.data) {
      setError('Something went wrong. Please try again.')
      return
    }
    setProfile(res.data)
    setShowUpsell(false)
  }

  function handleCopyPreviewLink() {
    const token = profile?.preview_token
    if (!token) return
    const url = `${window.location.origin}/profiles/preview/${token}`
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const isDraft = profile.visibility === 'draft'

  return (
    <div className="mb-8 space-y-3" data-testid="publish-bar">
      <div className="flex items-center gap-4 flex-wrap">
        <span
          data-testid="visibility-badge"
          className={`font-mono text-xs uppercase tracking-wider px-2 py-1 rounded border ${
            isDraft
              ? 'bg-warm text-mid border-light'
              : 'bg-amber text-ink border-amber'
          }`}
        >
          {isDraft ? 'Draft' : 'Public'}
        </span>

        {profile.preview_token && (
          <button
            type="button"
            onClick={handleCopyPreviewLink}
            className="font-sans text-sm text-ink underline hover:text-amber transition-colors"
          >
            {copied ? 'Copied!' : 'Copy preview link'}
          </button>
        )}

        {isDraft ? (
          <button
            type="button"
            onClick={handlePublish}
            disabled={busy}
            className="px-5 py-2 bg-amber text-ink font-sans font-medium text-sm rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {busy ? 'Publishing…' : 'Go Public'}
          </button>
        ) : (
          <button
            type="button"
            onClick={handleUnpublish}
            disabled={busy}
            className="px-5 py-2 border border-light text-mid font-sans text-sm rounded-lg hover:border-clay hover:text-clay transition-colors disabled:opacity-50"
          >
            {busy ? 'Taking offline…' : 'Take Offline'}
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="font-sans text-sm text-clay">
          {error}
        </p>
      )}

      {showUpsell && (
        <div className="p-4 bg-warm border border-light rounded-lg" data-testid="upsell-panel">
          <p className="font-sans text-sm text-ink mb-3">
            An active subscription is required to make your profile public.
          </p>
          <Link
            href="/billing"
            className="inline-block px-5 py-2 bg-amber text-ink font-sans text-sm rounded-lg hover:opacity-90 transition-opacity"
          >
            View plans
          </Link>
        </div>
      )}
    </div>
  )
}
