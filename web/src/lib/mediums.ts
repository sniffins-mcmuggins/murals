// Controlled vocabulary for artist mediums. Used by the setup wizard and the
// profile editor. medium_tags stays a free string[] server-side, so artists can
// still "add your own" beyond this list — these are just the quick-pick chips.
export const MEDIUMS = [
  'mural',
  'painting',
  'illustration',
  'stencil',
  'paste-up',
  'sculpture',
  'mixed media',
  'lettering',
  'mosaic',
  'installation',
] as const

export type Medium = (typeof MEDIUMS)[number]
