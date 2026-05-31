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

## Invariants
- Public `GetHandler` returns 404 for any festival with status NOT IN (`open`, `live`) — anonymous callers must never see `draft` or `closed` festivals
- An artist may only have one active (non-withdrawn) application per festival
- `spots.application_id` uniqueness: a confirmed application can only be assigned to one spot
- Reorder endpoints (`/applications/reorder`, `/spots/reorder`) MUST be registered before their `/{id}` siblings in chi

## AI Context
- `festival.go`: festival CRUD — `GetHandler` contains the public-status gate
- `application.go`: application submit/patch/status + most of the review lifecycle
- `review.go`, `score.go`: reviewer scoring and rubric logic
- `reviewers.go`: panellist account management
- `spots.go`: map spot assignment
- `form.go`: dynamic application form builder
- `map.go`: `GetMapDataHandler` — public endpoint returning spot locations + artist previews for the Leaflet map
- `appearances.go`: `POST /appearances` wires confirmed application → artist profile for public display
- `access.go`: the organiser-ownership check — used by most handlers to confirm the caller owns the festival
- `testhelpers_test.go`: shared test helpers (festival/application setup) — check this before writing new tests to avoid duplication

## Changelog
2026-05-31 — initial spec
