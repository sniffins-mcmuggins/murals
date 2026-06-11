# web/(artist) Spec
**Path:** `web/src/app/(artist)/`
**Last updated:** 2026-05-31

## Contract
- Artist-authenticated pages: profile editor, collections, QR code download, analytics dashboard, applications list, billing/subscription management
- All routes require an authenticated artist session; redirect to `/login` if none
- Typed against the OpenAPI-generated client (`@render/api-client`) — no hand-written fetch calls
- `/profile/preview` — renders the owner's current live DRAFT (not the snapshot); lets the artist preview exactly what a visitor would see after their next publish
- `PublishBar` — persistent bar shown to the profile owner with: "Publish changes" button (calls `POST /profiles/me/publish-changes`), an "unpublished changes" indicator (driven by `has_unpublished_changes`), a "View public profile" link, and a "Preview draft" link to `/profile/preview`

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
- `profile/preview/page.tsx`: server component that fetches live profile data via the owner token (not the public snapshot endpoint); shows a read-only view of the draft. Distinct from the unauthenticated preview-token flow.
- `PublishBar` component reads `has_unpublished_changes` from the owner profile response; only shows the "Publish changes" action when the flag is true. The initial "Go Public" publish is a separate action handled by `PublishHandler`.

## Changelog
2026-06-11 — PR2: the artist `billing/page.tsx` migrated off raw `fetch` to the typed client (`/billing/artist/checkout`, `/billing/portal`) now the endpoints are in the spec. No raw `fetch` to our API remains in this group.
2026-06-10 — upload hooks merged into hooks/useImageUpload (post-confirm step is a caller callback); endorse/endorsements pages migrated to React Query + singleton apiClient; queryFns now throw on API error (isError UI instead of silent empty states).
2026-06-10 — E29: /profile/preview draft route; PublishBar "Publish changes" + unpublished indicator + "View public profile" + "Preview draft" links.
2026-06-07 — E28 M2: apply page (applications/apply/[id]) fetches /profiles/me + collections, pre-fills profile-bound fields via lib/prefill.ts (editable), renders a collection picker for portfolio_collection, and adds a one-click "Apply with my profile" CTA.
2026-06-06 — Added profile setup wizard (profile/setup/) + shared field components; editor reuses them.
2026-05-31 — initial spec
