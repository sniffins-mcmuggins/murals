# web/(artist) Spec
**Path:** `web/src/app/(artist)/`
**Last updated:** 2026-05-31

## Contract
- Artist-authenticated pages: profile editor, collections, QR code download, analytics dashboard, applications list, billing/subscription management
- All routes require an authenticated artist session; redirect to `/login` if none
- Typed against the OpenAPI-generated client (`@render/api-client`) — no hand-written fetch calls

## Boundaries
- Does NOT contain organiser UI — that lives in `web/src/app/dashboard/`
- Does NOT contain public-facing pages — those are in `web/src/app/(public)/`

## Key Decisions
- **App Router with React Server Components**: data-fetching pages use `async` server components; interactive sections are `'use client'` components
- **`API_URL` vs `NEXT_PUBLIC_API_URL`**: server components use `process.env.API_URL` (`http://api:8080` in Docker) — never `NEXT_PUBLIC_API_URL` (which resolves to `localhost:8080` from inside the container)
- **Dynamic imports with `ssr: false`** (e.g. the map editor) MUST be in a `'use client'` wrapper, not directly in a `page.tsx` — causes 500s otherwise

## Invariants
- No raw `fetch()` calls — use the typed API client from `@render/api-client`
- Server-side data fetching MUST use `API_URL` not `NEXT_PUBLIC_API_URL`

## AI Context
- Route structure mirrors the API surface — `analytics/`, `applications/`, `billing/`, `collections/`, `profile/`
- `layout.tsx`: artist shell layout with navigation
- See e2e-debugging rule for the ECONNREFUSED / `NEXT_PUBLIC_API_URL` pitfall
- `profile/setup/`: first-run wizard (`ProfileWizard`) — one `'use client'` component, internal step index, auto-saves each step via PATCH /profiles/me. `profile/page.tsx` redirects here when `setup_completed_at` is null.
- Shared field components in `web/src/components/`: `MediumPicker`, `SupportLinkField`, `ImageSlot` — used by BOTH the wizard and `ProfileForm`. Edit the shared component, not one copy.

## Changelog
2026-06-07 — E28 M2: apply page (applications/apply/[id]) fetches /profiles/me + collections, pre-fills profile-bound fields via lib/prefill.ts (editable), renders a collection picker for portfolio_collection, and adds a one-click "Apply with my profile" CTA.
2026-06-06 — Added profile setup wizard (profile/setup/) + shared field components; editor reuses them.
2026-05-31 — initial spec
