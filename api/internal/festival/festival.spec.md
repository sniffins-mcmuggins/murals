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
- **Single decision column + per-application release**: the organiser's verdict lives in `applications.decision` (`undecided`/`accept`/`waitlist`/`decline`) — the single source of truth (it replaced the old `status`-terminal-values + `staged_decision` split). `applications.released_at` (nullable) is the publish fact: NULL = provisional/organiser-only, set = visible to the artist. `release-decisions` stamps `released_at = now()` on every decided-but-unreleased row in the festival, in one transaction. There is **no** festival-level `decisions_released_at` and **no** direct `accept`/`decline`/`waitlist` endpoints — the only decision writers are `PatchApplicationHandler` (set `decision`) and `ReleaseDecisionsHandler` (publish).
- **Review round (open/close)**: an optional pre-kanban sequential gate driven by `festivals.review_opened_at` / `review_closed_at`. While open, reviewers may score and organiser decision endpoints are locked (409 Conflict); closing (force-close allowed anytime) finalises averages and unlocks. Reopen is not supported in v1.

## Invariants
- Public `GetHandler` returns 404 for any festival with status NOT IN (`open`, `live`) — unauthenticated callers must never see `draft` or `closed` festivals
- An artist may only have one active (non-withdrawn) application per festival
- `spots.application_id` uniqueness: a confirmed application can only be assigned to one spot
- Reorder endpoints (`/applications/reorder`, `/spots/reorder`) MUST be registered before their `/{id}` siblings in chi
- `festival_artists` is the **lineup** (single source of truth for who is in a festival), with a `source` column (`application` | `invite`). Membership = a row exists (there is no `status` column). Releasing an `accept` MUST upsert a `festival_artists` row (`source='application'`) — that row makes an artist assignable on the map and visible on the public roster. `decline`/`waitlist` create no row. (A future invite endpoint will add `source='invite'` rows for artists with no application.)
- A spot may be assigned to any *spot-eligible* artist: a `festival_artists` lineup member OR an application with `decision = 'accept' AND released_at IS NULL` (provisional, pre-release). The guard is `GetSpotEligibleArtist`.
- `festival_spots.artist_id` may only reference a spot-eligible artist. Revoking eligibility (re-decide to non-accept, un-decide, or release-as-non-accept) auto-clears the assignment via `ClearSpotAssignmentForArtist`. This keeps declined artists off the public map.
- **Released applications are immutable.** Once `released_at` is set, `PatchApplicationHandler` rejects further mutation (409) — a published decision can't be flipped (which would desync `/me/applications` and orphan the lineup row).
- **No artist awareness before release.** Nothing artist-facing may reveal an outcome before release: `GET /me/applications` uses `toMyApplicationResponse`, which exposes `decision` ONLY when `released_at` is set (nil otherwise) and omits `shortlisted`/`review_flag`/`rank`; `ListPublicFestivalsForArtist`'s spot branch is gated on `status = 'live'`; spot assignment fires no notification.
- Reviewer application responses use `reviewerApplicationResponse` — they MUST omit `decision`, `released_at`, `shortlisted`, `review_flag`, `rank`, `notes`, and `updated_at`. The organiser receives the full `applicationResponse`. Do not unify these two shapes.
- While `reviewRoundStatus(fest) == reviewOpen`: `ScoreApplicationHandler` blocks non-reviewer callers (409); all organiser decision endpoints (`PatchApplicationHandler` decision/flags, reorder, release-decisions) return 409. `reviewNotStarted` and `reviewClosed` impose no gate — a festival without a round uses the kanban freely.
- Every owner-only endpoint that mutates application state MUST check `reviewRoundStatus` immediately after ownership confirmation. Grep for `reviewRoundStatus` to find all existing sites before adding a new one. Exception: `AddApplicationNoteHandler` — notes are always allowed during review.
- `UpsertFormHandler` (`PUT /festivals/{festivalID}/form`) rejects (422) any field definition that: (a) has an empty `id` or `label`, (b) has a `type` not in `{text, textarea, select, embed}`, or (c) is a `select` with no `options`. Valid field definitions are persisted as-is to the opaque `application_forms.fields` jsonb column.
- `SubmitApplicationHandler` rejects (422) any `embed` field whose answer is non-empty and is not a recognised provider URL. Recognised providers: YouTube (`youtube.com`, `youtu.be`), Vimeo (`vimeo.com`), Sketchfab (`sketchfab.com`). Detection rules live in `embed.go` and are mirrored client-side in `web/src/lib/embeds.ts`. Empty embed answers are permitted (field not required, artist has no media).

## AI Context
- `festival.go`: festival CRUD — `GetHandler` contains the public-status gate
- `application.go`: application submit/patch/status + most of the review lifecycle. `ApplicationArtist` now carries `id` (artist profile id) for profile linking — both `toEnrichedResponse` and `toEnrichedReviewerRow` must populate it.
- `review.go`: `ListApplicationsHandler` branches final encode by role. `patch.go`: `PatchApplicationHandler` (set `decision` + flags; carries the review-round gate and the released-immutability 409) and `ReorderApplicationsHandler`. The direct accept/decline/waitlist handlers were removed (single decision writer). `score.go`: reviewer round gate (only while open). `review_round.go`: `reviewRoundStatus()` helper + `OpenReviewRoundHandler` / `CloseReviewRoundHandler`; grep `reviewRoundStatus` when adding a new decision endpoint.
- `reviewers.go`: panellist account management
- `spots.go`: map spot assignment; `NearbyHistoryHandler` at GET /spots/nearby-history returns spots from festivals within 10 km of the current festival's center. Route must be registered BEFORE `/{spotID}` in `main.go` (literal before parameterised — chi route-order invariant).
- `form.go`: dynamic application form builder
- `map.go`: `GetMapDataHandler` — public endpoint returning spot locations + artist previews for the Leaflet map
- `appearances.go`: `POST /appearances` wires confirmed application → artist profile for public display
- `release.go`: `ReleaseDecisionsHandler` — transactionally stamps `released_at` on every decided-but-unreleased application, upserts a `festival_artists` lineup row for each accept, clears spots for non-accepts, and (after commit) notifies every affected artist. Idempotent: a second release with nothing new returns 409.
- `access.go`: the organiser-ownership check — used by most handlers to confirm the caller owns the festival
- `testhelpers_test.go`: shared test helpers (festival/application setup) — check this before writing new tests to avoid duplication
- **`PATCH /spots/{id}` is a full replace of mutable fields** — partial updates (e.g. drag) must resend `w3w`/`width_m`/`height_m`/`notes`/`mural_status` or they're cleared (mural_status reverts to 'unknown' if omitted).
- The organiser-facing `ListApplicationsHandler` keeps the full `applicationResponse` (incl. `decision`/`released_at`); only the artist-facing `/me/applications` is trimmed. Don't "unify" them back together.

## Changelog
2026-05-31 — initial spec
2026-06-03 — documented staged-decisions + bulk release (E22); recorded the invariant that finalising an accept (direct or via release) upserts a `festival_artists` row, after fixing `ReleaseDecisionsHandler` which omitted it
2026-06-04 — E23: noted PATCH /spots full-replace invariant; click-to-place already shipped; release→festival_artist gap closed in f1a2264
2026-06-04 — E23: pre-release spot eligibility + auto-clear invariant; no-artist-awareness (trimmed /me/applications, gated appearances); PATCH /spots full-replace note.
2026-06-12 — decision-model redesign: `applications.decision` + `released_at` replace `status`/`staged_decision`/`festivals.decisions_released_at`; `festival_artists` is the lineup with a `source` column (no `status`); direct accept/decline/waitlist endpoints removed (single decision writer); release is transactional + idempotent (409 when nothing new); released applications are immutable (PATCH → 409). `/me/applications` exposes `decision` only once `released_at` is set.
2026-06-05 — E26: mural_status on festival_spots (permanent/temporary/unknown, default unknown); center_lat/center_lng on festivals; NearbyHistoryHandler (10 km Haversine, nearby-history before /{spotID}); PATCH /spots full-replace includes mural_status.
2026-06-04 — Epic 1 Phase 1: removed reviewer identity masking entirely (column, stripping, identity_hidden, toggle, e2e). Reviewers always see full identity.
2026-06-04 — Epic 1 Phase 2: reviewer-only scoring queue; trimmed reviewerApplicationResponse seals the decision-field leak.
2026-06-04 — Epic 1 Phase 3: review round open/close lifecycle; sequential decision gate (reviewers score only while open; decisions locked while open); reviewers notified on open (accepted only).
2026-06-05 — Epic 2 (E25): avatar images on kanban cards + reviewer queue; View full profile ↗ button in slide-over; ApplicationArtist.id added to API + OpenAPI.
2026-06-05 — embed field type + form-field-definition validation (form builder A+C): UpsertFormHandler validates id/label/type/options; SubmitApplicationHandler rejects unrecognised embed URLs; provider rules in embed.go mirrored by web/src/lib/embeds.ts.
2026-06-07 — E28 M1: `artistSummary` (organiser/reviewer applications response) now carries `social_links`, `bio`, `support_url` via a live join in `ListApplicationsByFormWithArtist[ExcludingReviewer]` — surfaced to organisers/reviewers automatically, no form field needed. Added to OpenAPI `ApplicationArtist`. Canary test guards the sqlc scan. Not added to `myApplicationResponse` or public responses.
2026-06-07 — E28 M2: form fields accept an optional `prefill` key bound to a profile attribute; UpsertFormHandler validates it against `allowedPrefillKeys` (422 on unknown), mirrored in web/src/lib/prefill.ts. Server only validates — the apply page resolves the value and pre-fills (editable); answers shape unchanged.
