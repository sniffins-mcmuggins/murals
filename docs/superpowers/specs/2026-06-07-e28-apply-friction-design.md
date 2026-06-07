# [E28] Apply Friction — profile as source of truth, never type twice

**Date:** 2026-06-07
**Status:** Decisions resolved 2026-06-07 (see Decisions section). Ready to plan.
**Epic:** E28 (#284) — drafts spun out to E29 (#287). Tasks: #285 (M1), #286 (M2).
**Author:** design pass for Adam.

---

## Problem & context

Today an artist's structured profile and a festival's application form are two
disconnected worlds:

- **The profile already holds rich, reusable data.** `artist_profiles` stores
  `display_name`, `bio`, `location_label`, `medium_tags`, `support_url`,
  `headline_image_urls`, and a `social_links` JSON blob keyed by the eight
  platforms in `web/src/components/SocialIcon.tsx`
  (`instagram, twitter, facebook, youtube, tiktok, linkedin, pinterest, website`).
  Artists also own **collections** (their portfolio).
- **The application form is opaque and disconnected.** `application_forms.fields`
  is a jsonb array of `{id, label, type, required, options}`
  (`api/internal/festival/form.go`). Field types are `text | textarea |
  long_text | select | url | embed`. The artist re-enters everything by hand in
  `DynamicForm.tsx`; answers are stored as `map[string]string` keyed by
  `field.id` (`SubmitApplicationHandler`).

The result is tedious, repeated work on **both sides**:

### Artist friction (applying)
1. **Re-typing social links every single application** — the headline complaint.
2. Re-pasting bio / artist statement, portfolio link, medium, location.
3. No draft/resume — navigate away mid-form and the work is gone
   (`DynamicForm` holds answers in component `useState` only). → **E29**.
4. Answering near-identical questions across festivals from scratch each time.

### Organiser friction (setup & review)
5. **Building forms that ask for data the platform already has** — every
   organiser adds "Instagram", "portfolio link", "where are you based" fields
   that duplicate the profile.
6. **Review:** social links (when asked for) land as freeform strings buried in
   answer text — not clickable, not standardised. Reviewers manually open each
   artist's public profile in a new tab to see their socials/work.

**Guiding principle (from the goal):** *the profile is the source of truth;
nobody should ever do a tedious task twice.* An artist maintains their socials,
bio, and portfolio **once**, on their profile, and that data flows into every
application automatically. Organisers stop rebuilding profile fields, and
reviewers see a rich applicant card without leaving the board.

### What changed recently that matters here
- **Reviewer identity masking was removed entirely on 2026-06-04**
  (`festival.spec.md` changelog: "Reviewers always see full identity"). There is
  **no blind-review gate to honour** — surfacing socials/name to
  reviewers breaks nothing today. (We still design M1 so it *could* respect a
  future blind-review toggle — see Invariants.)
- A **question library + starter template** already exists
  (`web/src/lib/questionLibrary.ts`) and is the natural insertion point for
  profile-bound presets.

---

## Goals / non-goals

**Goals**
- An applicant's social links appear to organisers/reviewers **automatically**,
  with zero form-building and zero re-typing (the explicit ask).
- Any form field that mirrors profile data **pre-fills** from the profile and
  stays editable.
- Organiser setup gets shorter (fewer fields to build); reviewer triage gets
  richer (clickable socials + profile inline).

**Non-goals**
- No change to the scoring/rubric, decision, or spot-assignment flows.
- No new auth/permission model — reuse festival-owner + reviewer access.
- Application drafts/resume — **moved to E29** (#287), the only migration.
- No AI/auto-write of answers (that's E19's territory).

---

## Design overview — E28 is two PRs (drafts → E29)

| # | Mechanism | Epic / PR | Who it helps | Migration? |
|---|-----------|-----------|--------------|-----------|
| **M1** | **Auto-attached profile context** — applicant socials + key profile info appear live on every application in the organiser/reviewer view | E28 · PR1 (#285) | Organiser setup ↓, reviewer triage ↓, artist effort = 0 | **No** |
| **M2** | **Profile-bound form fields** — fields can bind to a profile attribute and pre-fill the apply form (editable), plus a one-click "Apply with my profile" | E28 · PR2 (#286) | Artist re-typing ↓, organiser setup ↓ | **No** |
| **M3** | **Application drafts** — autosave + resume partial applications | **E29** (#287) | Artist never loses work | Yes |

**M1 alone satisfies the headline ask** ("socials just appear automatically for
organisers"). M2 generalises it to all profile-mirroring fields. Both are
migration-free, so E28 ships without a schema change. Drafts (M3) became its own
epic E29 because it is the only migration and the most separable piece; it
depends on M2's apply-page hydration pattern but doesn't block E28.

---

## M1 — Auto-attached profile context (PR 1, #285)

**Idea:** the application review view already enriches each application with an
`artistSummary` (`display_name, avatar_s3_key, medium_tags, location_label`) via
a SQL join (`ListApplicationsByFormWithArtist*`, `toEnrichedResponse` in
`api/internal/festival/application.go`). Extend that join + struct to also carry
the artist's **social links, bio, support URL, and public-profile URL**, and
render them as clickable chips + a "View full profile" link in the review UI.

No new field types, no new form-building, no artist action.

### Data flow — LIVE (decided, Q2)
Applications already store `artist_id`. The enrichment is a **live join** against
the current profile — always up to date, no PII duplication, GDPR-clean (delete
the profile → context disappears). No snapshot, no migration.

### API changes
- `db/queries/applications.sql`: extend `ListApplicationsByFormWithArtist` and
  `...ExcludingReviewer` SELECTs to also return `ap.social_links`, `ap.bio`,
  `ap.support_url` from the joined `artist_profiles ap`. Regenerate sqlc
  (`task db:generate`) and grep-verify the scan counts per `sqlc-and-schema.md`
  (this is the exact "new columns silently return zero values" trap in
  `e2e-debugging.md` — the canary test below guards it).
- `artistSummary` (`application.go`) gains:
  ```go
  SocialLinks json.RawMessage `json:"social_links,omitempty"`
  Bio         string          `json:"bio,omitempty"`
  SupportURL  *string         `json:"support_url,omitempty"`
  ProfileURL  string          `json:"profile_url"` // webBase + "/artists/" + profileID
  ```
  Populated in `toEnrichedResponse` and `toEnrichedReviewerRow`. Already flows
  into `reviewerApplicationResponse` because that copies `Artist` wholesale.
- The single-application fetch path (`GetApplicationHandler` /
  reviewer board detail) gets the same enrichment so the slide-over has it.
- **Not added** to `myApplicationResponse` (artist's own view doesn't need it)
  and irrelevant to the public response.

### Web changes
- The application **slide-over / detail panel**
  (`ApplicationSlideOver.tsx` per `e2e-debugging.md`) renders a **profile
  context block**: reuse `SocialIcon` + `SOCIAL_PLATFORMS` to show clickable
  social chips (only platforms with a non-empty URL), the bio, the support link,
  and a prominent **"View full profile →"** linking to `/artists/{profileID}`.
- The **board card** (`ApplicationCard.tsx`) gets a compact row of social icons
  (icon-only, linkified) so a reviewer can sanity-check reach without opening the
  card. Guard against the `truncate`/`min-w-0` zero-width visibility trap noted
  in `e2e-debugging.md` — icons are fixed-size, not truncated text.
- OpenAPI: add the new `artistSummary` fields to the spec and regenerate the TS
  client (`@render/api-client`).

### Tests
- **API canary (required):** an e2e test that submits an application from an
  artist with non-empty `social_links`, then asserts the organiser's
  `GET .../applications` response contains those links — this is the exact guard
  against the sqlc zero-value regression.
- Authorization: a *non-reviewer / non-owner* must not receive the profile
  context (it rides the existing owner/reviewer-gated endpoints, so this is a
  regression check, not new logic).
- Browser: reviewer opens the board → sees clickable Instagram chip → "View full
  profile" navigates to the public page.

### Why this is the headline win
The organiser builds **no** social/portfolio fields, the artist types **nothing**
extra, and the data is always current. "Socials just appear automatically."

---

## M2 — Profile-bound form fields (PR 2, #286)

**Idea:** for the fields organisers *do* want as explicit questions (and that
mirror profile data), let the field **bind** to a profile attribute so the apply
form **pre-fills** it. The artist sees their value already filled in, editable
(they might want a festival-specific portfolio link). They confirm instead of
retype.

### Data model (no migration — `fields` stays opaque jsonb)
Extend `FormField` with an optional `prefill` key naming a profile attribute:

```ts
type FormField = {
  id: string
  type: 'text' | 'textarea' | 'select' | 'embed' | 'url'
  label: string
  required?: boolean
  options?: string[]
  prefill?: PrefillKey   // NEW — optional binding to a profile attribute
}
```

`PrefillKey` allowlist (single source of truth, shared web + validated server-side):

```
display_name
bio
location
website                      → social_links.website
social.instagram | social.twitter | social.facebook | social.youtube
social.tiktok    | social.linkedin | social.pinterest
support_url
portfolio_url                → public profile URL (/artists/{id})
portfolio_collection         → artist picks one collection at apply time (see below)
```

- **Answers are unchanged.** The submitted answer is still a plain string in
  `answers[field.id]` — pre-filled or edited. No answer-shape change, no
  migration. `prefill` only affects the *initial value* the artist sees.

### Portfolio binding — BOTH options (decided, Q6)
The organiser chooses, when building the field, between:
- **`portfolio_url`** → binds to the whole public profile (`/artists/{id}`).
  Zero artist interaction; always valid.
- **`portfolio_collection`** → at apply time the artist picks **one** collection
  to submit for this festival. Needs a builder toggle and a collection picker on
  the apply page (fetch the artist's collections, store the chosen collection URL
  as the answer string). More tailored, more UI.

### API changes
- `UpsertFormHandler` (`form.go`) field validation: if `prefill` is present it
  must be in the allowlist, else 422 `invalid prefill key`. (Mirrors the existing
  `validType`/select-options validation loop.)
- That's the entire backend change for M2 — the server never resolves prefill
  values; it only validates the key. Resolution is client-side at apply time.

### Web changes
- **Form builder** (`FormBuilderClient.tsx`): each field row gains a small
  "Pull from profile" control — a select offering the allowlisted attributes (or
  "Ask fresh / no binding"). Picking one sets `field.prefill`. Show a hint:
  *"Artists see their profile value pre-filled; they can edit it."*
- **Soft nudge (decided, Q3):** when a field duplicates data M1 already shows
  automatically (socials, portfolio), surface a light hint —
  *"Applicants' socials are shown automatically — you usually don't need to
  ask."* Keep the presets; do not block or remove them.
- **Apply page** (`apply/[id]/page.tsx`): fetch the applicant's own profile
  (`GET /profiles/me`, already used by `ProfileForm.tsx`), build a
  `prefillKey → value` resolver, and pass initial values into `DynamicForm`.
- **`DynamicForm.tsx`**: accept an `initialValues` prop (replaces the
  hard-coded `''` seed) and render a subtle "from your profile — edit if needed"
  affordance on bound fields. Critically, **bound fields remain fully editable**.
- **Question library** (`questionLibrary.ts`): the profile-mirroring presets
  ("Portfolio link", a new "Instagram" preset, etc.) carry `prefill` so the
  starter template and library inserts are bound by default.

### Stretch — "Apply with my profile" one-click (decided as PR2 stretch, Q5)
A CTA on the apply page that fills **all** bound fields at once and drops the
artist into a review-and-submit state — the strongest "never type twice" moment.
Build it after the per-field pre-fill works; it is purely a convenience layer on
the same resolver (no new API).

### Interaction with M1
M1 surfaces socials to organisers **without** any field; M2 lets an organiser who
insists on an explicit field still spare the artist the typing. With M1 shipped,
the library nudges (soft) organisers away from adding social fields at all.

### Tests
- API: form with a valid `prefill` saves; invalid key → 422.
- Web unit: `DynamicForm` seeds bound fields from `initialValues`; editing a
  bound field changes the submitted answer.
- Browser: artist with Instagram on profile opens an apply form whose field is
  bound to `social.instagram` → the field is pre-filled → submit carries it;
  portfolio-collection picker variant; one-click apply fills all bound fields.

---

## M3 — Application drafts → moved to E29 (#287)

Autosave + resume partial applications. Spun out of E28 to keep this epic
migration-free; it is the only schema change and depends on M2's apply-page
hydration pattern. Full design retained here for continuity; tracked and built
under **E29 (#287)**.

### Data model
New table `application_drafts`, one row per (form, artist):

```sql
CREATE TABLE application_drafts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id     uuid NOT NULL REFERENCES application_forms(id) ON DELETE CASCADE,
  artist_id   uuid NOT NULL REFERENCES artist_profiles(id) ON DELETE CASCADE,
  answers     jsonb NOT NULL DEFAULT '{}',
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (form_id, artist_id)
);
```

Kept **separate** from `applications` so none of the review/scoring/decision
queries need a `WHERE status != 'draft'` filter. A draft is deleted once the real
application is submitted.

### API
- `PUT /festivals/{festivalID}/draft` — upsert the caller's draft answers
  (auth + artist profile required). Debounced autosave target.
- `GET /festivals/{festivalID}/draft` — fetch the caller's draft (404 if none).
- `SubmitApplicationHandler` deletes any draft for that (form, artist).
- Artist-scoped only — drafts are never visible to organisers/reviewers.
- Mind the chi literal-before-`{id}` route ordering trap.

### Web
- Apply page autosaves `DynamicForm` answers (debounced ~1s) to the draft
  endpoint; on load, hydrate from `GET .../draft` (merged with M2 prefill —
  **draft wins** where present).
- `/applications` lists in-progress drafts with a **"Resume"** entry point.

### Tests
- API: upsert draft → fetch returns it → submit application → draft is gone.
- Migration round-trip + sqlc scan-count grep verify.
- Browser: fill half a form → reload → answers restored.

---

## PR breakdown (E28 = 2 PRs; E29 = 1)

| PR | Epic | Title | Scope | Migration |
|----|------|-------|-------|-----------|
| **PR 1** | E28 #285 | Auto-attach applicant profile context to the review view | M1 — extend artist join + `artistSummary` (+OpenAPI), render social chips + "view full profile" in slide-over & board card, canary test | No |
| **PR 2** | E28 #286 | Profile-bound form fields + one-click apply | M2 — `prefill` key + allowlist, server validation, builder control + soft nudge, `DynamicForm` `initialValues`, apply-page resolver, portfolio URL + collection-pick variants, library presets, "Apply with my profile" stretch | No |
| **PR 3** | E29 #287 | Application drafts (autosave + resume) | M3 — `application_drafts` table, draft endpoints, autosave/hydrate UI, resume entry point | Yes |

---

## Invariants & key decisions

- **Profile is the single source of truth.** No application path becomes a
  second place to maintain socials/bio/portfolio.
- **Pre-fill is a default, never a lock.** Every bound/auto field stays editable
  by the artist; M1 context is read-only display for organisers.
- **No answer-shape change for M1/M2.** `answers` stays `map[string]string`
  keyed by `field.id`; `fields` stays opaque jsonb. Only M3 (E29) adds a table.
- **Profile context rides existing access gates.** M1 data is only ever returned
  on owner/reviewer-gated endpoints; it is *not* added to
  `myApplicationResponse` or any public response.
- **Future blind-review compatibility.** Masking is gone today, but if a
  blind-review toggle returns, M1's profile-context block (name + socials +
  profile link) is exactly the identity that must be withheld until reveal.
  Keep it in one render block so it can be gated in one place.
- **sqlc scan discipline.** M1 (and M3) add columns to SELECTs — both carry the
  canary test from `e2e-debugging.md` to prevent the silent zero-value
  regression.

---

## Files likely touched (orientation for planning)

**PR1 (#285):** `db/queries/applications.sql`,
`api/internal/sqlcdb/applications.sql.go` (generated),
`api/internal/festival/application.go`, `.../review.go`, `openapi/openapi.yaml`
(+ generated client),
`web/src/app/organiser/.../ApplicationSlideOver.tsx`,
`.../ApplicationCard.tsx`, `web/src/components/SocialIcon.tsx` (reuse), e2e api +
browser specs, `festival.spec.md` changelog.

**PR2 (#286):** `web/src/components/DynamicForm.tsx`,
`web/src/app/organiser/festivals/[id]/form/FormBuilderClient.tsx`,
`web/src/app/(artist)/applications/apply/[id]/page.tsx`,
`web/src/lib/questionLibrary.ts`, `api/internal/festival/form.go`,
a shared `prefill` allowlist module, e2e specs, `festival.spec.md` +
`artist.spec.md` changelogs.

**PR3 (E29 #287):** `db/migrations/*` (new table),
`db/queries/application_drafts.sql`, generated sqlc, new
`api/internal/festival/draft.go` + routes in `cmd/api/main.go` (chi ordering),
`web/src/app/(artist)/applications/apply/[id]/page.tsx`, `/applications` list
page, e2e specs.

---

## Decisions (resolved 2026-06-07)

1. **Priority: P0**, milestone **CPF 2027 Pilot** — M1 directly improves the
   pilot organiser's review experience.
2. **M1 = live** profile join (not snapshot): always current, no PII
   duplication, GDPR-clean, no migration.
3. **Soft hint** in the builder when a field duplicates auto-shown profile data —
   presets stay in the library; we do not warn/disable.
4. **Drafts (M3) spun out to E29 (#287)** so E28 ships migration-free (M1 + M2).
5. **"Apply with my profile" one-click** added as a PR2 stretch.
6. **Portfolio binding = both** — organiser can bind to the whole public profile
   (`portfolio_url`) OR offer a "choose a collection" picker
   (`portfolio_collection`).
7. **Per-application fields stay fresh** — insurance, availability and other
   festival-specific questions are NOT pushed onto the profile; only
   profile-mirroring fields pre-fill.
