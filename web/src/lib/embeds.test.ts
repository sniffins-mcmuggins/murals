import { describe, it, expect } from 'vitest'
import { parseEmbed } from '@/lib/embeds'

describe('parseEmbed', () => {
  it('parses youtube watch / short / embed URLs', () => {
    for (const url of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ',
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
    ]) {
      expect(parseEmbed(url)).toEqual({
        provider: 'youtube',
        embedUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
        thumbnailUrl: 'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
      })
    }
  })

  it('parses vimeo URLs', () => {
    expect(parseEmbed('https://vimeo.com/123456789')).toEqual({
      provider: 'vimeo',
      embedUrl: 'https://player.vimeo.com/video/123456789',
    })
  })

  it('parses sketchfab URLs', () => {
    expect(parseEmbed('https://sketchfab.com/3d-models/a-cool-model-abc123DEF')).toEqual({
      provider: 'sketchfab',
      embedUrl: 'https://sketchfab.com/models/abc123DEF/embed',
    })
  })

  it('parses youtube watch URLs with extra query params and m. host', () => {
    expect(parseEmbed('https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=42s')).toEqual(youtubeInfo)
  })

  it('returns null for empty, non-url, and unknown providers', () => {
    expect(parseEmbed('')).toBeNull()
    expect(parseEmbed('   ')).toBeNull()
    expect(parseEmbed('not a url')).toBeNull()
    expect(parseEmbed('https://example.com/video/1')).toBeNull()
    expect(parseEmbed('https://youtube.com')).toBeNull()
  })

  it('rejects attacker-controlled hosts and non-web schemes (host is anchored)', () => {
    expect(parseEmbed('https://evil.com/youtube.com/embed/dQw4w9WgXcQ')).toBeNull()
    expect(parseEmbed('https://evil.com/path?x=youtu.be/dQw4w9WgXcQ')).toBeNull()
    expect(parseEmbed('https://notyoutube.com/watch?v=dQw4w9WgXcQ')).toBeNull()
    expect(parseEmbed('https://my-vimeo.com/123456789')).toBeNull()
    expect(parseEmbed('javascript:alert(1)//youtu.be/dQw4w9WgXcQ')).toBeNull()
    expect(parseEmbed('data:text/html,vimeo.com/123456789')).toBeNull()
  })
})

const youtubeInfo = {
  provider: 'youtube' as const,
  embedUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
  thumbnailUrl: 'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
}
