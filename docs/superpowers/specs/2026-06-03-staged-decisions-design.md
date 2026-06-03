# Staged Decisions — Design Spec
**Date:** 2026-06-03
**Status:** Approved

## Problem

The current application review page fires accept/decline/waitlist emails immediately when the organiser clicks a button. This means artists can find out their result at different times depending on when the organiser clicks. There's also no undo for accidental clicks.

## Solution

Replace the instant-decision flow with a **5-column kanban staging area** and a single **Release decisions** action that sends all emails at once.

---

## Data Model

### `applications` table
```sql
ADD COLUMN staged_decision TEXT CHECK (staged_decision IN ('accept', 'waitlist', 'decline'))
-- nullable — null means not yet staged
```

### `festivals` table
```sql
ADD COLUMN decisions_released_at TIMESTAMPTZ
-- null = not yet released; set once on Release to prevent re-releasing
```

### Column bucket rules

| Column | Condition |
|---|---|
| Undecided | `status = 'submitted'` AND `staged_decision IS NULL` AND `shortlisted = false` |
| Shortlisted | `status = 'submitted'` AND `shortlisted = true` AND `staged_decision IS NULL` |
| Accept (pre-release) | `staged_decision = 'accept'` |
| Waitlist (pre-release) | `staged_decision = 'waitlist'` |
| Decline (pre-release) | `staged_decision = 'decline'` |
| Accepted (post-release) | `status = 'accepted'` |
| Waitlisted (post-release) | `status = 'waitlisted'` |
| Declined (post-release) | `status = 'declined'` |

Pre- and post-release use the same 5 columns; the source of truth for Accept/Waitlist/Decline columns switches from `staged_decision` to `status` after release.

---

## API

### Extended: `PATCH /festivals/{festivalID}/applications/{applicationID}`
Add `staged_decision` to the request body alongside the existing `shortlisted` and `review_flag` fields.

```json
{ "staged_decision": "accept" | "waitlist" | "decline" | null }
```

- Owner only (reviewer cannot stage decisions).
- Clears or sets `staged_decision` without touching `status`.
- Returns the updated application.

### Extended: `GET /festivals/{festivalID}/applications` (list response)
Add `staged_decision` field to the `Application` schema in the OpenAPI spec and Go response struct. The existing list endpoint already returns all fields needed; this just exposes the new column.

### Festival response
Add `decisions_released_at` (nullable ISO timestamp) to the `Festival` schema so the frontend can determine post-release state without a separate request.

### New: `POST /festivals/{festivalID}/applications/release-decisions`
- Owner only.
- Reads all applications for this festival with non-null `staged_decision`.
- Bulk-updates each application's `status` to match its `staged_decision` value (`accept` → `accepted`, etc.).
- Clears `staged_decision` on all updated rows.
- Sets `decisions_released_at` on the festival to `now()`.
- Fires notification emails to all affected artists (same `sendApplicationNotification` helper, called once per artist).
- Returns `{ "released": N }` where N is the count of decisions sent.
- **409 Conflict** if `decisions_released_at` is already set — prevents double-release.
- **Must be registered before `/{applicationID}`** in chi to avoid route shadowing.

### Unchanged: `accept`, `decline`, `waitlist` endpoints
Left intact for API stability. The web UI stops calling them; they remain valid for direct API use.

---

## Frontend

### Page replacement
`web/src/app/organiser/festivals/[id]/applications/page.tsx` is fully rewritten. The tab-based layout (Pending / Shortlisted / Accepted / Waitlisted / Declined) is replaced by the 5-column kanban.

### Kanban columns
Five columns rendered side by side using dnd-kit (already installed). Each column is a droppable target. Cards are draggable between columns.

### Drag behaviours
| Drag target | Effect |
|---|---|
| Accept / Waitlist / Decline | `PATCH staged_decision = "accept"/"waitlist"/"decline"` |
| Undecided | `PATCH staged_decision = null`, also clears `shortlisted = false` |
| Shortlisted | `PATCH shortlisted = true, staged_decision = null` |

All drag updates are optimistic (local state updated immediately, reverted on error).

### ⭐ Star shortcut
Toggling the star on a card still works in place — no drag required. Fires `PATCH shortlisted = !current`. If the card had a `staged_decision` set and is being moved to Shortlisted, `staged_decision` is also cleared.

### Release button
- Lives in the page header, right-aligned.
- Label: **"Release N decisions →"** (amber, bold).
- Disabled and greyed when `staged_decision` count is 0.
- On click: confirmation modal — *"Send decisions to N artists? This can't be undone."*
- On confirm: `POST .../release-decisions`.
- On success: refetch all applications, show released banner, disable all dragging.
- On error: toast message, no state change (safe to retry).

### Post-release state
- Dark banner at top: **"Decisions released · [date] · N artists notified by email"** with a "read-only" label.
- Accept / Waitlist / Decline columns show cards with `status = 'accepted'/'waitlisted'/'declined'` and a "Notified ✓" badge.
- Undecided / Shortlisted columns are dimmed (opacity reduced) — those artists received no email.
- Dragging is disabled. Clicking a card still opens the slide-over for full details.

### Compact card design
Kanban cards are smaller than the previous list cards:
- Artist name (bold)
- Medium tags (max 2)
- Score badge (avg ★ if scored)
- ⭐ shortlist toggle (owner only, in Undecided/Shortlisted columns)
- Drag handle (owner only)
- No inline accept/decline/waitlist buttons — these are removed entirely.

### ApplicationSlideOver changes
The Accept / Decline / Waitlist action buttons are replaced with a **staged-decision selector**: three pill buttons (Accept / Waitlist / Decline), one highlighted when active, plus an "Unstage" link to clear the decision. Fires `PATCH staged_decision`.

---

## Out of scope (for now)
- Multiple release rounds — one-time release only. Architecture supports adding this later (just remove the 409 guard and allow `staged_decision` to be re-set post-release).
- Reviewer role cannot stage decisions — staging is owner-only.
- No partial release (releasing only some decisions) — Release sends all staged decisions at once.
