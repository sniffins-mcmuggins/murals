# Epic — Kanban Card Visuals & Profile Access

**Date:** 2026-06-04
**Status:** Design approved, ready for implementation planning
**Depends on:** `2026-06-04-reviewer-scoring-round-design.md` Phase 1 (anonymous review must be
gone before the profile button can always show).

## Summary

Make the application cards and detail panel feel like they're about *people and their work*,
not rows in a database. Three changes, all on the organiser/reviewer applications view:

1. **Real avatar image** on each kanban card (and reviewer-queue row) instead of an initials
   block.
2. The **average score** sits beside the avatar (already present — keep, verify alongside the
   new avatar).
3. A **"View full profile ↗"** button in the application slide-over that opens the artist's
   public profile in a **new tab**.

Explicitly *not* doing: embedding the full profile inside the panel, or switching the
slide-over to a centered modal. The slide-over stays exactly as it is today; the profile lives
at its existing public page and opens in a new tab. (This was the user's revision to an earlier
"profile-below" mockup — simpler, reuses the public profile page, no duplicate profile UI.)

## Current state

- `ApplicationCard.tsx`: avatar is an initials circle (`bg-clay` with `initials(name)`); it
  already renders `★ {avg_score}` top-right when `score_count > 0`. Anonymous mode shows `?`.
- `ApplicationSlideOver.tsx`: header avatar is also initials; shows tags, location, decision
  buttons, rubric, panel average, answers, notes. No link to the public profile.
- `ApplicationArtist` (OpenAPI) carries `display_name`, `avatar_s3_key`, `medium_tags`,
  `location_label` — but **no `id`**, so there's currently nothing to build a profile URL from.
- Public profile page already exists at `web/src/app/(public)/artists/[id]/page.tsx`.

## Scope

### 1. Avatar image on cards and rows

- **API**: `avatar_s3_key` already ships on `ApplicationArtist`. No backend change for the
  image itself.
- **Web**: in `ApplicationCard.tsx`, render the artist's avatar from `avatar_s3_key` via the
  existing image-URL helper (CDN base in prod, public MinIO locally — reuse whatever the public
  profile/artist components already use; do not hand-roll a URL). **Fall back to the initials
  circle** when `avatar_s3_key` is null. Apply the same treatment to the new `ReviewerQueue`
  rows (Epic 1, Phase 2).
- Keep the existing `★ {avg_score}` element; confirm it still reads well next to a photo.

### 2. Average score beside avatar

Already implemented on the card. No change beyond visual verification against the new avatar.
In the slide-over the "Panel average" block already exists and stays.

### 3. "View full profile ↗" button

- **API**: add `id` (the artist **profile** id) to the `ApplicationArtist` schema and populate
  it in the application response builders (`review.go`). This is the value the button links to.
  - Carry `id` into the **reviewer** response too (Epic 1 Phase 2 trims decision fields, but the
    artist summary — including `id` — stays, so reviewers can open the profile).
- **Web**: in `ApplicationSlideOver.tsx` header, add a button/link:
  - `href={`/artists/${artist.id}`}`, `target="_blank"`, `rel="noopener noreferrer"`.
  - Label "👤 View full profile ↗". Styled per design system (`bg-warm border-light`, see mockup).
  - Render for **both** organisers and reviewers. Hidden only when `artist.id` is absent.
- With anonymous review removed (Epic 1 Phase 1), there is no identity-masking case left to
  suppress the button — it always shows when there's a profile to open.

## Edge cases

- **No avatar uploaded**: fall back to initials circle (existing `initials()` helper).
- **Missing `artist.id`**: don't render the profile button (defensive; shouldn't happen once
  the field is populated).
- **New tab**: always `rel="noopener noreferrer"`; the organiser/reviewer stays on the review
  view, profile opens separately.

## Testing

- **Browser (Playwright)**: card shows an `<img>` avatar when the seeded artist has one, and
  initials when not; slide-over "View full profile" link has the correct `/artists/{id}` href
  and `target="_blank"`.
- **API gate (Vitest)**: `ApplicationArtist.id` is present and equals the artist profile id in
  both the organiser and reviewer application responses.

## Spec maintenance

- Update `api/internal/festival/festival.spec.md` AI Context to note `ApplicationArtist` now
  carries `id` (artist profile id) for profile linking.
- If the OpenAPI change ripples to `@render/api-client`, regenerate the client.
```
