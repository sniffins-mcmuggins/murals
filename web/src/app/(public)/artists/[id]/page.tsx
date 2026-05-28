import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { apiClient } from '@/lib/api'
import { SocialIcon } from '@/components/SocialIcon'

interface ArtistPageProps {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: ArtistPageProps): Promise<Metadata> {
  const { id } = await params
  const { data, response } = await apiClient.GET('/profiles/{profileID}', {
    params: { path: { profileID: id } },
  })

  if (response.status === 404 || !data) {
    return { title: 'Artist not found | Render' }
  }

  return {
    title: `${data.display_name} | Render`,
    description: data.bio,
  }
}

export default async function ArtistPage({ params }: ArtistPageProps) {
  const { id } = await params

  const [profileRes, collectionsRes] = await Promise.all([
    apiClient.GET('/profiles/{profileID}', {
      params: { path: { profileID: id } },
    }),
    apiClient.GET('/profiles/{profileID}/collections', {
      params: { path: { profileID: id } },
    }),
  ])

  if (profileRes.response.status === 404 || !profileRes.data) {
    notFound()
  }

  const profile = profileRes.data
  const collections = collectionsRes.data ?? []

  const statusLabel: Record<string, string> = {
    active: 'Active',
    archived: 'Archived',
    ongoing: 'Ongoing',
  }

  const statusColour: Record<string, string> = {
    active: 'bg-amber text-ink',
    archived: 'bg-warm text-mid border border-light',
    ongoing: 'bg-clay text-offwhite',
  }

  return (
    <main className="min-h-screen bg-offwhite">
      <div className="max-w-4xl mx-auto px-6 py-12">
        {/* Headline photos strip */}
        {profile.headline_image_urls.length > 0 && (
          <div className={`grid gap-2 mb-10 ${profile.headline_image_urls.length === 1 ? 'grid-cols-1' : profile.headline_image_urls.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
            {profile.headline_image_urls.map((url, i) => (
              <div
                key={i}
                className={`overflow-hidden rounded-lg ${i === 0 && profile.headline_image_urls.length === 3 ? 'col-span-2 row-span-2' : ''}`}
              >
                <img
                  src={url}
                  alt={`${profile.display_name} — photo ${i + 1}`}
                  className="w-full h-64 object-cover"
                />
              </div>
            ))}
          </div>
        )}

        {/* Header */}
        <header className="mb-10">
          {profile.avatar_s3_key && (
            <img
              src={profile.avatar_s3_key}
              alt={profile.display_name}
              className="w-20 h-20 rounded-full object-cover mb-6 border-2 border-light"
            />
          )}

          <h1 className="font-serif text-5xl text-ink mb-4">{profile.display_name}</h1>

          {profile.location_label && (
            <p className="font-sans text-mid mb-4 text-sm tracking-wide">
              {profile.location_label}
            </p>
          )}

          {profile.bio && (
            <p className="font-sans text-ink leading-relaxed max-w-2xl mb-6">{profile.bio}</p>
          )}

          {/* Medium tags */}
          {profile.medium_tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-6">
              {profile.medium_tags.map((tag) => (
                <span
                  key={tag}
                  className="font-mono text-xs uppercase tracking-widest bg-warm border border-light text-ink px-3 py-1 rounded"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Social links */}
          {Object.keys(profile.social_links).length > 0 && (
            <nav aria-label="Social links" className="flex flex-wrap gap-4">
              {Object.entries(profile.social_links).map(([platform, url]) => (
                <a
                  key={platform}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={platform}
                  className="text-mid hover:text-amber transition-colors"
                >
                  <SocialIcon platform={platform} className="w-6 h-6" />
                </a>
              ))}
            </nav>
          )}
        </header>

        {/* Collections */}
        {collections.length > 0 && (
          <section aria-label="Collections">
            <h2 className="font-serif text-3xl text-ink mb-6">Collections</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {collections.map((collection) => (
                <article
                  key={collection.id}
                  className="bg-warm border border-light rounded overflow-hidden"
                >
                  {collection.cover_s3_key ? (
                    <img
                      src={collection.cover_s3_key}
                      alt={collection.name}
                      className="w-full h-48 object-cover"
                    />
                  ) : (
                    <div className="w-full h-48 bg-light flex items-center justify-center">
                      <span className="font-mono text-xs uppercase tracking-widest text-mid">
                        No image
                      </span>
                    </div>
                  )}

                  <div className="p-4">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <h3 className="font-serif text-xl text-ink">{collection.name}</h3>
                      <span
                        className={`font-mono text-xs uppercase tracking-widest px-2 py-0.5 rounded shrink-0 ${statusColour[collection.status] ?? 'bg-warm text-mid'}`}
                      >
                        {statusLabel[collection.status] ?? collection.status}
                      </span>
                    </div>
                    {collection.description && (
                      <p className="font-sans text-sm text-mid leading-relaxed">
                        {collection.description}
                      </p>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  )
}
