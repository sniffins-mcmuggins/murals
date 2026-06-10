# Artist live-page ↔ edit-suite round trip

**Date:** 2026-06-10
**Area:** `web/`

## Problem

An artist can edit their profile (`/profile`, the edit suite) but the dashboard
has no link to see how that profile looks live to the public. And once an artist
lands on their own live page (`/artists/{id}`), there's no way back into the edit
suite — they have to navigate manually. Close the loop in both directions.

## Goals

1. From the dashboard, an artist can click straight through to their own public
   live page.
2. On that live page, the owner (and only the owner) sees a way back into the
   edit suite.

## Non-goals

- No new API endpoints. Everything uses existing routes.
- No change to what anonymous visitors or other logged-in artists see — the
  live page is byte-for-byte identical for them.
- No editing inline on the live page; the button just navigates to `/profile`.

## Design

### 1. Ownership helper — `web/src/lib/auth-server.ts`

Add `getOwnProfileId(): Promise<string | null>`.

- If there's no `session` cookie, return `null` immediately (no fetch).
- Otherwise build a per-request cookie-authed client (same pattern as the
  existing `getSessionUser()`), call `GET /profiles/me`, and return `data?.id ?? null`.
- A 401 / missing profile yields `null`.

Rationale: the public page is a server component using the unauthenticated
singleton client. Ownership can only be known by an authed call, and the profile
`id` (not the user `id`) is what the route is keyed on, so `/profiles/me` is the
right call. Reuses the established authed-client pattern rather than inventing a
new one.

### 2. Sticky owner bar — `web/src/app/(public)/artists/[id]/page.tsx`

- After fetching the profile, compute `const isOwner = (await getOwnProfileId()) === id`.
- When `isOwner`, render a sticky bar fixed to the bottom of the viewport:
  - Text: "You're viewing your live page" (`font-mono`, mid).
  - An "Edit profile" button → `/profile` (amber, matches existing CTA styling).
  - A secondary "Dashboard" link → `/dashboard`.
- The bar is server-rendered — it only contains `Link`s, no client state.
- Add bottom padding (`pb-28`) to the page container so the fixed bar never
  overlaps the last section.

The bar is omitted entirely for anonymous visitors and non-owners.

### 3. Dashboard "View live page" link — `web/src/app/dashboard/page.tsx`

In the "Your art" section, when `summary.artist_profile` exists, add a "View
live page" link → `/artists/{summary.artist_profile.id}` next to the existing
"Manage profile" link. Two links: edit and view-as-public.

## Testing

- Browser e2e (artist-onboarding spec or similar): as the profile owner, visit
  `/artists/{ownId}` and assert the owner bar + "Edit profile" link is visible
  and points to `/profile`. As an anonymous visitor, assert the bar is absent.
- Dashboard: assert the "View live page" link is present and resolves to the
  owner's `/artists/{id}` once a profile exists.

## Files touched

- `web/src/lib/auth-server.ts` — new `getOwnProfileId()` helper.
- `web/src/app/(public)/artists/[id]/page.tsx` — ownership check + owner bar + bottom padding.
- `web/src/app/dashboard/page.tsx` — "View live page" link.
- `web/src/app/(public)/public.spec.md` — note the owner-only bar (observable behaviour change).
