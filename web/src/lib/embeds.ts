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

// Path/param matchers. The HOST is validated separately via URL parsing so an
// attacker-controlled host (e.g. https://evil.com/youtube.com/embed/ID) can
// never match. Keep these rules in sync with api/internal/festival/embed.go.
const RE_YT_ID = /^[A-Za-z0-9_-]{11}$/
const RE_YT_EMBED_PATH = /^\/embed\/([A-Za-z0-9_-]{11})/
const RE_YT_BE_PATH = /^\/([A-Za-z0-9_-]{11})/
const RE_VIMEO_PATH = /^\/(?:video\/)?(\d+)/
const RE_SKETCHFAB_PATH = /^\/(?:3d-models\/[A-Za-z0-9-]*-|models\/)([A-Za-z0-9]+)/

function youtube(id: string): EmbedInfo {
  return {
    provider: 'youtube',
    embedUrl: `https://www.youtube.com/embed/${id}`,
    thumbnailUrl: `https://img.youtube.com/vi/${id}/hqdefault.jpg`,
  }
}

export function parseEmbed(raw: string): EmbedInfo | null {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return null

  let u: URL
  try {
    u = new URL(trimmed)
  } catch {
    return null
  }
  // Reject javascript:, data:, etc. — only real web URLs are embeddable.
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null

  const host = u.hostname.replace(/^www\./, '')

  if (host === 'youtube.com' || host === 'm.youtube.com') {
    const v = u.searchParams.get('v')
    if (v && RE_YT_ID.test(v)) return youtube(v)
    const embed = u.pathname.match(RE_YT_EMBED_PATH)
    return embed ? youtube(embed[1]) : null
  }

  if (host === 'youtu.be') {
    const m = u.pathname.match(RE_YT_BE_PATH)
    return m ? youtube(m[1]) : null
  }

  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const m = u.pathname.match(RE_VIMEO_PATH)
    return m ? { provider: 'vimeo', embedUrl: `https://player.vimeo.com/video/${m[1]}` } : null
  }

  if (host === 'sketchfab.com') {
    const m = u.pathname.match(RE_SKETCHFAB_PATH)
    return m ? { provider: 'sketchfab', embedUrl: `https://sketchfab.com/models/${m[1]}/embed` } : null
  }

  return null
}
