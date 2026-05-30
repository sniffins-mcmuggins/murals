import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { apiClient } from '@/lib/api'
import { SocialIcon } from '@/components/SocialIcon'
import { absoluteUrl } from '@/lib/site'

interface ArtistPageProps {
  params: Promise<{ id: string }>
}

// Pick the best representative image for social cards / structured data:
// avatar first, then the first headline photo.
function primaryImage(profile: {
  avatar_s3_key?: string | null
  headline_image_urls?: string[] | null
}): string | undefined {
  return profile.avatar_s3_key || profile.headline_image_urls?.[0] || undefined
}

export async function generateMetadata({ params }: ArtistPageProps): Promise<Metadata> {
  const { id } = await params
  const { data, response } = await apiClient.GET('/profiles/{profileID}', {
    params: { path: { profileID: id } },
  })

  if (response.status === 404 || !data) {
    return { title: 'Artist not found | Render' }
  }

  const title = `${data.display_name} | Render`
  const description =
    data.bio || `${data.display_name}${data.location_label ? ` — ${data.location_label}` : ''} on Render`
  const canonical = absoluteUrl(`/artists/${id}`)
  const image = primaryImage(data)

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      type: 'profile',
      title,
      description,
      url: canonical,
      siteName: 'Render',
      images: image ? [{ url: image, alt: data.display_name }] : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: image ? [image] : undefined,
    },
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

  // schema.org structured data — a Person (visual artist) whose works are the
  // public collections. Helps search engines surface the artist directly.
  const profileUrl = absoluteUrl(`/artists/${id}`)
  const artistImage = primaryImage(profile)
  const sameAs = Object.values(profile.social_links ?? {}).filter(
    (url): url is string => typeof url === 'string' && url.length > 0,
  )

  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    additionalType: 'https://schema.org/VisualArtist',
    name: profile.display_name,
    url: profileUrl,
    ...(profile.bio ? { description: profile.bio } : {}),
    ...(artistImage ? { image: artistImage } : {}),
    ...(profile.location_label
      ? { address: { '@type': 'PostalAddress', addressLocality: profile.location_label } }
      : {}),
    ...(sameAs.length > 0 ? { sameAs } : {}),
    ...(collections.length > 0
      ? {
          workExample: collections.map((collection) => ({
            '@type': 'VisualArtwork',
            name: collection.name,
            url: absoluteUrl(`/artists/${id}/collections/${collection.id}`),
            creator: { '@type': 'Person', name: profile.display_name },
            ...(collection.cover_s3_key ? { image: collection.cover_s3_key } : {}),
          })),
        }
      : {}),
  }

  return (
    <main className="min-h-screen bg-offwhite">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
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
            <h2 className="font-serif text-3xl text-ink mb-4">Collections</h2>
            <div className="flex gap-4 overflow-x-auto pb-3 -mx-6 px-6 [&::-webkit-scrollbar]:hidden">
              {collections.map((collection) => (
                <Link
                  key={collection.id}
                  href={`/artists/${id}/collections/${collection.id}`}
                  className="flex-none w-44 group"
                >
                  <div className="w-44 h-44 rounded-lg overflow-hidden bg-warm border border-light mb-2">
                    {collection.cover_s3_key ? (
                      <img
                        src={collection.cover_s3_key}
                        alt={collection.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        style={{ objectPosition: `${collection.cover_focal_x ?? 50}% ${collection.cover_focal_y ?? 50}%` }}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <span className="font-mono text-xs uppercase tracking-widest text-mid">
                          No image
                        </span>
                      </div>
                    )}
                  </div>
                  <p className="font-serif text-sm text-ink group-hover:text-amber transition-colors truncate mb-1">
                    {collection.name}
                  </p>
                  <span
                    className={`font-mono text-xs uppercase tracking-widest px-2 py-0.5 rounded ${statusColour[collection.status] ?? 'bg-warm text-mid'}`}
                  >
                    {statusLabel[collection.status] ?? collection.status}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  )
}
