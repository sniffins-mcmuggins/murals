# Anonymous Review — Design Spec

**Date:** 2026-05-29
**Status:** Draft
**Issue:** #158
**Scope:** Add an `anonymous_review` toggle to the application form. When on, reviewers see only the work and answers — artist name, avatar, and location are stripped until they've scored. Owner view always shows identity.

---

## Overview

Blind review eliminates a documented bias source in selection panels: reviewers who recognise an artist's name score differently than they would on the work alone. This feature gives organisers a one-checkbox path to equitable selection with no manual redaction.

The mechanism is deliberately simple: a `bool` column on `application_forms`, enforced at the API response layer for reviewer-scoped list calls. The reveal is passive — once a reviewer's `my_score` is set (non-null), the next fetch returns full identity automatically. No separate "reveal" endpoint, no new table, no extra round-trip.

**Owner view is never affected.** Owners always see full identity regardless of the toggle.

---

## 1. Database

**Migration:** `db/migrations/000012_anonymous_review.up.sql`

```sql
ALTER TABLE application_forms
  ADD COLUMN anonymous_review bool NOT NULL DEFAULT false;
```

**Down migration** (`000012_anonymous_review.down.sql`):

```sql
ALTER TABLE application_forms DROP COLUMN anonymous_review;
```

Per `sqlc-and-schema.md`: adding a column to `application_forms` means every `row.Scan(&i.…)` in `api/internal/sqlcdb/application_forms.sql.go` must list the new field. Grep-verify after `task db:generate`:

```bash
grep -c '&i\.' api/internal/sqlcdb/application_forms.sql.go   # must equal column count (now 9)
```

`DEFAULT false` makes the migration safe on existing rows with no backfill.

---

## 2. SQL Queries

No new queries. The `form.AnonymousReview` field is already fetched as part of the existing `GetApplicationFormByFestival` and `GetApplicationFormByID` queries once the sqlc model is regenerated.

The `UpdateApplicationForm` query (used by the form PATCH endpoint) must gain `anonymous_review` in its SET clause. After `task db:generate`, verify the generated update query includes the new column.

---

## 3. API

### 3a. Form PATCH — enable the toggle

**`PATCH /festivals/{festivalID}/form`** already accepts optional fields (`open_at`, `close_at`, `max_applications`, `fields`). Extend the request body and handler to accept `anonymous_review *bool`:

```go
type patchFormRequest struct {
    Fields           *[]formField `json:"fields"`
    OpenAt           *time.Time   `json:"open_at"`
    CloseAt          *time.Time   `json:"close_at"`
    MaxApplications  *int         `json:"max_applications"`
    AnonymousReview  *bool        `json:"anonymous_review"` // new
}
```

Owner-only (existing gate). `nil` means "don't change". No other validation needed — it's a boolean toggle.

The `GET /festivals/{festivalID}/form` response (owner-only) gains `"anonymous_review": bool`. The public submission form endpoint (if one exists for artists) does not need to expose this field.

### 3b. Application list — identity stripping

The list handler in `api/internal/festival/review.go` currently builds `applicationResponse` via `toEnrichedReviewerRow` for reviewers and `toEnrichedResponse` for owners. After building each response, apply a post-processing step:

```go
// shouldAnonymise returns true when the caller is a reviewer,
// anonymous_review is on, and they haven't scored this application yet.
func shouldAnonymise(isReviewer, formAnonymousReview bool, myScore *int32) bool {
    return isReviewer && formAnonymousReview && myScore == nil
}
```

When true, zero out the identity fields on the already-built `applicationResponse` and set `IdentityHidden: true`:

```go
if shouldAnonymise(isReviewer, form.AnonymousReview, resp.MyScore) {
    resp.Artist = &artistSummary{
        DisplayName:   "",        // stripped
        AvatarS3Key:   nil,       // stripped
        MediumTags:    resp.Artist.MediumTags, // kept — describes the work, not the person
        LocationLabel: nil,       // stripped
    }
    resp.IdentityHidden = true
}
```

`MediumTags` is intentionally kept: it describes the type of work (spray paint, mosaic…) not the individual. `Answers` are kept: that is the work under review. `Shortlisted`/`ReviewFlag` are owner-internal and are already owner-only in practice. Notes are kept: they're panel-internal and don't systematically reveal the artist's name.

### 3c. Response shape change

`applicationResponse` gains one new field:

```go
type applicationResponse struct {
    // …existing fields…
    IdentityHidden bool `json:"identity_hidden"`
}
```

`identity_hidden` is `false` for all owner responses and all reviewer responses where anonymous mode is off or the reviewer has already scored. It is `true` only when the strip has been applied.

This field gives the frontend an unambiguous signal to render the "Score to reveal identity" prompt, rather than inferring from null fields.

### 3d. OpenAPI

Regenerate `openapi/generated/client.ts` after the API change. The `Application` schema gains `identity_hidden: boolean`. The `ApplicationArtist` (mapped from `artistSummary`) fields `display_name`, `avatar_s3_key`, `location_label` were already nullable in the OpenAPI schema — no type changes needed there; `identity_hidden` is the discriminator the frontend uses.

---

## 4. Frontend (web)

### 4a. Form settings toggle

The festival form editor page (`web/src/app/organiser/festivals/[id]/form/page.tsx` or equivalent) gains a toggle for anonymous review. Owner-only page (already gated). Render as a labelled checkbox with descriptive copy:

> **Anonymous review** — Reviewers see only the work and answers. Artist name, avatar, and location are hidden until they've scored.

On change: `PATCH /festivals/{festivalID}/form` with `{ anonymous_review: true/false }`. Optimistic UI (flip immediately, rollback on error).

### 4b. ApplicationCard — anonymous placeholder

When `application.identity_hidden === true`:
- Replace the avatar initials with a generic icon or `?` placeholder
- Replace the artist name with `"Anonymous artist"`
- Hide the location label
- Show a subtle prompt: `"Score to reveal identity"` beneath the star control (replaces the normal location/tag line)

When `identity_hidden` transitions from `true` to `false` (after the reviewer scores and the query refetches), the card naturally renders the real name/avatar — no special handling needed.

### 4c. ApplicationSlideOver — anonymous mode

Same logic: when `identity_hidden === true`, the slide-over header shows `"Anonymous artist"` and a `?` avatar circle. The answers section and score control render normally. After scoring, the slide-over re-fetches via the parent's `invalidateQueries` cycle and the full identity appears.

No `identity_hidden`-specific branching in the slide-over beyond the header — the star control and panel-average section are already wired correctly.

### 4d. No reviewer notification needed

The reveal is silent — the reviewer simply sees the name appear after they score. No toast or animation is required; the name appearing in a previously anonymous card is self-explanatory.

---

## 5. Testing

### Unit (Vitest)

**`ApplicationCard` additions:**
- `identity_hidden=true, my_score=null` → name shows `"Anonymous artist"`, avatar shows placeholder, `"Score to reveal identity"` prompt visible.
- `identity_hidden=false` (after scoring) → real name renders normally.

**`ApplicationSlideOver` additions:**
- `identity_hidden=true` → header shows placeholder name.
- `identity_hidden=false` → header shows real name.

### API e2e (`e2e/api/`)

New file `e2e/api/anonymous-review.test.ts` (or added to `reviewer-panellist.test.ts`):

- **Auth probe:** `PATCH /festivals/{id}/form` with `{ anonymous_review: true }` by non-owner reviewer → `403`.
- **Toggle:** owner enables `anonymous_review`; verify `GET form` returns `anonymous_review: true`.
- **Stripping:** with `anonymous_review: true`, a reviewer who hasn't scored yet fetches `GET /applications`; assert `identity_hidden === true` and `artist.display_name === ""`.
- **Reveal:** same reviewer scores via `PUT …/score`; subsequent `GET /applications` returns `identity_hidden === false` and `artist.display_name` is the real artist name (non-empty).
- **Owner unaffected:** with `anonymous_review: true`, owner fetches `GET /applications`; assert `identity_hidden === false` and `artist.display_name` is non-empty.
- **Toggle off:** owner disables `anonymous_review`; reviewer (unscored) re-fetches; assert `identity_hidden === false`.
- **Scored reviewer stays revealed:** reviewer has `my_score != null`; `anonymous_review` is still true; assert `identity_hidden === false` (score is the reveal, not the toggle state).

### Browser e2e

One new spec or an extension to `reviewer-board.spec.ts`:

- Organiser enables anonymous review on the form settings page (UI toggle).
- Reviewer logs in, loads the board — sees `"Anonymous artist"` placeholder.
- Reviewer clicks a star; after the optimistic update and refetch, the real artist name appears on the card.

---

## 6. Constraints

- **Owner view never stripped.** The `shouldAnonymise` guard requires `isReviewer == true`. Owner path is unchanged.
- **Reveal is score-triggered, not organiser-triggered.** There is no manual "reveal" action; scoring is the reveal. An owner who wants to reveal early can remove and re-add a reviewer, or disable the toggle (which reveals all immediately on next fetch — acceptable for organiser-controlled workflows).
- **Medium tags kept.** They describe the type of work, not the person. Stripping them would impair scoring without meaningfully hiding identity.
- **Application answers never stripped.** The entire purpose of review is to evaluate the answers. Anonymisation hides the person, not the work.
- **Notes visible while anonymous.** Panel notes are internal. A future enhancement could hide note authorship attribution from reviewers during the anonymous phase (currently notes expose `author_id`), but that is out of scope here.
- **`identity_hidden` is server-computed, not client-trusted.** The frontend renders it but never sends it; stripping happens at the API layer.

---

## Out of scope

- Configurable which fields to strip per festival (name only vs. name + location vs. all). The current implementation strips name, avatar, and location as a fixed set.
- A separate "reveal all" action for the organiser. Disabling the toggle is the equivalent.
- Hiding note authorship from reviewers during the anonymous phase.
- Anonymisation from the artist's own view (artists never see other applications).
- Configurable multi-criteria rubric (#157) and multi-round selection (#159) — separate issues.
