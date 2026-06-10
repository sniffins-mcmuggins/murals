# web/(public) Spec
**Path:** `web/src/app/(public)/`
**Last updated:** 2026-05-31

## Contract
- Unauthenticated public pages: festival listings, individual festival page, festival map (Leaflet), artist profile pages
- No session required — these pages are indexed and publicly accessible
- Artist profile pages (`/artists/[id]`), public collection pages, and collection image listings all render from the **published snapshot** — the frozen read-model in `profile_snapshots`, not the live draft tables. The API handles the branching (public → snapshot, owner → live); the web layer does not need to distinguish.

## Boundaries
- Does NOT require auth — never redirect to login for these routes
- Does NOT show management UI — public-facing display only
- Does NOT render draft/unpublished content — all artist data shown here comes from the published snapshot; an artist's edits are invisible to public visitors until they call publish-changes

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
2026-06-10 — E29: public artist profile + collections + images pages now render from published snapshot (API-side); added contract note and boundary clarifying draft invisibility.
2026-05-31 — initial spec
