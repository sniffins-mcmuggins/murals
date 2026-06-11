import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { apiClient } from '@/lib/api'
import { isProfileOwner } from '@/lib/auth-server'
import { OwnerBar } from '@/components/OwnerBar'
import { SocialLinks } from '@/components/SocialLinks'
import { absoluteUrl } from '@/lib/site'
import MuralMapClient from './MuralMapClient'
import {
  COLLECTION_STATUS_LABELS,
  COLLECTION_STATUS_BADGES,
  COLLECTION_STATUS_BADGE_FALLBACK,
} from '@/lib/collections'

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
    return { title: 'Artist not found | Painttrace' }
  }

  const title = `${data.display_name} | Painttrace`
  const description =
    data.bio || `${data.display_name}${data.location_label ? ` — ${data.location_label}` : ''} on Painttrace`
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
      siteName: 'Painttrace',
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

  const [profileRes, collectionsRes, festivalsRes, endorsementsRes, isOwner] = await Promise.all([
    apiClient.GET('/profiles/{profileID}', {
      params: { path: { profileID: id } },
    }),
    apiClient.GET('/profiles/{profileID}/collections', {
      params: { path: { profileID: id } },
    }),
    apiClient.GET('/profiles/{profileID}/festivals', {
      params: { path: { profileID: id } },
    }),
    apiClient.GET('/profiles/{profileID}/endorsements', {
      params: { path: { profileID: id } },
    }),
    isProfileOwner(id),
  ])

  if (profileRes.response.status === 404 || !profileRes.data) {
    notFound()
  }

  const profile = profileRes.data
  const supportUrl =
    profile.support_url && /^https?:\/\//i.test(profile.support_url) ? profile.support_url : null
  const collections = collectionsRes.data ?? []
  const appearances = festivalsRes.data ?? []
  const endorsements = endorsementsRes.data?.endorsements ?? []

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
      <div className={`max-w-4xl mx-auto px-6 py-12 ${isOwner ? 'pb-28' : ''}`}>
        {/* Headline photos strip */}
        {profile.headline_image_urls.length > 0 && (
          <div className={`grid auto-rows-[16rem] gap-2 mb-10 ${profile.headline_image_urls.length === 1 ? 'grid-cols-1' : profile.headline_image_urls.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
            {profile.headline_image_urls.map((url, i) => (
              <div
                key={i}
                className={`overflow-hidden rounded-lg ${i === 0 && profile.headline_image_urls.length === 3 ? 'col-span-2 row-span-2' : ''}`}
              >
                <img
                  src={url}
                  alt={`${profile.display_name} — photo ${i + 1}`}
                  className="block w-full h-full object-cover"
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
          <SocialLinks profileId={profile.id} socialLinks={profile.social_links} />

          {supportUrl && (
            <a
              href={supportUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="inline-block mt-4 mr-3 font-mono text-xs uppercase tracking-widest bg-amber text-ink hover:opacity-90 px-4 py-2 rounded transition-opacity"
            >
              Support this artist
            </a>
          )}

          {/* You can't endorse yourself — only offer the affordance to other viewers. */}
          {!isOwner && (
            <Link
              href={`/endorse/${id}`}
              className="inline-block mt-4 font-mono text-xs uppercase tracking-widest border border-light text-mid hover:text-ink hover:border-ink px-4 py-2 rounded transition-colors"
            >
              Endorse this artist
            </Link>
          )}
        </header>

        {/* Festival appearances */}
        {appearances.length > 0 && (
          <section aria-label="Appearances" className="mb-10">
            <h2 className="font-serif text-3xl text-ink mb-4">Appearances</h2>
            <ul className="flex flex-col gap-2">
              {appearances.map((festival) => {
                const year = festival.start_date ? festival.start_date.slice(0, 4) : ''
                const label = `Appearing at ${festival.name}${/^\d{4}$/.test(year) ? ` ${year}` : ''}`
                return (
                  <li key={festival.id}>
                    {festival.map_slug ? (
                      <Link
                        href={`/festivals/${festival.map_slug}/map`}
                        className="inline-flex items-center gap-1 font-mono text-sm uppercase tracking-wide text-clay hover:text-amber transition-colors"
                      >
                        {label} <span aria-hidden="true">→</span>
                      </Link>
                    ) : (
                      <span className="font-mono text-sm uppercase tracking-wide text-mid">
                        {label}
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        )}

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
                    className={`font-mono text-xs uppercase tracking-widest px-2 py-0.5 rounded ${COLLECTION_STATUS_BADGES[collection.status] ?? COLLECTION_STATUS_BADGE_FALLBACK}`}
                  >
                    {COLLECTION_STATUS_LABELS[collection.status] ?? collection.status}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Mural history map */}
        {profile.spot_history && profile.spot_history.length > 0 && (
          <section aria-label="Mural history" className="mt-12">
            <h2 className="font-serif text-2xl text-ink mb-4">Mural history</h2>
            <div className="rounded-xl overflow-hidden border border-light">
              <MuralMapClient spots={profile.spot_history.map(s => ({
                spot_id: s.spot_id ?? '',
                festival_id: s.festival_id ?? '',
                festival_name: s.festival_name ?? '',
                festival_year: s.festival_year,
                lat: s.lat ?? 0,
                lng: s.lng ?? 0,
                mural_status: (s.mural_status ?? 'unknown') as 'permanent' | 'temporary' | 'unknown',
              }))} />
            </div>
            <div className="flex gap-3 mt-3 flex-wrap">
              {(['permanent', 'temporary', 'unknown'] as const).map(s => (
                <span key={s} className="font-mono text-xs text-mid uppercase tracking-wider flex items-center gap-1.5">
                  <span className={`w-2.5 h-2.5 rounded-full inline-block ${s === 'permanent' ? 'bg-amber' : s === 'temporary' ? 'bg-mid' : 'bg-light'}`} />
                  {s}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* Endorsements */}
        {endorsements.length > 0 && (
          <section aria-label="Endorsements" className="mt-10">
            <h2 className="font-serif text-3xl text-ink mb-6">Endorsements</h2>

            {/* Organiser endorsements first */}
            {endorsements.filter((e) => e.kind === 'organiser').map((e) => (
              <div key={e.id} className="mb-6 p-5 border border-light rounded-lg bg-warm">
                <div className="flex items-start gap-3">
                  {e.endorser_avatar_s3_key && (
                    <img
                      src={e.endorser_avatar_s3_key}
                      alt={e.endorser_display_name ?? ''}
                      className="w-10 h-10 rounded-full object-cover flex-none"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      {e.festival_name && (
                        <span className="font-mono text-xs uppercase tracking-widest bg-amber text-ink px-2 py-0.5 rounded">
                          {e.festival_name}
                        </span>
                      )}
                      {e.endorser_display_name && (
                        <span className="font-sans text-sm text-mid">via {e.endorser_display_name}</span>
                      )}
                    </div>
                    {e.body && (
                      <p className="font-serif text-lg text-ink leading-relaxed mt-2">{e.body}</p>
                    )}
                    {e.skills && e.skills.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {e.skills.map((s) => (
                          <span key={s} className="font-mono text-xs uppercase tracking-wide bg-light text-ink px-2 py-0.5 rounded">
                            {s}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {/* Peer endorsements */}
            {endorsements.filter((e) => e.kind === 'peer').length > 0 && (
              <div className="grid gap-4 sm:grid-cols-2">
                {endorsements.filter((e) => e.kind === 'peer').map((e) => (
                  <div key={e.id} className="p-4 border border-light rounded-lg bg-offwhite">
                    <div className="flex items-center gap-3 mb-2">
                      {e.endorser_avatar_s3_key && (
                        <img
                          src={e.endorser_avatar_s3_key}
                          alt={e.endorser_display_name ?? ''}
                          className="w-8 h-8 rounded-full object-cover"
                        />
                      )}
                      <span className="font-sans text-sm font-medium text-ink">
                        {e.endorser_display_name ?? 'Anonymous artist'}
                      </span>
                    </div>
                    {e.body && (
                      <p className="font-serif text-base text-ink leading-relaxed">{e.body}</p>
                    )}
                    {e.skills && e.skills.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {e.skills.map((s) => (
                          <span key={s} className="font-mono text-xs uppercase tracking-wide bg-warm text-mid px-2 py-0.5 rounded">
                            {s}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>

      {isOwner && (
        <OwnerBar
          label="You're viewing your live page"
          editHref="/profile"
          editLabel="Edit profile"
        />
      )}
    </main>
  )
}
