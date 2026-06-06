# Artist Profile Setup Wizard — Design

**Date:** 2026-06-06
**Status:** Approved (brainstorm) — ready for implementation plan
**Area:** `web/` (primary), `api/` + `db/` + `openapi/` (one new field)
**Mission fit:** Helps an artist make a career — a slick, painless setup is the artist's first impression of the platform and the gate to everything else.

## Goal

Turn artist profile setup from a single flat form into a **guided first-run wizard** that takes a new
artist from empty to publishable with minimum friction — "slick and painless." After first run, the
existing single-page editor (polished) handles all later edits.

This is onboarding UX plus filling three plan gaps that currently don't exist in setup:
controlled medium tags, a "Support this artist" donation link, and a guided first-work step.

## Decisions locked during brainstorm

| Decision | Choice | Why |
|---|---|---|
| Setup shape | Guided wizard, one question per screen, progress dots | User picked this over single-page and hybrid; maximally hand-held |
| Later edits | Keep the existing single-page editor (polished), **not** a re-run of the wizard | Least friction for a quick one-field change; reuses `ProfileForm` |
| Step count | All 9 steps (including optional "first work") | Confirmed |
| Festival history / work map | **Out of scope** — display features derived from other data, not setup inputs | Keeps scope cohesive |
| Bio step template | Approved feel: dots + question + serif field + starter prompts + soft counter + auto-save + skip/continue | Repeats for all steps |

## Architecture

### Wizard

- **`ProfileWizard`** — one `'use client'` component holding a **step index** + form state.
  Lives under `web/src/app/(artist)/profile/setup/`.
- **Not routed per-step.** A single component with internal step state — no `/setup/step-3` URLs.
  Simpler, resumable, no back-button/URL juggling.
- **Incremental save.** The profile is auto-created at step 1 (`POST /profiles` with display name),
  and every "Continue" PATCHes `/profiles/me` with that step's field(s). Progress is never lost;
  closing the tab and returning resumes where the artist left off. This is the core of "painless."
- **Step template** (validated in mockup): progress dots + "Step N / 9" marker; serif question heading;
  one field; optional starter prompts; soft/encouraging counter where relevant; "Saved automatically"
  affirmation; **Back / Skip for now / Continue**. Every step is skippable — the wizard never traps.

### Editor (later edits)

- **`ProfileForm`** (existing, `web/src/app/(artist)/profile/ProfileForm.tsx`) remains the editor.
- Refactor it to **share field components** with the wizard (the mediums chip-picker and the support-link
  input especially) so there is one source of truth per field, not two divergent implementations.

### Entry logic

Decided by a single explicit marker, **`setup_completed_at`** (see Backend change) — not inferred from
which fields happen to be filled (that would be ambiguous, and incremental save means the profile row
exists from step 1 onward):

- `setup_completed_at` **is null** → wizard. A brand-new artist (no profile) starts at step 1, which
  creates the row; an artist who closed the tab mid-wizard resumes at their furthest step.
- `setup_completed_at` **is set** → editor.
- **Prospect-claim path** (`/profile?claimed=1`) → editor, and stamps `setup_completed_at` (the profile
  was pre-built — don't make them re-walk setup).

`setup_completed_at` is stamped when the artist reaches the end of the wizard — whether they publish or
click "Finish for now" on step 9. Re-entering setup later is still possible via an explicit link, but the
default destination for a set-up artist is always the editor.

## The 9 steps

1. **Welcome + name** — display name (often pre-filled from signup). Creates the profile row.
2. **Photos** — avatar + up to 3 headline photos. Uses the existing `useProfileImageUpload` flow. Skippable.
3. **Bio** — first-person prompt, tap-a-starter chips, serif writing area (renders in the same
   Cormorant Garamond as the public page), soft/encouraging character counter. Replaces today's bare textarea.
4. **Location** — city/region only (never address). Respects the existing `show_location` public toggle.
5. **Mediums** — tap-to-select chips from a **controlled vocabulary** + "add your own". Replaces the
   comma-typed freeform field. (See Controlled medium vocabulary below.)
6. **Social links** — the existing icon list (Instagram, website, TikTok, …).
7. **Support link** — "Support this artist" donation URL. **New field — requires backend work.**
8. **First work** — optional: create one collection + attach a couple of images so the published page
   isn't empty. Uses the existing collections/image endpoints. Skippable; full collections management
   lives elsewhere.
9. **Review + publish** — preview the public page, show the QR code, Publish (billing gate via
   `billing.CanPublish`; 402 if not entitled, surfaced as an upgrade prompt).

## Backend change (one migration, two fields)

One migration adds two nullable columns to the artist profiles table:

**`support_url text`** — the "Support this artist" donation link.

- **API:** add `SupportURL *string` to the `ArtistProfile` response struct and the update-profile request
  struct in `api/internal/artist/`. Validate it's a well-formed `http(s)` URL on write.
- **OpenAPI:** add `support_url` to the `ArtistProfile` schema and the profile-update request body.
- **Web:** wizard step 7 + editor field write it; the public profile renders a "Support this artist" button.
- **Entitlement:** **ungated** — available on all tiers (Free included). Serves the mission directly.

**`setup_completed_at timestamptz`** — drives the wizard-vs-editor entry decision (see Entry logic).

- Read-only in the `ArtistProfile` response (the server-rendered `/profile` page reads it to pick the route).
- Stamped by a dedicated action at the end of the wizard (publish or "Finish for now") and on prospect claim.
  Simplest wiring: a `POST /profiles/me/complete-setup` that sets it once; or fold it into the existing
  publish action plus the claim flow — to be settled in the plan.

For **both** columns, per the `sqlc-and-schema.md` rule: after regenerating sqlc, verify the SELECT column
lists and every `row.Scan()` include the new columns (the grep `&i.` count check), or they silently return
zero values. Regenerate the TS client (`@render/api-client`) after the OpenAPI edits.

`medium_tags` stays a `string[]` server-side — the controlled vocabulary is a web-side concern, so **no
API change** for mediums.

## Controlled medium vocabulary

A shared constant, e.g. `web/src/lib/mediums.ts`:

```
mural, painting, illustration, stencil, paste-up, sculpture,
mixed media, lettering, mosaic, installation
```

Plus a free-text "add your own" so the list never blocks an artist. Used by **both** the wizard step and
the editor field. Existing freeform values already stored on profiles continue to render — controlled
selection is additive, not a migration of existing data.

## Out of scope (separate work)

- **Festival history** display — auto-derived from `spot_history` (E26), not an artist input.
- **Work map** — aggregates collection pins; a public-profile display feature.
- **AI onboarding** (E19, iceboxed).

## Testing

- **Playwright spec** (`e2e/browser/`): signup → walk the wizard end to end → publish → assert the public
  page shows the bio, the selected mediums, and the "Support this artist" button. Assert auto-save by
  reloading mid-wizard and confirming earlier answers persisted.
- **API/e2e canary** for `support_url`: write a value via `PATCH /profiles/me`, read it back via
  `GET /profiles/me` and the public `GET /profiles/{id}`, assert it round-trips non-empty (a unit test
  asserting zero-is-zero will not catch a missing Scan — per the sqlc-scan-mismatch rule).

## Sequencing (one spec, three increments)

1. **Backend fields** (`support_url` + `setup_completed_at`) — one migration → sqlc → API structs →
   OpenAPI → client → public-profile "Support" button → `complete-setup` action + API canary.
   Self-contained; unblocks the wizard's step 7, the entry logic, and the editor field.
2. **`ProfileWizard`** — the 9-step component with incremental save, entry logic, and the Playwright spec.
3. **Editor refactor + mediums** — extract shared field components (mediums chip-picker, support-link input),
   add the controlled-vocabulary `mediums.ts`, and wire both wizard and `ProfileForm` to them.

## Spec maintenance

This change alters the observable behaviour of `api/internal/artist/` (new `support_url` field) and
`web/src/app/(artist)/` (new setup route, shared field components). Update **`api/internal/artist/artist.spec.md`**
(Contract + Changelog: `support_url` on profile responses/updates) and **`web/src/app/(artist)/artist.spec.md`**
(AI Context: the `setup/` wizard route and the shared field components) as part of the implementing PRs —
not a follow-up.
