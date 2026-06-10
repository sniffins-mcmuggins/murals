import Link from 'next/link'
import { requireAuth, createAuthedServerClient } from '@/lib/auth-server'
import { redirect } from 'next/navigation'

// Preview renders the artist's DRAFT (live tables) — "what your changes will
// look like after you publish". The owner reads /profiles/me + their own
// collections, which the API serves from live tables for the owner.
export default async function ProfilePreviewPage() {
  await requireAuth()

  const authedClient = await createAuthedServerClient()
  if (!authedClient) redirect('/login')

  const me = (await authedClient.GET('/profiles/me', {})).data
  if (!me) redirect('/profile/setup')
  const collections =
    (
      await authedClient.GET('/profiles/{profileID}/collections', {
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
