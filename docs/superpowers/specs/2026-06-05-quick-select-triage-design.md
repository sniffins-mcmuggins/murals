# Quick-Select Triage — fast shortlist screening pass

**Date:** 2026-06-05
**Sub-project:** B (quick-select triage).
**Related, separate spec:** A+C (application form builder) — `2026-06-05-application-form-builder-design.md`.
**Status:** Approved design, pending spec review.

---

## Problem & context

Reviewing a pile of submitted applications one-by-one on the kanban board (`web/src/app/organiser/festivals/[id]/applications/page.tsx`) is slow for a first pass. Organisers want a fast yes/no screening sweep to build a shortlist before doing the detailed accept/decline work.

Everything needed already exists server-side: the shortlist flag is toggled by `PATCH /festivals/{festivalID}/applications/{applicationID}` with `{ shortlisted }` (the board's `patchMutation` already does exactly this), and anonymity is enforced per-role in the API response. So this is a **pure-frontend feature: no new endpoints, no schema change.**

---

## Contract

A "Triage" button on the applications board opens a **full-screen overlay** that:
- Shows one application at a time from the festival's `submitted` applications.
- Lets the organiser screen each with a single keypress (or on-screen button):
  - `→` / **Shortlist** — set `shortlisted = true`, advance.
  - `←` / **No** — set `shortlisted = false`, advance.
  - `↑` / `↓` — navigate prev/next, no change.
  - `enter` / **Details** — open the full application (existing `ApplicationSlideOver`).
  - `esc` / **Close** — exit back to the board.
- Shows progress: "12 / 48 · 7 shortlisted".
- Persists each change immediately via the existing shortlist PATCH (optimistic, same as the board).

Triage **only** toggles the shortlist flag. Accept / decline / waitlist / rank remain board-only.

---

## Architecture

### No backend changes

- Reuses `PATCH /festivals/{festivalID}/applications/{applicationID}` `{ shortlisted, review_flag, staged_decision }`. Triage sends the existing `review_flag` and `staged_decision` unchanged, flipping only `shortlisted`.
- Reuses the existing `applicationsQuery` data (same React Query cache as the board), so triage shows exactly the per-role data the server returns — including server-side anonymisation when `anonymous_review` is on.

### Components

| File | Change |
|------|--------|
| `web/src/components/TriageMode.tsx` (new) | Full-screen overlay. Props: `apps: Application[]`, `formFields`, `onShortlist(id, value)`, `onOpenDetail(app)`, `onClose()`. Owns the current-index state + keyboard handling. |
| `web/src/app/organiser/festivals/[id]/applications/page.tsx` | Add a "Triage" button to the board header; render `<TriageMode>` when open; wire `onShortlist` to the existing shortlist mutation and `onOpenDetail` to the existing slide-over. |
| `web/src/lib/triage.ts` (new, optional) | Pure helper(s) for advance/next-index logic, unit-tested. |

### What gets iterated

- The set passed in is the festival's `submitted` applications (the board's `allApps.filter(a => a.status === 'submitted')`).
- Initial index = the first application with `shortlisted !== true` (the first unscreened one). If all are already shortlisted, start at index 0.
- Navigation wraps is **not** assumed — at the last card, `→`/`←` apply the change and stop advancing (stay on the last card); `↓` past the end is a no-op. (Keeps the "I've reached the end" signal clear.)

### Card content (minimal)

- Artist name (or the anonymised placeholder the server already returns), avatar/initials.
- The first few answers (label + value), reusing the `labelFor(fieldId)` pattern from `ApplicationSlideOver`.
- Work-image thumbnails and embed-field thumbnails (embed thumbnails via `parseEmbed` from the A+C spec, if that has shipped; otherwise a typed placeholder).
- Current shortlist state (clearly indicated, so re-screening shows what was already chosen).
- Full detail is one `enter` away (opens `ApplicationSlideOver`); triage does not duplicate the full detail view.

### Keyboard handling

- A `keydown` listener active only while the overlay is open and the slide-over is closed (so the slide-over's own interactions aren't hijacked).
- Prevent default on the handled keys to stop the page scrolling on arrows.
- On-screen buttons mirror every key for discoverability, accessibility, and deterministic e2e.

---

## Boundaries (explicitly NOT in this spec)

- **No accept / decline / waitlist / rank** in triage — those stay on the board (this is screening, not deciding).
- **No new API endpoint or DB change.**
- **No separate route** — it's an overlay over the board so the loaded data and board state are reused.
- **No bulk actions** beyond the per-card shortlist toggle.
- **No new anonymity logic** — inherited from the server response.

---

## Key Decisions

- **Overlay, not a route.** Reuses the board's already-loaded `applicationsQuery` cache and returns to the exact board state on close. A `/triage` route would re-fetch and re-wire mutations for no benefit.
- **Shortlist-only (per B2).** Triage produces a shortlist; the kanban produces decisions. Keeps the fast pass genuinely fast and non-destructive.
- **Start at the first unscreened card.** Matches the "continue the pass" mental model; re-screening earlier cards is still possible via `↑`.
- **On-screen buttons mirror keys.** Keyboard-first but not keyboard-only — needed for accessibility and stable e2e.
- **Anonymity is not re-implemented.** The server already strips identity for reviewers under `anonymous_review`; triage renders that same data.

---

## Invariants

- Triage mutations change only `shortlisted`; `review_flag` and `staged_decision` are passed through unchanged.
- Triage never sets a status/decision or rank.
- The overlay's keyboard listener is inert while the detail slide-over is open.

---

## Testing

**Unit:**
- `triage.ts` advance/initial-index helpers — first-unscreened selection, end-of-list behaviour, all-shortlisted fallback.

**E2E (browser):**
- Seed a festival with several submitted applications. Open Triage → press `→` (or click **Shortlist**) on the first card → `esc` → that application is in the **Shortlisted** column on the board.
- In triage, `←` on a shortlisted card → exit → it is no longer shortlisted.
- `enter` opens the slide-over for the current card; closing it returns to triage at the same index.

---

## Spec updates required after build

- None to API specs (no backend change). If a web spec is later created for the `/organiser` area, document the triage overlay there.

---

## Changelog
2026-06-05 — initial design.
