# web/(public) Spec
**Path:** `web/src/app/(public)/`
**Last updated:** 2026-05-31

## Contract
- Unauthenticated public pages: festival listings, individual festival page, festival map (Leaflet), artist profile pages
- No session required — these pages are indexed and publicly accessible

## Boundaries
- Does NOT require auth — never redirect to login for these routes
- Does NOT show management UI — public-facing display only

## Key Decisions
- **Festival map is a dynamic `'use client'` import**: Leaflet is browser-only; `FestivalMapClient.tsx` uses `next/dynamic({ ssr: false })`
- **Artist profile public-read 404**: the API returns 404 (not 403) for non-public profiles — the web layer should surface a 404 page, not an error page

## Invariants
- Map component MUST use `next/dynamic({ ssr: false })` — importing Leaflet in a server component crashes the Next.js build

## AI Context
- `festivals/`: festival list + individual festival page
- `festivals/[id]/map/FestivalMapClient.tsx`: canonical example of the dynamic import pattern
- `artists/`: public artist profile pages

## Changelog
2026-05-31 — initial spec
