# Auto-filled per-platform link fields with self-hosted favicons

**Date:** 2026-06-10
**Status:** Approved design (decisions resolved with Adam). Ready to plan.
**Builds on:** branch `demos-e28-apply-friction` (E28 demo clips) — this continues that work.
**Related:** E28 profile-bound form fields (`prefill` keys already exist).

---

## Problem & context

The CPF demo application form (and the product's form generally) asks for links via a
single free-text **"Portfolio links (up to 3 URLs)"** box (`f4`). That's a poor experience:
it's an unstructured dumping ground, it doesn't pre-fill cleanly, and it doesn't match how
artists actually think about their presence (one handle per platform + a website).

E28 already gives us per-platform **profile bindings** (`social.instagram … social.pinterest`,
`website`) and a `prefill` mechanism on form fields. What's missing: the application form
should present **one field per social platform + a Website field**, each **auto-filled** from
the artist's profile, each adorned with the **real favicon** of its site so it's instantly
recognisable.

## Goals / non-goals

**Goals**
- Replace the free-text links box with one field per social platform + a Website field.
- Each social field auto-fills from the profile (reuses E28 `prefill`) and shows the
  platform's **real favicon**.
- Favicons are **self-hosted static assets** — no per-visitor third-party request
  (GDPR-clean, fast, offline-friendly) — refreshed periodically by an automated job.
- The demo showcases it.

**Non-goals**
- No new `prefill` keys or profile schema changes — the E28 allowlist already covers all 8.
- No live favicon fetch for the artist's own website (it's an arbitrary domain) — a static
  globe icon is used instead.
- Not a form-builder "add all socials in one click" convenience (YAGNI; fields are added
  individually / via the demo seed).

---

## Design

### 1. Static favicon assets
`web/public/favicons/<platform>.png` for the seven social platforms
(`instagram, twitter, facebook, youtube, tiktok, linkedin, pinterest`), committed to the repo
and served statically at `/favicons/<platform>.png`. The **Website** field uses a static
generic globe — an inline SVG (no asset needed) or `/favicons/website.svg`.

### 2. Refresh — `task web:favicons` + a GitHub Actions workflow
- **`task web:favicons`** (new task in `web/Taskfile.yml`): downloads each of the seven
  platform favicons at 64px (one-shot, from Google's favicon service —
  `https://www.google.com/s2/favicons?domain=<domain>&sz=64`) into `web/public/favicons/`.
  The **only** third-party call lives here, run by us — never by a visitor.
- **`.github/workflows/refresh-favicons.yml`**:
  - Triggers: `schedule` (monthly cron) + `workflow_dispatch` (manual).
  - Runs `task web:favicons`, then if `git status --porcelain web/public/favicons/` shows
    changes, opens a PR with the refreshed assets (via `peter-evans/create-pull-request`).
  - Follows existing CI conventions (`actions/checkout@v5`, `ubuntu-latest`).
  - This is the "update periodically" mechanism — picks up rebrands (e.g. the Twitter→X mark)
    automatically, with a human approving the PR.

### 3. Favicon helper — `web/src/lib/favicon.ts`
- `PLATFORM_DOMAINS` — a map of the **seven fetchable** social platforms to their domains
  (`instagram → instagram.com`, `twitter → x.com`, `tiktok → tiktok.com`, …). `website` is
  deliberately excluded (it renders as a globe, never downloaded). Single source of truth for
  the refresh task and the helper.
- `platformFaviconSrc(platform): string` → `/favicons/<platform>.png` (static path, no
  network at render time).
- The `website` field renders the static globe (no domain lookup).

### 4. DynamicForm rendering — `web/src/components/DynamicForm.tsx`
- A field whose `prefill` is a `social.*` key (or `website`) renders as an input with a
  **leading favicon** in the input's left gutter:
  - social → `<img src="/favicons/<platform>.png" width=16 height=16>`
  - website → inline globe SVG
- **Graceful fallback:** the `<img>` has an `onError` that swaps to the existing monochrome
  `SocialIcon` brand glyph (we already have all eight). So: real favicon when present, brand
  glyph if the asset is ever missing — never a broken image.
- The field stays fully editable and keeps the E28 "From your profile — edit if needed" hint.
- This is driven off the `prefill` key, so any organiser's social-bound field gets the
  treatment automatically — it's a product capability, not demo dressing.

### 4b. Choose which links to share
Each social/website link field carries a **"Share" checkbox** so the artist picks which links
to include in *this* application (a curated subset of their profile).
- Default **checked** when the field has a pre-filled value (a link the profile already has);
  **unchecked** when empty.
- When **unchecked**, the URL input is dimmed/disabled and the field's submitted answer is the
  **empty string** (the link is excluded from the application). When checked, the (editable)
  URL is submitted as normal.
- A **checkbox per link** (not a radio) — the artist can share any subset.
- **Scope: the application record only.** This curates what's stored in the application; it
  does **not** change E28 M1 — the organiser still sees the artist's *public* profile socials
  live in the review panel (the profile is public regardless). No M1/merged-code changes.

### 5. Demo seed — `demos/seed/main.go`
- Replace `f4` (free-text portfolio) and the lone `f9` with a **"Your links"** set: one field
  per social platform (all seven) bound to its `social.*` prefill key, plus a **Website**
  field bound to `website`. Mark them optional (festival-specific required fields are
  unchanged).
- Enrich Lady Gabe's seeded `social_links` (add `twitter`/`x` + `tiktok` to the existing
  `instagram` + `website`) so several fields auto-fill on camera; the rest stay empty/optional.

### 6. Demo clip + catalogue — `artist-apply-with-profile`
- Update the clip to highlight the favicon'd, auto-filled link fields (the field selectors
  shift from `input[name="f9"]` to the new social field ids). Re-record.
- Update the catalogue row description (favicons + per-platform links).

---

## Tests
- **Web unit (`favicon.test.ts`):** `platformFaviconSrc` maps each platform → the correct
  `/favicons/...` path; `PLATFORM_DOMAINS` covers all seven social platforms (website
  excluded — rendered as a globe).
- **Web unit (DynamicForm):** a `social.instagram`-bound field renders an `<img>` whose `src`
  is the static favicon path; `onError` falls back to the brand glyph; the `website` field
  renders the globe.
- **Web unit (share toggle):** a pre-filled social field defaults to shared and submits its
  URL; un-checking it submits an empty answer for that field; an empty field defaults to
  unshared.
- Existing apply clips + the `prefill`/DynamicForm tests continue to pass.

---

## Invariants & key decisions
- **No per-visitor third-party requests.** Favicons are static; the only external call is in
  the refresh task/workflow, run by us. (Honours the project's GDPR-clean stance.)
- **Real favicons, with a glyph fallback.** Self-hosted real favicons are the happy path; the
  monochrome `SocialIcon` is the never-broken fallback.
- **Website = static globe.** The artist's own site is an arbitrary domain we don't pre-store;
  no runtime fetch.
- **`PLATFORM_DOMAINS` is the single source of truth** shared by the refresh task and the
  helper, so a domain change (e.g. x.com) updates both.
- Driven off the existing E28 `prefill` keys — no new keys, no migration.

---

## Files touched
- New: `web/public/favicons/*.png` (+ `website.svg` or inline), `web/src/lib/favicon.ts`,
  `web/src/__tests__/lib/favicon.test.ts`, `.github/workflows/refresh-favicons.yml`.
- Changed: `web/src/components/DynamicForm.tsx`, `web/Taskfile.yml` (`web:favicons` task),
  `demos/seed/main.go`, `demos/scripts/artist-apply-with-profile.ts`,
  `docs/superpowers/specs/2026-06-01-demo-videos-design.md` (catalogue row).
- Spec changelogs: `web/src/lib/lib.spec.md`.

---

## Decisions (resolved 2026-06-10)
1. **Real favicons, self-hosted** static assets (not runtime-fetched, not monochrome glyphs).
2. **Refresh = GitHub Actions** workflow (monthly cron + `workflow_dispatch`) that runs the
   download task and opens a PR with any changes.
3. **Website field = static globe** (no live fetch of the artist's domain).
4. **All seven** social platforms in the demo form (+ Website).
5. Glyph fallback via the existing `SocialIcon` on `<img>` error.
6. **Per-link "Share" checkbox** (default on for pre-filled links) — curates which links go
   into the application; scope is the application record only, **M1 is unchanged** (the
   organiser still sees public profile socials in review).
