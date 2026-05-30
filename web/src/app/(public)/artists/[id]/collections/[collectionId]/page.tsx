import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { apiClient } from '@/lib/api'
import { absoluteUrl } from '@/lib/site'

interface CollectionPageProps {
  params: Promise<{ id: string; collectionId: string }>
}

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

export async function generateMetadata({ params }: CollectionPageProps): Promise<Metadata> {
  const { id, collectionId } = await params

  const [profileRes, collectionRes] = await Promise.all([
    apiClient.GET('/profiles/{profileID}', { params: { path: { profileID: id } } }),
    apiClient.GET('/collections/{collectionID}', { params: { path: { collectionID: collectionId } } }),
  ])

  if (!collectionRes.data || !profileRes.data) {
    return { title: 'Collection not found | Render' }
  }

  const collection = collectionRes.data
  const profile = profileRes.data
  const title = `${collection.name} — ${profile.display_name} | Render`
  const description =
    collection.description || `${collection.name} by ${profile.display_name} on Render`
  const canonical = absoluteUrl(`/artists/${id}/collections/${collectionId}`)
  const image = collection.cover_s3_key || profile.avatar_s3_key || undefined

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      type: 'article',
      title,
      description,
      url: canonical,
      siteName: 'Render',
      images: image ? [{ url: image, alt: collection.name }] : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: image ? [image] : undefined,
    },
  }
}

export default async function CollectionPage({ params }: CollectionPageProps) {
  const { id, collectionId } = await params

  const [profileRes, collectionRes, imagesRes] = await Promise.all([
    apiClient.GET('/profiles/{profileID}', { params: { path: { profileID: id } } }),
    apiClient.GET('/collections/{collectionID}', { params: { path: { collectionID: collectionId } } }),
    apiClient.GET('/collections/{collectionID}/images', { params: { path: { collectionID: collectionId } } }),
  ])

  if (collectionRes.response.status === 404 || !collectionRes.data) {
    notFound()
  }

  const profile = profileRes.data
  const collection = collectionRes.data
  const images = imagesRes.data ?? []

  return (
    <main className="min-h-screen bg-offwhite">
      <div className="max-w-4xl mx-auto px-6 py-12">
        <div className="mb-8">
          <Link
            href={`/artists/${id}`}
            className="font-mono text-xs uppercase tracking-widest text-mid hover:text-ink transition-colors"
          >
            ← {profile?.display_name ?? 'Artist'}
          </Link>
        </div>

        <header className="mb-10">
          <div className="flex items-start gap-4 mb-4">
            <h1 className="font-serif text-5xl text-ink flex-1">{collection.name}</h1>
            <span
              className={`font-mono text-xs uppercase tracking-widest px-2 py-0.5 rounded shrink-0 mt-3 ${statusColour[collection.status] ?? 'bg-warm text-mid'}`}
            >
              {statusLabel[collection.status] ?? collection.status}
            </span>
          </div>
          {collection.description && (
            <p className="font-sans text-mid leading-relaxed max-w-2xl">{collection.description}</p>
          )}
        </header>

        {images.length === 0 ? (
          <p className="font-sans text-mid">No images in this collection yet.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {images.map((img) => (
              <div key={img.id} className="overflow-hidden rounded-lg bg-warm border border-light">
                <img
                  src={img.cdn_url}
                  alt=""
                  className="w-full h-auto"
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
