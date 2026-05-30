import type { MetadataRoute } from 'next'
import { apiClient } from '@/lib/api'
import { absoluteUrl } from '@/lib/site'

// Revalidate the sitemap hourly so newly-published profiles/festivals get
// crawled without a redeploy.
export const revalidate = 3600

// The public-profiles endpoint is paginated; pull a generous first page. SEO
// for a launch-stage platform doesn't need full pagination here.
const PROFILE_PAGE_SIZE = 100

type ProfileEntry = { id?: string; updated_at?: string }
type FestivalEntry = { slug?: string; updated_at?: string }

// Normalise the paginated response — tolerate either a bare array or a wrapper
// object ({ profiles | items | data: [...] }) so we don't break if the API
// envelope shape shifts.
function asArray<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[]
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>
    for (const key of ['profiles', 'items', 'data', 'results']) {
      if (Array.isArray(obj[key])) return obj[key] as T[]
    }
  }
  return []
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [
    { url: absoluteUrl('/'), changeFrequency: 'daily', priority: 1 },
  ]

  // Public artist profiles. Failures must not break the sitemap — degrade to
  // the static routes we already have.
  try {
    const { data } = await apiClient.GET('/public/profiles', {
      params: { query: { per_page: PROFILE_PAGE_SIZE } },
    })
    for (const profile of asArray<ProfileEntry>(data)) {
      if (!profile?.id) continue
      entries.push({
        url: absoluteUrl(`/artists/${profile.id}`),
        lastModified: profile.updated_at ? new Date(profile.updated_at) : undefined,
        changeFrequency: 'weekly',
        priority: 0.8,
      })
    }
  } catch {
    // ignore — covered by the empty-data path
  }

  // Public festivals (cheap, same shape).
  try {
    const { data } = await apiClient.GET('/public/festivals', {})
    for (const festival of asArray<FestivalEntry>(data)) {
      if (!festival?.slug) continue
      entries.push({
        url: absoluteUrl(`/festivals/${festival.slug}`),
        lastModified: festival.updated_at ? new Date(festival.updated_at) : undefined,
        changeFrequency: 'weekly',
        priority: 0.6,
      })
    }
  } catch {
    // ignore
  }

  return entries
}
