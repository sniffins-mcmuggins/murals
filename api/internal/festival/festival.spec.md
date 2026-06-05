# festival Spec
**Path:** `api/internal/festival/`
**Last updated:** 2026-05-31

## Contract
- CRUD for festivals (organisers only): create, get, patch, list-mine
- Public read: `ListPublicHandler` (status `open` or `live`), `GetMapDataHandler` (slug, status `live`)
- Application lifecycle: submit, patch, withdraw, waitlist, status transitions
- Spot management: organiser assigns artists to map spots
- Review workflow: panellist accounts, rubric scoring, multi-round selection, notes, reorder
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
- **Staged decisions + bulk release**: organisers stage `accept`/`waitlist`/`decline` per application (`applications.staged_decision`), then `release-decisions` finalises them all at once and sets `festivals.decisions_released_at`. This replaces the per-application accept/decline buttons in the UI; the direct `accept`/`decline`/`waitlist` endpoints still exist for the API
- **Review round (open/close)**: an optional pre-kanban sequential gate driven by `festivals.review_opened_at` / `review_closed_at`. While open, reviewers may score and organiser decision endpoints are locked (409 Conflict); closing (force-close allowed anytime) finalises averages and unlocks. Reopen is not supported in v1.

## Invariants
- Public `GetHandler` returns 404 for any festival with status NOT IN (`open`, `live`) — unauthenticated callers must never see `draft` or `closed` festivals
- An artist may only have one active (non-withdrawn) application per festival
- `spots.application_id` uniqueness: a confirmed application can only be assigned to one spot
- Reorder endpoints (`/applications/reorder`, `/spots/reorder`) MUST be registered before their `/{id}` siblings in chi
- Finalising an `accept` (via either `AcceptApplicationHandler` or `release-decisions`) MUST upsert a `festival_artists` row with status `accepted` — that row is what makes an artist assignable on the map and visible on the public roster. `decline`/`waitlist` create no such row
- A spot may be assigned to any *spot-eligible* artist: a `festival_artists` status=`accepted` row OR an application with `staged_decision = 'accept'` (provisional, pre-release). The guard is `GetSpotEligibleArtist`.
- `festival_spots.artist_id` may only reference a spot-eligible artist. Revoking eligibility (re-stage to non-accept, un-stage, direct decline/waitlist, or release-as-non-accept) auto-clears the assignment via `ClearSpotAssignmentForArtist`. This keeps declined artists off the public map.
- **No artist awareness before release.** Nothing artist-facing may reveal an outcome before `release-decisions`: `GET /me/applications` uses `toMyApplicationResponse` (no `staged_decision`/`shortlisted`/`review_flag`/`rank`); `ListPublicFestivalsForArtist`'s spot branch is gated on `status = 'live'`; spot assignment fires no notification.
- Reviewer application responses use `reviewerApplicationResponse` — they MUST omit `staged_decision`, `shortlisted`, `review_flag`, `rank`, `status`, `notes`, and `updated_at`. The organiser receives the full `applicationResponse`. Do not unify these two shapes.
- While `reviewRoundStatus(fest) == reviewOpen`: `ScoreApplicationHandler` blocks non-reviewer callers (409); all organiser decision endpoints (`PatchApplicationHandler` staged fields, accept/decline/waitlist, reorder, release-decisions) return 409. `reviewNotStarted` and `reviewClosed` impose no gate — a festival without a round uses the kanban freely.
- Every owner-only endpoint that mutates application state MUST check `reviewRoundStatus` immediately after ownership confirmation. Grep for `reviewRoundStatus` to find all existing sites before adding a new one. Exception: `AddApplicationNoteHandler` — notes are always allowed during review.

## AI Context
- `festival.go`: festival CRUD — `GetHandler` contains the public-status gate
- `application.go`: application submit/patch/status + most of the review lifecycle. `ApplicationArtist` now carries `id` (artist profile id) for profile linking — both `toEnrichedResponse` and `toEnrichedReviewerRow` must populate it.
- `review.go`: `ListApplicationsHandler` branches final encode by role; `Accept/Decline/WaitlistApplicationHandler` all carry the decision gate. `score.go`: reviewer round gate (only while open). `review_round.go`: `reviewRoundStatus()` helper + `OpenReviewRoundHandler` / `CloseReviewRoundHandler`; grep `reviewRoundStatus` when adding a new decision endpoint.
- `reviewers.go`: panellist account management
- `spots.go`: map spot assignment; `NearbyHistoryHandler` at GET /spots/nearby-history returns spots from festivals within 10 km of the current festival's center. Route must be registered BEFORE `/{spotID}` in `main.go` (literal before parameterised — chi route-order invariant).
- `form.go`: dynamic application form builder
- `map.go`: `GetMapDataHandler` — public endpoint returning spot locations + artist previews for the Leaflet map
- `appearances.go`: `POST /appearances` wires confirmed application → artist profile for public display
- `release.go`: `ReleaseDecisionsHandler` — bulk-finalises staged decisions; upserts `festival_artists` for each accept (mirrors `AcceptApplicationHandler`) and notifies every affected artist
- `access.go`: the organiser-ownership check — used by most handlers to confirm the caller owns the festival
- `testhelpers_test.go`: shared test helpers (festival/application setup) — check this before writing new tests to avoid duplication
- **`PATCH /spots/{id}` is a full replace of mutable fields** — partial updates (e.g. drag) must resend `w3w`/`width_m`/`height_m`/`notes`/`mural_status` or they're cleared (mural_status reverts to 'unknown' if omitted).
- The organiser-facing `ListApplicationsHandler` keeps the full `applicationResponse` (incl. `staged_decision`); only the artist-facing `/me/applications` is trimmed. Don't "unify" them back together.

## Changelog
2026-05-31 — initial spec
2026-06-03 — documented staged-decisions + bulk release (E22); recorded the invariant that finalising an accept (direct or via release) upserts a `festival_artists` row, after fixing `ReleaseDecisionsHandler` which omitted it
2026-06-04 — E23: noted PATCH /spots full-replace invariant; click-to-place already shipped; release→festival_artist gap closed in f1a2264
2026-06-04 — E23: pre-release spot eligibility + auto-clear invariant; no-artist-awareness (trimmed /me/applications, gated appearances); PATCH /spots full-replace note.
2026-06-05 — E26: mural_status on festival_spots (permanent/temporary/unknown, default unknown); center_lat/center_lng on festivals; NearbyHistoryHandler (10 km Haversine, nearby-history before /{spotID}); PATCH /spots full-replace includes mural_status.
2026-06-04 — Epic 1 Phase 1: removed reviewer identity masking entirely (column, stripping, identity_hidden, toggle, e2e). Reviewers always see full identity.
2026-06-04 — Epic 1 Phase 2: reviewer-only scoring queue; trimmed reviewerApplicationResponse seals the decision-field leak.
2026-06-04 — Epic 1 Phase 3: review round open/close lifecycle; sequential decision gate (reviewers score only while open; decisions locked while open); reviewers notified on open (accepted only).
2026-06-05 — Epic 2 (E25): avatar images on kanban cards + reviewer queue; View full profile ↗ button in slide-over; ApplicationArtist.id added to API + OpenAPI.
