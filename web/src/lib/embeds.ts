export type EmbedProvider = 'youtube' | 'vimeo' | 'sketchfab'

export type EmbedInfo = {
  provider: EmbedProvider
  embedUrl: string
  thumbnailUrl?: string
}

// Allowlist of origins we ever set as an iframe src. Never inject a raw user URL.
export const EMBED_ORIGINS = [
  'https://www.youtube.com',
  'https://player.vimeo.com',
  'https://sketchfab.com',
] as const

const RE_YOUTUBE = /(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/
const RE_VIMEO = /vimeo\.com\/(?:video\/)?(\d+)/
const RE_SKETCHFAB = /sketchfab\.com\/(?:3d-models\/[A-Za-z0-9-]*-|models\/)([A-Za-z0-9]+)/

export function parseEmbed(raw: string): EmbedInfo | null {
  const url = (raw ?? '').trim()
  if (!url) return null

  const yt = url.match(RE_YOUTUBE)
  if (yt) {
    const id = yt[1]
    return {
      provider: 'youtube',
      embedUrl: `https://www.youtube.com/embed/${id}`,
      thumbnailUrl: `https://img.youtube.com/vi/${id}/hqdefault.jpg`,
    }
  }

  const vimeo = url.match(RE_VIMEO)
  if (vimeo) {
    return { provider: 'vimeo', embedUrl: `https://player.vimeo.com/video/${vimeo[1]}` }
  }

  const sk = url.match(RE_SKETCHFAB)
  if (sk) {
    return { provider: 'sketchfab', embedUrl: `https://sketchfab.com/models/${sk[1]}/embed` }
  }

  return null
}
