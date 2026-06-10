import Link from 'next/link'
import { cookies } from 'next/headers'
import { createApiClient } from '@render/api-client'
import { requireAuth } from '@/lib/auth-server'

// Preview renders the artist's DRAFT (live tables) — "what your changes will
// look like after you publish". The owner reads /profiles/me + their own
// collections, which the API serves from live tables for the owner.
export default async function ProfilePreviewPage() {
  await requireAuth()

  const cookieStore = await cookies()
  const session = cookieStore.get('session')?.value
  const client = createApiClient({
    baseUrl: process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080',
  })
  if (session) {
    client.use({
      onRequest({ request }) {
        request.headers.set('Cookie', `session=${session}`)
        return request
      },
    })
  }

  const me = (await client.GET('/profiles/me', {})).data
  if (!me) return null
  const collections =
    (
      await client.GET('/profiles/{profileID}/collections', {
        params: { path: { profileID: me.id } },
      })
    ).data ?? []

  return (
    <div>
      <div
        className="mb-6 p-3 bg-warm border border-light rounded-lg flex items-center justify-between"
        data-testid="preview-banner"
      >
        <p className="font-sans text-sm text-ink">
          Draft preview — this is what your page will look like after you publish.
        </p>
        <Link href="/profile" className="font-sans text-sm underline hover:text-amber">
          Back to editor
        </Link>
      </div>
      <h1 className="font-serif text-4xl text-ink mb-1" data-testid="preview-name">
        {me.display_name}
      </h1>
      {me.bio && <p className="font-sans text-mid mb-6">{me.bio}</p>}
      <div className="space-y-4">
        {collections.map((c) => (
          <section key={c.id} className="border border-light rounded-lg p-4">
            <h2 className="font-serif text-2xl text-ink">{c.name}</h2>
            {c.description && <p className="font-sans text-sm text-mid">{c.description}</p>}
          </section>
        ))}
      </div>
    </div>
  )
}
