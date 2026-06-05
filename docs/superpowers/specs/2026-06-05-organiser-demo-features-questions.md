# Organiser-demo features — pre-brainstorm questionnaire (ANSWERED)

**Date:** 2026-06-05
**Status:** Answered 2026-06-05. Each section is an independent sub-project; each gets its own design doc → plan → build.

**Recommended build order:** ~~D~~ (already shipped) → A → B → C → E → F
**Realistic landable set before the meeting (~2 weeks, grouped PRs):** A + B + C (D is done). **E and F are post-meeting.**
**Optional tiny polish:** D3 draft-pin-on-search (standalone).

---

## Cross-cutting

- **X1. Demo deadline:** **Within 2 weeks.** → Prioritise D + quick wins; E/F post-meeting.
- **X2. Real CPF content:** **Generic is fine.** Build mechanisms with curated/generic content; real CPF content drops in later.
- **X3. Demo recording:** **Build features first, re-cut V06 in one pass later.**
- **X4. PR style:** **Group into fewer PRs** (e.g. quick-wins together, D on its own, E/F later).

---

## A — Media-embed form field
- **A1. Providers:** YouTube + Vimeo + **Sketchfab (3D)**.
- **A2. Render:** Thumbnail on the review board; live player in the application slide-over.
- **A3. Validation:** Reject URLs that aren't a recognised provider (clear inline error).
- **A4. Limit per form:** No hard cap.
- **A5. Required toggle:** Yes — embed fields support required/optional like other types.

## B — Quick-select triage view
- **B1. Entry:** "Triage" button on the applications board → full-screen one-card-at-a-time view.
- **B2. Decision:** Sets **shortlist yes/no only**; real accept/decline stays on the board after.
- **B3. Keys:** `←` no, `→` shortlist, `↑`/`↓` navigate, `enter` open detail.
- **B4. Card content:** Minimal (name + key answers + work images) + a key to expand to full.
- **B5. Anonymous-review:** **Not required to honour** — triage shows identity regardless. ⚠️ _Flag: if a festival has anonymous review on, triage revealing identity slightly undermines it. Acceptable for v1 per decision; revisit if it matters._

## C — Form question library / templates
- **C1. Scope:** **Include a minimal visual form-builder UI** (add/edit/reorder fields) — there's no real builder today.
- **C2. Source:** Curated set we author (paint-festival-specific questions).
- **C3. CPF content:** Generic now (per X2); CPF-specific later.
- **C4. Whole-form templates:** Yes — a "Standard paint-festival application" starter form (one-click full form).
- **C5. Field types:** All available types (including embed from A, and file upload).

## D — Map polish (E23) — ⚠️ ALREADY BUILT
**Discovered 2026-06-05:** the entire E23 epic shipped in PR #252 + #265. All three features exist in `MapEditorClient.tsx` / `api/internal/geocode/` / `api/internal/festival/spots.go`, with e2e coverage in `map-pin-edit.spec.ts`. Stale issues #244/#245/#246/#247/#249/#250/#251 closed and moved to Done on the board (epic #243 was already closed).

- **D1–D5 answers retained for reference**, but the only delta vs. the answered design is **D3**: search currently *recentres only*; the answered design wanted *recentre + drop a draft pin to confirm*. Small standalone polish, queued separately. Everything else (D1/D2/D4/D5) matches what's already in code.

## E — Coming-soon listing + notify-me  *(post-meeting)*
- **E1. Model:** Make `draft` (paid-but-not-open) publicly listable with a cut-down page (no form/map) — reuse existing status.
- **E2. Trigger:** Explicit "List publicly" button, enabled once setup fee is paid.
- **E3. Identity:** Email only, no account (zero friction).
- **E4. Notify action:** Store email + confirmation email; one-off "applications now open" email when status flips to `open`. No newsletter.
- **E5. Placement:** On the public festivals index, in a distinct "Coming soon" section.
- **E6. GDPR:** Consent checkbox + unsubscribe from the start. (default yes)

## F — Retrospective / previous-years pages  *(post-meeting)*
- **F1. Model:** A retrospective is an `archived` festival row with a past date — reuse spots/description/photos, no new table.
- **F2. Map:** Include the map + mural-status pins.
- **F3. Artist linking:** Link to real platform profiles where they exist, plain names otherwise. (default)
- **F4. Author:** Organiser self-serve from the dashboard.
- **F5. Demo history:** Seed 1–2 years only.
- **F6. Photos:** Placeholders for now (per generic-content decision).

---

## Next step
D turned out to be already built (E23 fully merged). Revised path: spec **A** (media embed) first, then **B** (triage), then **C** (form builder + question library). Each spec → plan → build, grouped into fewer PRs. D3 draft-pin is an optional standalone polish. E and F specced but scheduled after the meeting.
