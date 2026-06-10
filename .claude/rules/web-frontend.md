---
paths:
  - "web/**"
---

# Web frontend standards & gotchas

The Next.js 15 App Router platform (React 19, TypeScript, Tailwind v4). This is
the in-context working knowledge for `web/`. Route-group `*.spec.md` files are the
binding contract — read the relevant one before changing a route group.

## Server vs Client Components

- **Server Component by default.** No `'use client'` → runs on the server, can be
  `async`, reads cookies, ships zero JS. Cannot use `useState`/`useEffect`/
  `onClick`/browser APIs. Add `useState` to a server file and you get a cryptic
  error — you forgot `'use client'`.
- **Push `'use client'` to the smallest leaf** that needs interactivity. Preferred
  pattern: `async` Server Component fetches data → passes as props to a small
  client component for the interactive bits (copy `(artist)/profile/page.tsx` →
  `ProfileForm`). Whole-page client + React Query is fine for highly interactive
  pages (copy `(artist)/applications/page.tsx`).
- **`next/dynamic({ ssr: false })` must live in a `'use client'` file.** Used for
  Leaflet maps. Put it directly in a Server Component `page.tsx` and the *entire*
  dev server 500s. Pattern to copy: `(public)/festivals/[id]/map/FestivalMapClient.tsx`.

## Talking to the backend

- **Never hand-write `fetch`** to the API. Use the typed `apiClient` from
  `@/lib/api` (generated from the OpenAPI spec). Responses are `{ data, error,
  response }` — always check `res.error`/`res.data` before use.
- **Entity types come from the schema:** `import type { components } from
  '@render/api-client'` → `components['schemas']['Application']`. Don't re-declare
  shapes.
- **Server-side env:** server code must use `process.env.API_URL` (`http://api:8080`
  in Docker), never `NEXT_PUBLIC_API_URL` (`localhost:8080` → `ECONNREFUSED` from
  inside the container → every page 500s). Just import from `@/lib/api` /
  `@/lib/auth-server`; don't read `process.env` yourself.
- **Authed server calls:** the singleton `apiClient` has no cookie. On the server
  use `getSessionUser()` / `requireAuth()` from `@/lib/auth-server`, or for other
  authed data make a per-request client injecting the cookie via `.use({ onRequest })`
  (copy `profile/page.tsx`). `requireAuth()` redirects to `/login` if not logged in.
- **Change the API shape → regenerate the client** (`task openapi:gen` from repo
  root) and commit it, or CI's "OpenAPI — no drift" job goes red.

## Styling

- **Design tokens only** (defined in `src/app/globals.css`): `text-ink`,
  `bg-offwhite`, `bg-warm`, `bg-amber`, `text-clay`, `text-mid`, `border-light`.
  Fonts: `font-serif` (Cormorant — headings/bios), `font-sans` (DM Sans — body),
  `font-mono` (DM Mono — uppercase badges/stats). No raw hex, no new fonts without
  a design reason. Full palette in `.claude/rules/design-system.md`.

## Image layout: the grid-stretch / `h-auto` trap

**Symptom:** an image tile shows its container background (`bg-warm` grey, or the
page background) bleeding below the image — the picture doesn't fill its box.

**Cause:** CSS grid cells default to `align-items: stretch`, so each cell grows to
the **tallest item in its row**. An `<img>` with `w-full h-auto` only takes its
*natural* aspect-ratio height, so any image shorter than the row's tallest leaves
the cell background exposed below it. Same failure for a `row-span-2` cell whose
image has a fixed `h-64` — the image can't fill the doubled cell.

Pick the pattern by intent:

1. **Masonry — full uncropped images (art galleries).** CSS columns, not grid;
   each tile hugs its image:
   ```tsx
   <div className="columns-2 sm:columns-3 gap-3">
     {images.map((img) => (
       <div key={img.id} className="mb-3 break-inside-avoid overflow-hidden rounded-lg border border-light">
         <img src={img.cdn_url} alt="" className="block w-full h-auto" />
       </div>
     ))}
   </div>
   ```
   Live: `(public)/artists/[id]/collections/[collectionId]/page.tsx`.

2. **Uniform tiles — even grid, cropping OK.** Fix the aspect, `object-cover`:
   ```tsx
   <div className="aspect-square overflow-hidden rounded-lg border border-light bg-warm">
     <img className="w-full h-full object-cover" … />
   </div>
   ```
   Used by the artist collection **editor** (`(artist)/collections/[id]/page.tsx`),
   which must stay a grid for dnd-kit reordering.

3. **Fixed-height mosaic with spanning cells.** A `row-span-2` cell needs its image
   `h-full object-cover`, and pin row height with `auto-rows-[16rem]` so spanning
   cells double cleanly. Live: headline strip in `(public)/artists/[id]/page.tsx`.

**Rules of thumb:**
- Add `block` to any full-width `<img>` (kills the inline baseline gap).
- Never rely on default `object-fit: fill` — it distorts. Use `cover`, or `h-auto`
  in masonry.
- A `bg-*` placeholder behind an `h-auto` image in a grid WILL show as overflow.
- New/changed galleries: eyeball in the browser with **mixed-orientation images** —
  the bug only appears when a row mixes a tall portrait with a short landscape.

## Shared components — edit, don't fork

`MediumPicker.tsx`, `SupportLinkField.tsx`, `ImageSlot.tsx` are used by **both**
the profile wizard and the profile editor. Changing one changes both — that's
intentional. The image-upload choreography (presign → PUT MinIO/S3 → confirm →
attach) lives in `hooks/useUploadImage.ts`; reuse it, don't reimplement.

## Before pushing

- `task lint` (eslint + `tsc --noEmit`) and `task test` (Vitest) from `web/` — CI
  runs these in order and fails the PR on any.
- Component logic → Vitest (`src/__tests__/`, mirrors `src/`, query by role/label).
  Full cross-page journey → Playwright (`e2e/`, needs `task up`).
- If you changed a route group's behaviour, add a changelog line to its `*.spec.md`
  in the same PR.

## Docker bind-mount trap (worktrees)

The Compose stack bind-mounts the **main repo** (`/Users/adampowis/workspace/murals`),
not a worktree. Editing web code in a worktree won't hot-reload the running
container unless you also edit the main-repo path. Symptom: save, nothing reloads.
Working directly in the main repo? Ignore this.
