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
- **Spot panel has two `<select>`s**: Artist (`aria-label="Artist"`) and Mural status (`aria-label="Mural status"`). Tests MUST disambiguate by `getByLabel(...)` — a bare `getByRole('combobox')` / `spot-panel select` is a strict-mode violation

## Invariants
- Map editor components MUST be dynamic imports with `ssr: false` inside a `'use client'` wrapper. This includes the **public** artist mural-history map (`(public)/artists/[id]/MuralMapClient.tsx`), not just the organiser editor — `ssr: false` in a Server Component is a compile error that 500s the whole `next dev` app
- Spot panel tests MUST target `[data-testid="spot-panel"]`, not Leaflet popup selectors, and MUST pick a specific select by `aria-label` (Artist vs Mural status)

## AI Context
- `festivals/`: festival CRUD + status management
- `applications/`: review queue, scoring, waitlist, reorder
- `layout.tsx`: organiser shell
- See e2e-debugging rule for the spot-panel / Leaflet popup selector trap

## Changelog
2026-05-31 — initial spec
2026-06-05 — spot panel gained a Mural status select (now two selects → disambiguate tests by aria-label); ssr:false-in-client-wrapper invariant extended to the public mural-history map
2026-06-11 — PR2: dashboard `page.tsx` now uses `createAuthedServerClient()` + the typed client for `/me/summary` and `/beta/me/invites` (was hand-rolled `fetch` + hand-declared entity types); types come from `components['schemas']` (`MeSummary`, `BetaInvite`). PR3: the organiser map editor split into `mapIcons.ts` / `mapHelpers.tsx` / `SpotPanel.tsx` / `MapEditorClient.tsx`; the applications board's data layer moved to `useApplicationReview(festivalId)`. Behaviour unchanged.
2026-06-11 — Next 16 fix: `mapIcons.ts` default marker icon now imports the shared `lib/leaflet.ts` (bundler-agnostic) instead of `(icon as {src}).src`, which broke under Turbopack (iconUrl undefined → Leaflet threw, map editor hit the error boundary).
