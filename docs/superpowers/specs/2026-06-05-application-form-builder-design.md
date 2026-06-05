# Application Form Builder — with question library + media-embed field

**Date:** 2026-06-05
**Sub-projects covered:** A (media-embed form field) + C (form builder, question library, starter template) — merged.
**Related, separate spec:** B (quick-select triage) — not covered here.
**Status:** Approved design, pending spec review.

---

## Problem & context

Organisers cannot edit their application **questions** in the UI today. The festival page (`web/src/app/organiser/festivals/[id]/page.tsx`) edits only festival metadata (name/slug/description/location/dates) and review criteria. The application form's `fields` array lives in `application_forms.fields` (opaque jsonb) and is only settable via the API / seed data. This blocks the "this is built for us" demo moment where an organiser shapes their own form.

Separately, mural artists have rich media (video walkthroughs, 3D mockups) that the form can't capture — only `text`, `textarea`, and `select` field types render today (`web/src/components/DynamicForm.tsx`).

This spec delivers a visual form builder, a curated question library + starter template, and a new `embed` field type, as one cohesive feature. **No database migration** — `fields` is already opaque jsonb and `embed` is just a new `type` value.

---

## Contract

**New route:** `/organiser/festivals/[id]/form` — "Application form" editor, linked from the festival page. Owner-only (reuses existing festival-owner auth).

**The builder lets an organiser:**
- Add / edit / delete / reorder application questions.
- Per question set: **type** (Text · Paragraph · Dropdown · Media embed), **label**, **required** toggle, and **options** (Dropdown only).
- Insert curated questions from a **library** panel (one click appends a pre-configured field).
- Load a full **"Standard paint-festival application"** starter template (offered only when the form is empty).
- Save — persists the `fields` array via the existing `PATCH /festivals/{festivalID}/form`.

**New applicant-facing capability:** a `embed` field renders a URL input (validated, with a live preview) in `DynamicForm`; the answer is a provider URL stored as a plain string in `answers[field.id]`.

**New reviewer-facing capability:** embed answers render as a typed thumbnail on the board card and a click-to-load sandboxed player in the application slide-over.

---

## Architecture

### Data model (unchanged shape)

`FormField` (extend the existing type in `DynamicForm.tsx`):

```ts
type FormField = {
  id: string                                   // stable, generated once on add
  type: 'text' | 'textarea' | 'select' | 'embed'
  label: string
  required?: boolean
  options?: string[]                           // select only
}
```

- An embed **answer** is just a string URL in `answers[field.id]` — identical storage to text. No answer-shape change, no migration.
- `application_forms.fields` stays opaque jsonb; the array now may contain `type: "embed"` entries.

### Core unit — the provider parser (the only real logic)

`web/src/lib/embeds.ts`:

```ts
type EmbedInfo = {
  provider: 'youtube' | 'vimeo' | 'sketchfab'
  embedUrl: string         // iframe src
  thumbnailUrl?: string    // YouTube only (no API); undefined for vimeo/sketchfab
}
function parseEmbed(url: string): EmbedInfo | null
```

- Pure, fully unit-tested. Returns `null` for any unrecognised/garbage URL.
- A **Go mirror** (`api/internal/festival/embed.go`, regex matcher returning provider or "") provides authoritative server validation. Two small implementations of the same rules — kept in sync by tests on both sides.

Provider rules (v1):
- YouTube: `youtube.com/watch?v=ID`, `youtu.be/ID`, `youtube.com/embed/ID` → `embedUrl youtube.com/embed/ID`, `thumbnailUrl img.youtube.com/vi/ID/hqdefault.jpg`.
- Vimeo: `vimeo.com/ID` → `embedUrl player.vimeo.com/video/ID`, no thumbnail (would need an API call we avoid).
- Sketchfab: `sketchfab.com/3d-models/SLUG-ID` or `sketchfab.com/models/ID` → `embedUrl sketchfab.com/models/ID/embed`, no thumbnail.

### Touch points

| # | File | Change |
|---|------|--------|
| 1 | `web/src/app/organiser/festivals/[id]/form/page.tsx` (new) + a `FormBuilderClient.tsx` (new, `'use client'`) | The builder UI. Loads form via `GET /form`, edits a local `fields[]`, saves via `PATCH /form`. |
| 2 | `web/src/lib/embeds.ts` (new) | `parseEmbed` + provider constants. |
| 3 | `web/src/lib/questionLibrary.ts` (new) | Curated question presets + the starter template, as static data. |
| 4 | `web/src/components/DynamicForm.tsx` | Add `type === 'embed'` branch: URL input + inline validation (`parseEmbed` null → error) + small preview chip when valid. |
| 5 | `web/src/components/ApplicationCard.tsx` | Embed answers → typed placeholder chip ("▶ Video" / "◆ 3D"); YouTube uses its real thumbnail. No third-party scripts on the board. |
| 6 | `web/src/components/ApplicationSlideOver.tsx` (~line 249 answers loop) | Embed answers → click-to-load sandboxed iframe player. |
| 7 | `api/internal/festival/embed.go` (new) | Go provider matcher. |
| 8 | `api/internal/festival/application.go` `SubmitApplicationHandler` | For `embed` fields with a non-empty value, reject `422` if the provider is unrecognised. (Required-empty check already exists.) |
| 9 | `api/internal/festival/form.go` `UpsertFormHandler` | Light field-definition validation: each field has non-empty `id`, `label`, `type` ∈ {text,textarea,select,embed}; `select` has ≥1 option. Reject `422` otherwise. |

### Builder UX detail

- **Field row:** type `<select>`, label `<input>`, required checkbox, options editor (only when type=select: add/remove option strings), delete button, up/down reorder buttons. (Up/down, not drag — robust and deterministic for e2e.)
- **Add field:** appends a blank `text` field with a freshly generated `id`.
- **id generation:** `crypto.randomUUID()` on add. Never regenerated on label edit — preserves answer keying.
- **Library panel:** "Add from library" reveals grouped presets:
  - *Logistics* — wall-size preference (select), access/equipment needs (textarea).
  - *Eligibility* — public-liability insurance (select yes/no), availability dates (text).
  - *Portfolio* — portfolio link (text), media walkthrough (embed).
  - Clicking a preset appends a fully-configured field (type+label+required preset).
- **Starter template:** "Start from a template" button, shown only when `fields.length === 0`. Loads the full "Standard paint-festival application" set (a superset of the library presets in a sensible order). Never clobbers a non-empty form.
- **Save:** validates client-side (every field has a label; selects have ≥1 option) before `PATCH`; surfaces server `422` inline.

### Security

- Player iframes use a `sandbox` attribute and an **allowlist of provider embed origins** (`youtube.com`, `player.vimeo.com`, `sketchfab.com`). `src` is only ever the `embedUrl` produced by `parseEmbed`, never a raw user string.
- Click-to-load means no third-party script executes until the reviewer opts in.

---

## Boundaries (explicitly NOT in this spec)

- **File-upload field type** — not built anywhere today; out of scope.
- **Anonymous review / review criteria** — already exist; untouched.
- **B (quick-select triage)** — separate spec.
- **oEmbed/server-side embed HTML fetching** — rejected; we parse URLs, we don't fetch.
- **Vimeo/Sketchfab thumbnails** — would need provider API calls; v1 uses typed placeholders instead.

---

## Key Decisions

- **Embed = typed string, parsed at render time.** Rejected a structured `{provider,url,id}` answer object (breaks the `Record<string,string>` answer contract everywhere + needs answer migration) and server-side oEmbed (external dep, defeats the cost-saving rationale).
- **Dedicated `/form` route** rather than another section on the festival page — the builder is substantial and the page is already busy with metadata + criteria.
- **Up/down reorder, not drag** — deterministic for e2e and simpler; the map editor's drag pattern exists if we want it later.
- **Stable field ids** — generated once, immutable across label edits, because answers key on id.
- **Starter template only when empty** — avoids clobbering.
- **Validation on both client and server** — client for instant feedback, server (`parseEmbed` Go mirror + field-definition checks) as the authority.

---

## Invariants

- A field's `id` never changes after creation; `answers` are keyed by `id`.
- `application_forms.fields` only ever contains fields whose `type` ∈ {text, textarea, select, embed} and with a non-empty `id` and `label` (enforced by `UpsertFormHandler`).
- An `embed` answer, when non-empty, is always a URL `parseEmbed` accepts (enforced by `SubmitApplicationHandler`).
- iframe `src` values come only from `parseEmbed`'s `embedUrl`.

---

## Testing

**Unit:**
- `parseEmbed` (TS) — valid YouTube (3 URL forms) / Vimeo / Sketchfab, plus null cases (empty, non-URL, unknown host, provider homepage with no id).
- Go `embed.go` matcher — same matrix, asserting parity with the TS rules.

**E2E (browser):**
- Organiser opens `/form` on an empty form → loads the starter template → adds a "media walkthrough" embed question from the library → saves → reload shows persisted fields.
- Artist applies, fills a text field + a YouTube URL in the embed field → submit succeeds → organiser sees the answer on the board (thumbnail) and a player in the slide-over.

**E2E (api):**
- Submit application with a junk URL in an `embed` field → `422`.
- `PATCH /form` with a malformed field (missing label, or unknown type) → `422`.

---

## Spec updates required after build

- `api/internal/festival/festival.spec.md` — document the two new invariants: `SubmitApplicationHandler` rejects unrecognised providers in `embed` fields (`422`), and `UpsertFormHandler` validates field definitions (id/label/type/options). Update its Contract/Invariants sections.
- No web spec covers the organiser form area yet; if one is added for `/organiser`, note the builder route there.

---

## Changelog
2026-06-05 — initial design (A+C merged).
