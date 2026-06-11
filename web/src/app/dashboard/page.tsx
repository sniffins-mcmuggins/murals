import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { components } from '@render/api-client'

import { requireAuth, createAuthedServerClient } from '@/lib/auth-server'
import { BetaFeedbackWidget } from '@/components/BetaFeedbackWidget'
import { BetaInviteCard } from '@/components/BetaInviteCard'

type BetaInvite = components['schemas']['BetaInvite']

export default async function DashboardPage() {
  await requireAuth()
  const client = await createAuthedServerClient()
  if (!client) redirect('/login')

  const { data: summary, error } = await client.GET('/me/summary', {})
  if (error || !summary) {
    throw new Error('Failed to load dashboard summary')
  }

  // Festivals the caller has been invited to review — folded into this single
  // dashboard (there is no separate organiser dashboard). Empty for most users.
  const { data: reviewingData } = await client.GET('/me/reviewing', {})
  const reviewing = reviewingData ?? []

  let betaInvites: BetaInvite[] = []
  let betaRemaining = 0
  if (summary.is_beta) {
    const { data: betaData } = await client.GET('/beta/me/invites', {})
    betaInvites = betaData?.invites ?? []
    betaRemaining = betaData?.remaining_quota ?? 0
  }

  return (
    <div className="min-h-screen bg-offwhite">
      <header className="border-b border-light bg-warm">
        <div className="max-w-4xl mx-auto px-6 py-5 flex items-center justify-between">
          <span className="font-serif text-xl text-ink">Painttrace</span>
          {summary.is_beta && (
            <span className="font-mono text-[10px] uppercase tracking-widest text-amber bg-ink px-2 py-0.5 rounded">
              Founding member
            </span>
          )}
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10 space-y-6">
        <div>
          <h1 className="font-serif text-4xl text-ink mb-2">Your dashboard</h1>
          <p className="font-sans text-mid">
            Everything you make and everything you run, in one place.
          </p>
        </div>

        <section className="bg-warm border border-light rounded-lg p-6">
          <h2 className="font-serif text-2xl text-ink mb-1">Your art</h2>
          <p className="font-mono text-xs uppercase tracking-wider text-mid mb-4">
            Artist profile
          </p>

          {summary.artist_profile ? (
            <div className="flex items-start gap-4">
              <div className="flex-1">
                <p className="font-serif text-xl text-ink">
                  {summary.artist_profile.display_name}
                </p>
                {summary.artist_profile.bio && (
                  <p className="font-sans text-sm text-mid mt-1 line-clamp-2">
                    {summary.artist_profile.bio}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-4 whitespace-nowrap">
                <Link
                  href={`/artists/${summary.artist_profile.id}`}
                  className="font-sans text-sm text-ink underline hover:text-amber"
                >
                  View live page
                </Link>
                <Link
                  href="/profile"
                  className="font-sans text-sm text-ink underline hover:text-amber"
                >
                  Manage profile
                </Link>
              </div>
            </div>
          ) : (
            <div className="text-center py-6">
              <p className="font-sans text-sm text-mid mb-4">
                You don&apos;t have an artist profile yet. Set one up so
                organisers can find you and so you can apply to festivals.
              </p>
              <Link
                href="/profile"
                className="inline-block px-5 py-2 bg-amber text-ink font-sans text-sm rounded hover:bg-clay hover:text-offwhite transition-colors"
              >
                Set up your artist profile
              </Link>
            </div>
          )}
        </section>

        <section className="bg-warm border border-light rounded-lg p-6">
          <h2 className="font-serif text-2xl text-ink mb-1">Your festivals</h2>
          <p className="font-mono text-xs uppercase tracking-wider text-mid mb-4">
            As organiser
          </p>

          {summary.festivals.length > 0 ? (
            <ul className="divide-y divide-light">
              {summary.festivals.map((f) => (
                <li
                  key={f.id}
                  className="flex items-center gap-4 py-3 first:pt-0 last:pb-0"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-serif text-lg text-ink truncate">
                      {f.name}
                    </p>
                    <p className="font-mono text-xs uppercase tracking-wider text-mid mt-0.5">
                      {f.status}
                    </p>
                  </div>
                  <Link
                    href={`/organiser/festivals/${f.id}`}
                    className="font-sans text-sm text-ink underline hover:text-amber whitespace-nowrap"
                  >
                    Manage
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-center py-6">
              <p className="font-sans text-sm text-mid mb-4">
                You aren&apos;t organising any festivals yet. Set one up and
                start accepting applications.
              </p>
              <Link
                href="/organiser/festivals"
                className="inline-block px-5 py-2 bg-amber text-ink font-sans text-sm rounded hover:bg-clay hover:text-offwhite transition-colors"
              >
                Create a festival
              </Link>
            </div>
          )}
        </section>

        {reviewing.length > 0 && (
          <section className="bg-warm border border-light rounded-lg p-6">
            <h2 className="font-serif text-2xl text-ink mb-1">Reviewing</h2>
            <p className="font-mono text-xs uppercase tracking-wider text-mid mb-4">
              As reviewer
            </p>
            <ul className="divide-y divide-light">
              {reviewing.map((f) => (
                <li
                  key={f.id}
                  className="flex items-center gap-4 py-3 first:pt-0 last:pb-0"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-serif text-lg text-ink truncate">
                      {f.name}
                    </p>
                    <p className="font-mono text-xs uppercase tracking-wider text-mid mt-0.5">
                      {f.status}
                    </p>
                  </div>
                  <Link
                    href="/organiser/reviewing"
                    className="font-sans text-sm text-ink underline hover:text-amber whitespace-nowrap"
                  >
                    Review
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {summary.is_beta && (
          <>
            <BetaInviteCard
              initialInvites={betaInvites}
              initialRemaining={betaRemaining}
            />
            <BetaFeedbackWidget />
          </>
        )}
      </main>
    </div>
  )
}
