# E23 — Spot assignment & map-editor placement superpowers

**Date:** 2026-06-04
**Issue:** [#243](https://github.com/sniffins-mcmuggins/murals/issues/243) (E23)
**Status:** Design approved — ready for implementation plan

## Summary

Make the organiser map editor genuinely good for placing festival spots, and lock in
the (already-merged) acceptance → placement → public-map flow with an end-to-end test.

The original #243 gap — bulk `release-decisions` not creating `festival_artist` rows —
**was already fixed** in commit `f1a2264` (`release.go:83-93` upserts `festival_artists`
for accepts). Click-to-place a spot **already ships** (`MapEditorClient` +
`MapClickCapture`). So this epic adds map-editor UX features, a pre-release assignment
workflow with drag-and-drop, an organiser-facing assignment summary, one end-to-end
test, and an updated organiser demo video.

E23 is **retitled** from *"Spot assignment as a deliberate post-acceptance step (release
doesn't create festival_artist)"* to **"Spot assignment & map-editor placement
superpowers"** to reflect the real remaining scope.

## Decisions locked during brainstorming

- **No what3words API geocoding.** Forward geocoding (words → lat/lng) needs the paid
  official what3words API + key management; deferred. Instead we keep `w3w` as a
  free-text field and add a deep-link. (Outstanding Tech Decision in CLAUDE.md unchanged.)
- **Address search goes through our Go API** (Option A), not direct browser → Nominatim.
  Matches how the repo wraps every external service (SES/Stripe/S3) behind the API,
  satisfies Nominatim's usage policy (requires an identifying `User-Agent`, ≤1 req/s),
  keeps the third-party URL out of users' browsers, and lets us cache / rate-limit / swap
  providers later.
- **`/geocode/search` is gated to any authenticated user** (not organiser-only) and
  rate-limited — it's a generic, non-sensitive utility, but must not be an open proxy.
- **Nominatim is stubbed in tests** (Playwright `route` interception in the browser,
  injected `*http.Client` / local test server in Go) so CI never depends on the live
  public endpoint.
- **Everything folds into E23** as sub-tasks (per user); not a separate epic.
- **Pre-release spot assignment is allowed.** An organiser can assign a wall to an
  artist who is a *provisional* accept (`applications.staged_decision = 'accept'`), before
  `release-decisions`. This lets venue logistics proceed in parallel with review.
- **Auto-clear on revocation (silent).** When an assigned artist stops being a (provisional
  or final) accept — staged to decline/waitlist, un-staged, or declined/waitlisted directly
  — their spot assignment is silently cleared (the spot's location/dimensions/notes are
  kept; only the artist link is removed). No confirmation prompt, to keep kanban triage fast.
- **Zero artist awareness before release (hard rule).** Until `release-decisions` fires, an
  artist must learn *nothing* about any outcome — not via email, not via the public site,
  and **not via any API endpoint they can query directly** (the "techie artist" threat
  model). This applies to acceptance, provisional decisions, shortlisting, rank, and spot
  assignment. Spot assignment in particular fires **no notification** and exposes nothing
  artist-queryable. See the leak-vector audit in E23.6.
- **Drag-and-drop assignment uses native HTML5 DnD** (not @dnd-kit), because the primary
  drop target is a Leaflet-rendered map pin; native drop events hit-test cleanly against
  the map canvas. The kanban's @dnd-kit usage is unrelated and untouched.
- **No kanban spot badge.** Considered and cut — the dashboard assignment summary answers
  "who's unassigned" more directly, without adding a field to the applications API.

## Out of scope (YAGNI)

Satellite/aerial base layer, wall photos per spot, spot status beyond assigned/empty,
CSV bulk import, full what3words API integration, kanban-card spot badges.

---

## Sub-tasks

### E23.1 — Address/postcode search (API proxy + web)

**API — new `api/internal/geocode` package:**

- `GET /geocode/search?q=<query>` registered inside the authenticated route group in
  `cmd/api/main.go`.
- A `Client` wrapping Nominatim with an **injectable `*http.Client`** (so it's
  unit-testable without network):
  - Calls `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=…`.
  - Sends `User-Agent: Painttrace/1.0 (+https://painttrace.art)`.
  - Uses a `context.WithTimeout` (e.g. 5s) per request.
  - Optional small in-memory query cache (lowercased, trimmed query → results).
- Handler returns `200 [{ "display_name": string, "lat": number, "lng": number }]`
  (top ~5). Empty query → `400`. Upstream failure/timeout → `502`.
- Rate-limited (reuse existing middleware pattern) to prevent abuse as an open geocoder.

**Web — `MapEditorClient`:**

- A debounced (~400ms) search box above the map. Typing queries `/geocode/search`;
  results render as a dropdown.
- Selecting a result **recenters the viewport** via a small `useMap` controller child
  component calling `map.setView([lat, lng], 16)`.
- **Boundary:** search only moves the map viewport. It never creates a spot — placement
  stays click-to-place / drag.

### E23.2 — Drag markers to reposition (web only)

- Editor markers become `draggable`; on `dragend` → `PATCH /festivals/{id}/spots/{spotID}`.
- **Critical gotcha:** `UpdateSpotHandler` (`spots.go:254`) is a **full replace** of
  mutable fields — it requires `lat`+`lng` and sets `w3w`/`width_m`/`height_m`/`notes`
  from the request body (a missing/nil value **clears** the column). The drag-PATCH
  therefore **must resend the spot's current `w3w`/`width_m`/`height_m`/`notes`**, or
  dragging silently wipes them.
- Optimistic update + `invalidateQueries(['spots', festivalId])`. If the `SpotPanel` is
  open for the dragged spot, sync its lat/lng inputs to the new position.
- Markers are not draggable while in "placing" (click-to-add) mode, to avoid gesture
  conflicts.

### E23.3 — what3words + maps deep-links per spot (web only)

- Pure-frontend helper `externalMapLinks(lat, lng, w3w)` → `{ w3w, google, apple }`:
  - **w3w:** `https://what3words.com/{words}` when `w3w` is set, else
    `https://what3words.com/{lat},{lng}`.
  - **Google:** `https://www.google.com/maps/search/?api=1&query={lat},{lng}`
  - **Apple:** `https://maps.apple.com/?q={lat},{lng}`
- Rendered as small links in `SpotPanel` (and optionally the marker popup). Matches the
  locked "Navigation out: Google / Apple / What3Words" decision in CLAUDE.md.

### E23.4 — End-to-end test: release → pool → assign → public map

- New browser spec (or extension of `e2e/browser/map-pin-edit.spec.ts`) chaining the
  full flow:
  1. Artist applies to a festival.
  2. Organiser stages an `accept` and calls `release-decisions`.
  3. Accepted artist now appears in the map editor's **unassigned pool**.
  4. Organiser places a spot and assigns the artist to it.
  5. Festival set `live`.
  6. **Public map renders the artist at the spot.**
  This locks in #243's last open acceptance criterion (no browser spec currently chains
  the whole thing).
- **Search test:** Playwright `route`-intercepts `/geocode/search` with a fixed response,
  asserts the dropdown appears and the map recenters — no live Nominatim dependency.
- **Drag test:** simulate a marker drag (Playwright mouse), assert the new position
  persists after reload (proving the PATCH succeeded and didn't wipe other fields).
- **API:** `geocode` unit test with a stubbed `*http.Client` (table-driven); a `geocode`
  api-gate test (`e2e/api/`) hitting the route with auth against a local stub server.

### E23.5 — Update organiser demo video V06

- Extend `demos/scripts/V06-organiser-full.ts` to show: open map editor →
  **search an address to recenter** → click to place spots → **drag to fine-tune** →
  **drag an artist card onto a pin to assign** → show them on the public map.
- Re-record `demos/output/V06.mp4`.

### E23.6 — Pre-release spot eligibility + orphan-pin invariant (API/DB)

This is the foundational data-layer change that makes pre-release assignment safe.

**Widened eligibility.** "Spot-eligible artist" becomes: an artist with a
`festival_artists` status=`accepted` row **OR** an application with
`staged_decision = 'accept'` for this festival.

- `GetUnassignedAcceptedArtists` → replaced by `GetUnassignedSpotEligibleArtists`
  (UNION of released accepts + provisional accepts, minus those already on a spot).
  This feeds the map editor's pool and the dashboard summary.
- New `GetSpotEligibleArtist` (returns a row iff eligible) replaces
  `GetAcceptedArtistForFestival` as the guard in `SetSpotArtistHandler`.

**Why not create `festival_artists` early instead?** Because that row also drives the
public artist roster (`ListPublicFestivalsForArtist`) on `open` festivals — creating it
pre-release would publish "appearing at X" before decisions are announced. Eligibility
must be a *check*, not an early row.

**Auto-clear invariant.** New `ClearSpotAssignmentForArtist(festivalID, artistID)`
(`UPDATE festival_spots SET artist_id = NULL WHERE festival_id=$1 AND artist_id=$2`),
called from every path that revokes accept-status:
- `patch.go` — when `staged_decision` is set to non-`accept` or cleared to null
- `WaitlistApplicationHandler`, `DeclineApplicationHandler` (`review.go`) — direct revocation
- `release.go` — a release-time sweep clearing spots for any artist who didn't finalize
  as `accepted` (belt-and-suspenders)

**Artist-awareness leak vectors — all three must be closed:**

1. **Public map** (`GetFestivalMapPins`, `festival_spots.sql:88`) joins on
   `fs.artist_id IS NOT NULL` with no status check. Safe because the map only renders
   `live` festivals (post-release), by which point the auto-clear + release sweep
   guarantee every pin is a final accept.
2. **Public artist appearances** (`ListPublicFestivalsForArtist`, `festival_artists.sql`)
   has an `EXISTS festival_spots` branch matching `open` OR `live` festivals — so a
   pre-release spot assignment on an `open` festival would leak the acceptance on the
   artist's public profile **immediately**. **Fix:** gate that spot branch on
   `f.status = 'live'`, so pre-release assignments never surface publicly.
3. **Artist's own `GET /me/applications`** (`my_applications.go` → `toApplicationResponse`,
   `application.go:79`) — a **pre-existing leak**, not caused by this feature but in scope
   for the no-awareness rule. It returns `staged_decision` (the organiser's provisional
   decision), plus `shortlisted`, `review_flag`, and `rank` — all internal review signals.
   A techie artist hitting this endpoint sees their outcome before release. **Fix:** give
   the artist-facing endpoint a dedicated `toMyApplicationResponse` exposing only
   `{ id, form_id, status, answers, created_at, updated_at }` — never the review/decision
   fields. Status stays `submitted` until release, so it leaks nothing. The organiser-facing
   `ListApplicationsHandler` keeps the full response (organisers are allowed to see it).

**No notification on spot assignment.** `SetSpotArtistHandler` takes no `mailer` and sends
nothing today — drag-and-drop assignment (E23.7) MUST preserve that. No code path triggered
by assignment may email or otherwise signal the artist.

### E23.7 — Drag-and-drop artist assignment (web)

- Map editor gains an **unassigned-artists rail** beside the map, fed by the widened pool.
- Artist cards are native-`draggable`; `dragstart` carries the `artist_id` via
  `dataTransfer`.
- **Two drop targets**, both calling existing `PUT /spots/{id}/artist`:
  1. **A map pin** — `onDrop` on `.leaflet-container`; convert the drop point with
     `map.mouseEventToContainerPoint`, find the nearest spot marker within ~35px via
     `map.latLngToContainerPoint`, assign. Miss → no-op.
  2. **A sidebar spot-list item** — robust fallback + accessibility.
- The existing `SpotPanel` artist dropdown stays for keyboard users.

### E23.8 — Organiser assignment summary (web)

- A **Spot assignments** section on `web/src/app/organiser/festivals/[id]/page.tsx`,
  consuming the existing `GET /festivals/{id}/spots` (no new API):
  ```
  Spot assignments                 [ Map editor · 1 unassigned → ]
    Kit Harrow      Spot 3 ✓
    Amara Diallo    Spot 1 ✓
    Rosa Vane       unassigned ⚠
  ```
- "N unassigned" count badge on the Map editor link.

---

## Architecture / data flow

```
Organiser browser (MapEditorClient)
  │  search box (debounced)
  ├──────────────► GET /geocode/search?q=…  ──► geocode.Client ──► Nominatim
  │                                                                 (UA, timeout, cache)
  │  ◄── [{display_name, lat, lng}] ──┘
  │  select result → map.setView(...)              (no spot created)
  │
  │  click map (placing mode)  → POST /spots {lat,lng}           (existing)
  │  drag marker (dragend)     → PATCH /spots/{id} {lat,lng, + w3w/dims/notes}   ⚠ full replace
  │  assign artist             → PUT /spots/{id}/artist {artist_id}              (existing)
  │  deep-links                → what3words.com / google / apple  (pure URL, client-side)
  │
Public map  ◄── GetMapDataHandler (status=live) renders assigned spots
```

`festival_artist` rows already exist by this point because `release-decisions` upserts
them (existing, `release.go`).

## Error handling

- `/geocode/search`: empty `q` → 400; Nominatim timeout/5xx → 502; results capped at 5.
  Web shows "no results" / "search unavailable" inline, never blocks placement.
- Drag-PATCH failure → revert optimistic move, surface inline error in the editor.
- Deep-links are static URLs — no runtime failure path.

## Testing strategy

| Layer | What | How |
|---|---|---|
| Go unit | `geocode.Client` parses/maps Nominatim, handles timeout | injected `*http.Client`, table-driven |
| API gate | `GET /geocode/search` auth + shape | local stub server, authed request |
| Browser | full release→assign→public-map flow | new/extended spec, real stack |
| Browser | search recenters | Playwright `route` stub for `/geocode/search` |
| Browser | drag persists, doesn't wipe fields | Playwright mouse drag + reload assert |
| Existing | spot CRUD, public map | `spots_test.go`, `map_test.go` unchanged |

## Spec-maintenance impact

- **`api/internal/festival/festival.spec.md`** — add to **AI Context**: `PATCH /spots/{id}`
  is a full replace of mutable fields; partial updates must resend
  `w3w`/`width_m`/`height_m`/`notes`. Add to **Invariants**:
  - a `festival_spots.artist_id` may only reference a *spot-eligible* artist (released
    accept OR `staged_decision = 'accept'`); revoking eligibility auto-clears the
    assignment.
  - the public artist-appearances query (`ListPublicFestivalsForArtist`) must not surface
    pre-release spot assignments — its `festival_spots` branch is gated on `status = 'live'`.
  - update the existing spot-assignment line: the guard now allows provisional accepts, not
    only `festival_artists` accepts.
  - **no artist awareness before release:** the artist-facing `GET /me/applications` MUST NOT
    expose `staged_decision`, `shortlisted`, `review_flag`, or `rank` (use
    `toMyApplicationResponse`); spot assignment fires no notification and exposes nothing
    artist-queryable.
- **`api/internal/geocode`** — thin one-handler package → no colocated spec; add it to
  CLAUDE.md's "Packages without specs" list.
- No web spec changes (organiser map editor and festival detail page aren't separately
  specced beyond `dashboard.spec.md`, which already covers the editor's `ssr:false` /
  `spot-panel` invariants).

## Kanban / issue wiring

- Retitle #243 to "[E23] Spot assignment & map-editor placement superpowers".
- Update #243 body: note the original gap is closed (`f1a2264`); list E23.1–E23.5 as a
  checklist.
- Create sub-issues E23.1–E23.8, `addSubIssue` each to #243, apply `area:` + `priority:p1`
  labels, add to board (Ready/Backlog).
