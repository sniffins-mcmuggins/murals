# [E28] Apply Friction — profile as source of truth, never type twice

**Date:** 2026-06-07
**Status:** Draft design, pending review (open questions at the bottom).
**Epic:** E28 — see GitHub issue.
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
   (`DynamicForm` holds answers in component `useState` only).
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
- Artists never lose half-finished applications.
- Organiser setup gets shorter (fewer fields to build); reviewer triage gets
  richer (clickable socials + profile inline).

**Non-goals**
- No change to the scoring/rubric, decision, or spot-assignment flows.
- No new auth/permission model — reuse festival-owner + reviewer access.
- Not building an "import my whole profile as the application" auto-apply button
  (discussed under Open Questions; out of scope for the 3 PRs unless promoted).
- No AI/auto-write of answers (that's E19's territory).

---

## Design overview — three mechanisms, three PRs

| # | Mechanism | Who it helps | Migration? |
|---|-----------|--------------|-----------|
| **M1** | **Auto-attached profile context** — applicant socials + key profile info appear live on every application in the organiser/reviewer view | Organiser setup ↓, reviewer triage ↓, artist effort = 0 | **No** |
| **M2** | **Profile-bound form fields** — fields can bind to a profile attribute and pre-fill the apply form (editable) | Artist re-typing ↓, organiser setup ↓ | **No** |
| **M3** | **Application drafts** — autosave + resume partial applications | Artist never loses work | **Yes** |

The three are independent and ship in order. **M1 alone satisfies the headline
ask** ("socials just appear automatically for organisers"). M2 generalises it to
all profile-mirroring fields. M3 is the "never do it twice" safety net and is the
only one needing a schema change — it can be deferred without blocking M1/M2.

---

## M1 — Auto-attached profile context (PR 1)

**Idea:** the application review view already enriches each application with an
`artistSummary` (`display_name, avatar_s3_key, medium_tags, location_label`) via
a SQL join (`ListApplicationsByFormWithArtist*`, `toEnrichedResponse` in
`api/internal/festival/application.go`). Extend that join + struct to also carry
the artist's **social links, bio, support URL, and public-profile URL**, and
render them as clickable chips + a "View full profile" link in the review UI.

No new field types, no new form-building, no artist action.

### Data flow (live, not snapshotted)
Applications already store `artist_id`. The enrichment is a **live join** against
the current profile — always up to date, no PII duplication, GDPR-clean (delete
the profile → context disappears). See Open Questions for the snapshot
alternative; recommendation is **live**.

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

## M2 — Profile-bound form fields (PR 2)

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
```

- **Answers are unchanged.** The submitted answer is still a plain string in
  `answers[field.id]` — pre-filled or edited. No answer-shape change, no
  migration. `prefill` only affects the *initial value* the artist sees.

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
- **Apply page** (`apply/[id]/page.tsx`): fetch the applicant's own profile
  (`GET /profiles/me`, already used by `ProfileForm.tsx`), build a
  `prefillKey → value` resolver, and pass initial values into `DynamicForm`.
- **`DynamicForm.tsx`**: accept an `initialValues` prop (replaces the
  hard-coded `''` seed) and render a subtle "from your profile — edit if needed"
  affordance on bound fields. Critically, **bound fields remain fully editable**.
- **Question library** (`questionLibrary.ts`): the profile-mirroring presets
  ("Portfolio link", a new "Instagram" preset, etc.) carry `prefill` so the
  starter template and library inserts are bound by default — organisers get the
  benefit without thinking about it.

### Interaction with M1
M1 and M2 overlap deliberately: M1 surfaces socials to organisers **without** any
field; M2 lets an organiser who insists on an explicit field still spare the
artist the typing. With M1 shipped, the library should *nudge* organisers away
from adding social fields at all (a hint: "Applicants' socials are shown
automatically — you don't need to ask"). See Open Questions on how hard to push.

### Tests
- API: form with a valid `prefill` saves; invalid key → 422.
- Web unit: `DynamicForm` seeds bound fields from `initialValues`; editing a
  bound field changes the submitted answer.
- Browser: artist with Instagram on profile opens an apply form whose field is
  bound to `social.instagram` → the field is pre-filled → submit carries it.

---

## M3 — Application drafts + resume (PR 3)

**Idea:** autosave a partial application so the artist never loses work and can
resume on any device. The only mechanism here needing a migration.

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
queries need a `WHERE status != 'draft'` filter (avoids touching the whole
review surface). A draft is deleted once the real application is submitted.

### API
- `PUT /festivals/{festivalID}/draft` — upsert the caller's draft answers
  (auth + artist profile required; mirrors `SubmitApplicationHandler`'s profile
  check). Debounced autosave target.
- `GET /festivals/{festivalID}/draft` — fetch the caller's draft (404 if none).
- Submitting an application (`SubmitApplicationHandler`) deletes any draft for
  that (form, artist) in the same path.
- These are artist-scoped only — drafts are never visible to organisers/reviewers.

### Web
- Apply page autosaves `DynamicForm` answers (debounced ~1s) to the draft
  endpoint; on load, hydrate from `GET .../draft` (merged with M2 prefill —
  draft wins where present).
- `/applications` lists in-progress drafts with a **"Resume"** entry point.

### Tests
- API: upsert draft → fetch returns it → submit application → draft is gone.
- Migration round-trip + sqlc scan-count grep verify.
- Browser: fill half a form → reload → answers restored.

### Deferral note
PR3 is the only schema change and is independently droppable. If we want E28 to
be migration-free, ship M1+M2 and split M3 into its own epic. Flagged in Open
Questions.

---

## PR breakdown (≤3)

| PR | Title | Scope | Migration |
|----|-------|-------|-----------|
| **PR 1** | Auto-attach applicant profile context to the review view | M1 — extend artist join + `artistSummary` (+OpenAPI), render social chips + "view full profile" in slide-over & board card, canary test | No |
| **PR 2** | Profile-bound form fields with apply-time pre-fill | M2 — `prefill` key + allowlist, server validation, builder control, `DynamicForm` `initialValues`, apply-page resolver, library presets | No |
| **PR 3** | Application drafts (autosave + resume) | M3 — `application_drafts` table, draft endpoints, autosave/hydrate UI, resume entry point | Yes |

Each PR is independently shippable and demo-able. PR1 delivers the headline ask
on its own. Order matters only in that PR2's library nudge references PR1's
auto-context.

---

## Invariants & key decisions

- **Profile is the single source of truth.** No application path becomes a
  second place to maintain socials/bio/portfolio.
- **Pre-fill is a default, never a lock.** Every bound/auto field stays editable
  by the artist; M1 context is read-only display for organisers.
- **No answer-shape change for M1/M2.** `answers` stays `map[string]string`
  keyed by `field.id`; `fields` stays opaque jsonb. Only M3 adds a table.
- **Profile context rides existing access gates.** M1 data is only ever returned
  on owner/reviewer-gated endpoints; it is *not* added to
  `myApplicationResponse` or any public response.
- **Future blind-review compatibility.** Masking is gone today, but if a
  blind-review toggle returns, M1's profile-context block (name + socials +
  profile link) is exactly the identity that must be withheld until reveal.
  Keep it in one render block so it can be gated in one place.
- **sqlc scan discipline.** M1 and M3 add columns to SELECTs — both carry the
  canary test from `e2e-debugging.md` ("new DB columns silently return zero
  values") to prevent the silent zero-value regression.

---

## Files likely touched (orientation for planning)

**PR1:** `db/queries/applications.sql`, `api/internal/sqlcdb/applications.sql.go`
(generated), `api/internal/festival/application.go`, `.../review.go`,
`openapi/openapi.yaml` (+ generated client),
`web/src/app/organiser/.../ApplicationSlideOver.tsx`,
`.../ApplicationCard.tsx`, `web/src/components/SocialIcon.tsx` (reuse), e2e api +
browser specs, `festival.spec.md` changelog.

**PR2:** `web/src/components/DynamicForm.tsx`,
`web/src/app/organiser/festivals/[id]/form/FormBuilderClient.tsx`,
`web/src/app/(artist)/applications/apply/[id]/page.tsx`,
`web/src/lib/questionLibrary.ts`, `api/internal/festival/form.go`,
a shared `prefill` allowlist module, e2e specs, `festival.spec.md` +
`artist.spec.md` changelogs.

**PR3:** `db/migrations/*` (new table), `db/queries/application_drafts.sql`,
generated sqlc, new `api/internal/festival/draft.go` + routes in
`cmd/api/main.go` (mind the chi literal-before-`{id}` ordering trap),
`web/src/app/(artist)/applications/apply/[id]/page.tsx`,
`/applications` list page, e2e specs.

---

## Open questions (for Adam)

1. **Priority.** I've drafted this as **P1** (launch/growth UX). The CPF pilot is
   a direct organiser relationship and M1 noticeably improves *their* review
   experience — do you want E28 bumped to **P0** (must-ship before CPF Oct 2027),
   or is P1 right?

2. **Live vs snapshot for M1.** Recommendation is **live** (always current, no
   PII duplication, GDPR-clean, no migration). The alternative is snapshotting
   the profile onto the application at submit time — gives a "what they looked
   like when they applied" record and survives later profile edits/deletion, but
   adds a column + duplicates PII. Live, or snapshot?

3. **How hard to nudge organisers away from social/portfolio fields.** With M1
   live, asking for socials as a field is redundant. Options: (a) a soft hint in
   the builder, (b) drop social presets from the library entirely, (c) actively
   warn/disable adding a field bound to a social attribute. How opinionated?

4. **Is M3 (drafts) in scope for E28, or its own epic?** It's the only
   migration and the most separable. Keep it as PR3, or ship E28 as M1+M2
   (migration-free) and spin drafts out?

5. **"Apply with my profile" one-click.** Out of scope as drafted. Worth a
   stretch PR — an apply CTA that pre-fills *every* bindable field and lets the
   artist submit in one review pass? Or leave it to M2's per-field pre-fill?

6. **Portfolio = profile URL, or a chosen collection?** `portfolio_url`
   currently maps to the public profile (`/artists/{id}`). Should organisers
   instead be able to bind to a *specific collection*, or is "your whole public
   profile" the right default?

7. **Public-liability / insurance-style fields.** These are real per-application
   answers with no profile equivalent. Confirm we're *not* trying to push those
   onto the profile — they stay as normal fresh questions. (Assumed yes.)
