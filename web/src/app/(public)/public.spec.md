# web/(public) Spec
**Path:** `web/src/app/(public)/`
**Last updated:** 2026-05-31

## Contract
- Unauthenticated public pages: festival listings, individual festival page, festival map (Leaflet), artist profile pages
- No session required — these pages are indexed and publicly accessible
- Artist profile pages (`/artists/[id]`), public collection pages, and collection image listings all render from the **published snapshot** — the frozen read-model in `profile_snapshots`, not the live draft tables. The API handles the branching (public → snapshot, owner → live); the web layer does not need to distinguish for the page *content*.
- **Owner-only edit bar:** `/artists/{id}` and `/artists/{id}/collections/{collectionId}` render a shared sticky bar (`components/OwnerBar`) when `isProfileOwner(id)` (from `lib/auth-server`) is true — "Edit profile" → `/profile` on the live page, "Edit collection" → `/collections/{collectionId}` on the collection page, plus a Dashboard link. This is the one place the public layer distinguishes the owner from other viewers; the page *content* stays identical for everyone.

## Boundaries
- Does NOT require auth — never redirect to login for these routes
- Does NOT show management UI — public-facing display only, with one narrow exception: an owner-only sticky bar (gated by `isProfileOwner`) linking the owner *out* to the edit suite. The public pages themselves never render editing controls inline.
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
2026-06-11 — Next 16 fix: `FestivalMap.tsx` default marker icon now imports the shared `lib/leaflet.ts` (bundler-agnostic). The old `(icon as {src}).src` pattern broke under Turbopack — `iconUrl` undefined → Leaflet threw and the map page hit the error boundary. Guarded by the public-visitor map e2e.
2026-06-10 — collection page image grid → CSS-columns masonry (uncropped, no `bg-warm` overflow); headline strip mosaic now `h-full object-cover` + `auto-rows-[16rem]` so spanning cells fill. See `.claude/rules/web-frontend.md` (image-layout trap).
2026-06-10 — owner-only `OwnerBar` on the live artist page + public collection page; gated by `isProfileOwner()` ownership check. Links owner out to `/profile` and `/collections/{id}`.
2026-06-10 — E29: public artist profile + collections + images pages now render from published snapshot (API-side); added contract note and boundary clarifying draft invisibility.
2026-05-31 — initial spec
