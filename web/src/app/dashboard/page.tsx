import { cookies } from 'next/headers'
import Link from 'next/link'

import { requireAuth } from '@/lib/auth-server'

const API_URL =
  process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'

type ArtistProfile = {
  id: string
  display_name: string
  bio: string
  avatar_s3_key?: string
}

type Festival = {
  id: string
  name: string
  slug: string
  status: 'draft' | 'open' | 'live' | 'archived'
  start_date?: string
  end_date?: string
}

type Summary = {
  artist_profile: ArtistProfile | null
  festivals: Festival[]
}

async function fetchSummary(sessionCookie: string): Promise<Summary> {
  const res = await fetch(`${API_URL}/me/summary`, {
    headers: { Cookie: `session=${sessionCookie}` },
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new Error(`/me/summary failed: ${res.status}`)
  }
  return res.json() as Promise<Summary>
}

export default async function DashboardPage() {
  await requireAuth()
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('session')?.value ?? ''
  const summary = await fetchSummary(sessionCookie)

  return (
    <div className="min-h-screen bg-offwhite">
      <header className="border-b border-light bg-warm">
        <div className="max-w-4xl mx-auto px-6 py-5 flex items-center justify-between">
          <span className="font-serif text-xl text-ink">Render</span>
          <Link
            href="/logout"
            className="font-sans text-sm text-mid hover:text-ink"
          >
            Log out
          </Link>
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
              <Link
                href="/profile"
                className="font-sans text-sm text-ink underline hover:text-amber whitespace-nowrap"
              >
                Manage profile
              </Link>
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
      </main>
    </div>
  )
}
