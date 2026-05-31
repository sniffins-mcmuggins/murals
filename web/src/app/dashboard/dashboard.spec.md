# web/dashboard Spec
**Path:** `web/src/app/dashboard/`
**Last updated:** 2026-05-31

## Contract
- Organiser-authenticated pages: festival management, application review, reviewer management, spot map editor, rubric scoring
- All routes require an authenticated organiser session
- Typed against `@render/api-client`

## Boundaries
- Does NOT contain artist management UI — artists manage their own profiles in `(artist)/`
- Does NOT contain public pages

## Key Decisions
- **Map editor uses Leaflet with `ssr: false`**: `FestivalMapClient.tsx` is a `'use client'` dynamic import — the map cannot be SSR'd
- **`[data-testid="spot-panel"]`**: the spot edit panel is a custom side panel, NOT a Leaflet popup — Playwright tests target `spot-panel`, not `.leaflet-popup`

## Invariants
- Map editor components MUST be dynamic imports with `ssr: false` inside a `'use client'` wrapper
- Spot panel tests MUST target `[data-testid="spot-panel"]`, not Leaflet popup selectors

## AI Context
- `festivals/`: festival CRUD + status management
- `applications/`: review queue, scoring, waitlist, reorder
- `layout.tsx`: organiser shell
- See e2e-debugging rule for the spot-panel / Leaflet popup selector trap

## Changelog
2026-05-31 — initial spec
