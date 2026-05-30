import { requireAuth } from '@/lib/auth-server'
import { cookies } from 'next/headers'
import { createApiClient } from '@render/api-client'
import Link from 'next/link'

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-light bg-warm p-6 space-y-2">
      <p className="font-mono text-xs text-mid uppercase tracking-wide">{label}</p>
      <p className="font-serif text-4xl text-ink">{value.toLocaleString()}</p>
    </div>
  )
}

export default async function AnalyticsPage() {
  await requireAuth()

  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('session')
  const authedClient = createApiClient({
    baseUrl: process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080',
  })
  if (sessionCookie?.value) {
    const sv = sessionCookie.value
    authedClient.use({ onRequest({ request }) { request.headers.set('Cookie', `session=${sv}`); return request } })
  }

  const res = await authedClient.GET('/profiles/me/analytics', {})
  const data = res.data ?? null

  return (
    <div className="max-w-2xl space-y-8">
      <div className="flex items-baseline gap-4">
        <h1 className="font-serif text-4xl text-ink">Analytics</h1>
        {data && (
          <span className="font-mono text-xs text-mid uppercase tracking-wide">
            Last {data.window_days === 730 ? '2 years' : '90 days'}
          </span>
        )}
      </div>

      {data ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard label="Profile views" value={data.profile_views} />
            <StatCard label="QR scans" value={data.qr_scans} />
            <StatCard label="Link clicks" value={data.link_clicks} />
          </div>

          {data.window_days === 90 && (
            <p className="font-sans text-sm text-mid">
              Upgrade to Pro for 2 years of history.{' '}
              <Link href="/billing" className="text-amber underline">
                See plans
              </Link>
            </p>
          )}
        </>
      ) : (
        <p className="font-sans text-mid text-sm">
          Create a profile to start seeing analytics.
        </p>
      )}
    </div>
  )
}
