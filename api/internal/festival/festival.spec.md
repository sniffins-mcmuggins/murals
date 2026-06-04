# festival Spec
**Path:** `api/internal/festival/`
**Last updated:** 2026-05-31

## Contract
- CRUD for festivals (organisers only): create, get, patch, list-mine
- Public read: `ListPublicHandler` (status `open` or `live`), `GetMapDataHandler` (slug, status `live`)
- Application lifecycle: submit, patch, withdraw, waitlist, status transitions
- Spot management: organiser assigns artists to map spots
- Review workflow: panellist accounts, rubric scoring, anonymous review, multi-round selection, notes, reorder
- Appearance tracking: maps confirmed applications to artist profiles for public display
- Form builder: organiser defines per-festival application questions; artist submits answers

## Boundaries
- Does NOT handle payments for festival activation — that is `billing.OrganiserCheckoutHandler`
- Does NOT send notification emails directly — uses a passed-in `auth.EmailSender`
- Does NOT own artist profiles or collections — reads them via sqlcdb queries

## Key Decisions
- **Status machine for festivals**: `draft` → `open` → `live` → `closed`. Public endpoints gate on `open` OR `live` — artists must see `open` festivals to apply; the map only renders `live` ones
- **Status machine for applications**: `draft` → `submitted` → `under_review` → `accepted` / `rejected` / `waitlisted` / `withdrawn`
- **Spots are independent of applications**: a spot can be pre-created without an application; `spots.application_id` is nullable
- **Route registration order matters**: literal sub-paths (e.g. `/applications/reorder`) MUST be registered before parameterised routes (e.g. `/applications/{applicationID}`) in chi — see api-handler-checklist rule
- **Reviewer anonymity**: panellist usernames in review UI are hidden from organisers until the round closes — stored in DB, masked in response
- **Staged decisions + bulk release**: organisers stage `accept`/`waitlist`/`decline` per application (`applications.staged_decision`), then `release-decisions` finalises them all at once and sets `festivals.decisions_released_at`. This replaces the per-application accept/decline buttons in the UI; the direct `accept`/`decline`/`waitlist` endpoints still exist for the API

## Invariants
- Public `GetHandler` returns 404 for any festival with status NOT IN (`open`, `live`) — anonymous callers must never see `draft` or `closed` festivals
- An artist may only have one active (non-withdrawn) application per festival
- `spots.application_id` uniqueness: a confirmed application can only be assigned to one spot
- Reorder endpoints (`/applications/reorder`, `/spots/reorder`) MUST be registered before their `/{id}` siblings in chi
- Finalising an `accept` (via either `AcceptApplicationHandler` or `release-decisions`) MUST upsert a `festival_artists` row with status `accepted` — that row is what makes an artist assignable on the map and visible on the public roster. `decline`/`waitlist` create no such row
- A spot may be assigned to any *spot-eligible* artist: a `festival_artists` status=`accepted` row OR an application with `staged_decision = 'accept'` (provisional, pre-release). The guard is `GetSpotEligibleArtist`.
- `festival_spots.artist_id` may only reference a spot-eligible artist. Revoking eligibility (re-stage to non-accept, un-stage, direct decline/waitlist, or release-as-non-accept) auto-clears the assignment via `ClearSpotAssignmentForArtist`. This keeps declined artists off the public map.
- **No artist awareness before release.** Nothing artist-facing may reveal an outcome before `release-decisions`: `GET /me/applications` uses `toMyApplicationResponse` (no `staged_decision`/`shortlisted`/`review_flag`/`rank`); `ListPublicFestivalsForArtist`'s spot branch is gated on `status = 'live'`; spot assignment fires no notification.

## AI Context
- `festival.go`: festival CRUD — `GetHandler` contains the public-status gate
- `application.go`: application submit/patch/status + most of the review lifecycle
- `review.go`, `score.go`: reviewer scoring and rubric logic
- `reviewers.go`: panellist account management
- `spots.go`: map spot assignment
- `form.go`: dynamic application form builder
- `map.go`: `GetMapDataHandler` — public endpoint returning spot locations + artist previews for the Leaflet map
- `appearances.go`: `POST /appearances` wires confirmed application → artist profile for public display
- `release.go`: `ReleaseDecisionsHandler` — bulk-finalises staged decisions; upserts `festival_artists` for each accept (mirrors `AcceptApplicationHandler`) and notifies every affected artist
- `access.go`: the organiser-ownership check — used by most handlers to confirm the caller owns the festival
- `testhelpers_test.go`: shared test helpers (festival/application setup) — check this before writing new tests to avoid duplication
- **`PATCH /spots/{id}` is a full replace of mutable fields** — partial updates (e.g. drag) must resend `w3w`/`width_m`/`height_m`/`notes` or they're cleared.
- The organiser-facing `ListApplicationsHandler` keeps the full `applicationResponse` (incl. `staged_decision`); only the artist-facing `/me/applications` is trimmed. Don't "unify" them back together.

## Changelog
2026-05-31 — initial spec
2026-06-03 — documented staged-decisions + bulk release (E22); recorded the invariant that finalising an accept (direct or via release) upserts a `festival_artists` row, after fixing `ReleaseDecisionsHandler` which omitted it
2026-06-04 — E23: noted PATCH /spots full-replace invariant; click-to-place already shipped; release→festival_artist gap closed in f1a2264
2026-06-04 — E23: pre-release spot eligibility + auto-clear invariant; no-artist-awareness (trimmed /me/applications, gated appearances); PATCH /spots full-replace note.
