'use client'

import { useState } from 'react'
import type { components } from '@render/api-client'
import { apiClient } from '@/lib/api'

type Invite = components['schemas']['BetaInvite']

type Props = {
  initialInvites: Invite[]
  initialRemaining: number
}

export function BetaInviteCard({ initialInvites, initialRemaining }: Props) {
  const [invites, setInvites] = useState<Invite[]>(initialInvites)
  const [remaining, setRemaining] = useState(initialRemaining)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  async function mintInvite() {
    setLoading(true)
    try {
      const { data, error } = await apiClient.POST('/beta/invites', {})
      if (error || !data) return
      setInvites((prev) => [data, ...prev])
      setRemaining((prev) => Math.max(0, prev - 1))
    } finally {
      setLoading(false)
    }
  }

  async function copyLink(link: string) {
    await navigator.clipboard.writeText(link)
    setCopied(link)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <section className="bg-warm border border-light rounded-lg p-6">
      <h2 className="font-serif text-2xl text-ink mb-1">Invite friends</h2>
      <p className="font-mono text-xs uppercase tracking-wider text-mid mb-4">
        {remaining} invite{remaining !== 1 ? 's' : ''} remaining
      </p>

      <p className="font-sans text-sm text-mid mb-4">
        You&apos;re a founding member — share an invite link and bring someone into the community.
        Each link is single-use.
      </p>

      {remaining > 0 && (
        <button
          onClick={mintInvite}
          disabled={loading}
          className="mb-4 px-5 py-2 bg-amber text-ink font-sans text-sm rounded hover:bg-clay hover:text-offwhite transition-colors disabled:opacity-50"
        >
          {loading ? 'Generating…' : 'Generate invite link'}
        </button>
      )}

      {invites.length > 0 && (
        <ul className="divide-y divide-light">
          {invites.map((inv) => (
            <li key={inv.code} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
              <span className="font-mono text-xs text-ink flex-1 truncate">{inv.link}</span>
              <span className="font-mono text-xs text-mid whitespace-nowrap">
                {inv.used_count}/{inv.max_uses} used
              </span>
              <button
                onClick={() => copyLink(inv.link)}
                className="font-sans text-xs text-amber hover:text-clay underline whitespace-nowrap"
              >
                {copied === inv.link ? 'Copied!' : 'Copy'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
