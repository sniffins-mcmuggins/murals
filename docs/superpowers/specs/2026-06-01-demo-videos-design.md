# Demo Videos — Design Spec
_Created: 2026-06-01_

## Overview

Automated, reproducible short-form MP4 videos of the real running platform — not static HTML mockups. Primary audience: prospective artists, organisers, and friends. Produced by Playwright scripts driving the live Docker Compose stack, with ffmpeg converting recordings to MP4. Re-runnable as the platform evolves.

This replaces the earlier static-HTML demo video approach (`2026-05-18-playwright-demo-videos-design.md`), which was designed before the platform existed.

---

## Video Catalogue

Each clip is named `persona-feature` so the right one is easy to grab mid-demo. Most cover one
feature; a few combine a natural journey and run longer (lengths below are approximate recorded
durations). Only `artist-onboarding` shows registration/login; every other clip silently injects
a session and lands directly on its target page (see "Silent auth" below). Narration is provided
by on-screen **demo dialogs** (see below). This table is the living reference — add a row per clip.

| Clip (file = MP4 name)            | Persona   | ~Len | Lands as           | What it shows |
|-----------------------------------|-----------|------|--------------------|---------------|
| `artist-onboarding`               | Artist    | ~80s | fresh account      | Sign-up form → "Check your inbox" → log in → the **full, narrated 9-step setup wizard** → **Publish**. The only clip that shows auth, and the most thorough. |
| `artist-public-profile`           | Artist    | ~12s | Lady Gabe (seeded) | The public artist page: headline strip, bio + medium tags, collection, organiser + peer endorsements. |
| `artist-collections`              | Artist    | ~26s | Lady Gabe (seeded) | Collections list → open "Murals 2027" → browse images → **how the collection looks publicly**. |
| `artist-apply-to-festival`        | Artist    | ~18s | Lady Gabe (seeded) | Applications → Apply to CPF 2027 → fill the form → **Application submitted**. |
| `artist-endorsements`             | Artist    | ~10s | Lady Gabe (seeded) | Endorsements manager — hide a peer endorsement (greys out), then show it again. |
| `artist-analytics`                | Artist    | ~8s  | Lady Gabe (seeded) | Analytics dashboard — profile views / QR scans / link clicks (aggregated, GDPR-clean). |
| `organiser-form-builder`          | Organiser | ~12s | Marcus (seeded)    | Visual form builder → "Add from library" → media-embed walkthrough/3D field → **Save form**. |
| `organiser-review`                | Organiser | ~50s | Marcus (seeded)    | The full review story: quick-select **triage** → open round → score → close → (off-screen decide + place) → **spot-assignment summary**. The longest clip. |
| `organiser-decisions-release`     | Organiser | ~21s | Marcus (seeded)    | Drag the two hero accepts to Accept (the no's are pre-sorted off-screen) → release decisions. |
| `organiser-map-editor`            | Organiser | ~21s | Marcus (seeded)    | Geocode search → confirm draft pin → spot panel deep-links → drag an accepted artist onto the pin. |

### Demo dialogs (`showDialog`)
`helpers.ts → showDialog(page, text, { pos })` injects a branded (ink + amber) narration card
that fades in, holds while the viewer reads (time scales with text length), then fades out —
**deliberately pausing the walkthrough** so each step is clear. It is a recording-only overlay
(`pointer-events: none`, never in the real app). `pos: 'top'` (default) or `'bottom'` — choose
whichever doesn't cover the action. Used heavily in the long clips (`artist-onboarding`,
`organiser-review`, `artist-collections`) and once or twice in the shorter ones for context.

### Known gaps (flagged, not yet clips)
- **QR-code download** — the artist spec lists it, and the API exists (`GET /profiles/me/qr`), but there is **no web UI** to trigger a download, so it can't be filmed. Add a clip once a download button ships.
- **Endorsements visibility PATCH** drops `endorser_display_name` in its response, so on the manager the peer name flips to "Anonymous" after a hide/show until reload. Minor UI bug; the clip works around it by locating the card by body text.

---

## Directory Structure

```
demos/
  seed/
    main.go         ← idempotent seed: demo accounts, festival, applications, endorsements, analytics, images
  scripts/
    artist-*.ts        ← one file per artist clip (6)
    organiser-*.ts     ← one file per organiser clip (4)
    _setup.ts          ← silent auth (silentLogin/silentSignup), lookups, off-screen organiser state. NOT a test (excluded from testMatch).
    helpers.ts         ← addCursorOverlay, slowType, pause, highlight, scrollTo, showDialog
  fixtures/         ← committed image files used during recording (Lady Gabe + CPF murals)
  output/           ← gitignored; output/raw/<clip>/ holds the .webm, output/<clip>.mp4 the final
  playwright.config.ts   ← testMatch scoped to artist-*/organiser-*
  package.json      ← separate from web/ — just playwright + @types/node
  run.sh            ← converts each output/raw/<clip>/*.webm → output/<clip>.mp4
```

### Silent auth (every clip except `artist-signup`)
`_setup.ts` exposes `silentLogin(page, email?)` and `silentSignup(page, email)`: they hit the API
directly, then drop the `session` cookie on the browser context — so the very next `page.goto`
is already authenticated, with no login UI on camera. Artist clips land as the seeded **Lady
Gabe**; organiser clips land as **Marcus Webb**. `artist-onboarding` is the exception — it shows
the real sign-up + login UI and then walks the wizard on a brand-new account.

> Note: the API auth middleware prefers the **session cookie over the `Authorization` header**.
> Because the cookie domain is `localhost` (port-agnostic), the same session authenticates the
> browser (`:3000`) and `page.request` calls to the API (`:8080`). Organiser off-screen setup
> therefore just uses `page.request` as the logged-in organiser — no Bearer juggling.

### Off-screen state (organiser clips)
Clips that need the festival past a certain point build it via the API in `_setup.ts`, never on
camera: `openRound`/`closeRound`, `stageDecision`, `decideAllAndRelease` (release requires *every*
submitted application to have a staged decision), `createSpot`, `assignArtist`. The recording
then shows only the headline interaction. Each clip re-seeds first (`demo:record` depends on
`demo:seed`, which is `run: always`), so clips never inherit another clip's mutations.

---

## Demo Personas & Seed Data

### Demo organiser
- **Name:** Marcus Webb
- **Email:** `marcus@cpf-demo.art`
- **Password:** `demo-password-2027` (hardcoded in seed, not a real account)
- **Festival:** Cheltenham Paint Festival 2027 — status `open`

### Demo artist (pre-seeded — the default `silentLogin` identity for artist clips)
- **Name:** Lady Gabe (the primary demo artist persona across all demos and screenshots)
- **Email:** `ladygabe@demo.art`
- **Password:** `demo-password-2027`
- **Profile:** Pre-seeded with avatar (exhibition portrait), headline image, bio, social links, portfolio collection "Murals 2027", a 2-year access grant, **two endorsements** (organiser from Marcus / CPF, peer from Amara Diallo), and **analytics events** (342 views · 57 scans · 124 clicks) so the analytics clip shows real numbers.
- **Profile status:** `public` at seed time. (`setup_completed_at` is null, so do not land an artist clip on `/profile` — it redirects to the wizard.)

### Application seed data
4 applications from fictional artists against CPF 2027, all `submitted`, each with a Sophie Park score:
- Kit Harrow (spray paint, large wall)
- Tomás Cruz (mixed media, medium wall)
- Amara Diallo (spray paint, large wall)
- Rosa Vane (brush, medium wall)

Plus **Sophie Park** (`sophie@cpf-reviewer.art`) seeded as an accepted reviewer with pre-scored applications — so an organiser clip can open/close a round and see ★ averages without a live reviewer session.

### `task demo:seed`
Runs `demos/seed/main.go` which (idempotent, safe to re-run):
1. Deletes any existing rows for the demo emails
2. Re-inserts admin + organiser + artist + fictional-artist accounts (pre-hashed passwords)
3. Re-inserts festival, application form, applications, reviewer scores, festival spots
4. Seeds Lady Gabe's collection images, two endorsements, and analytics events
5. Seeds the prior-year `cpf-2026` festival + historical spots (mural-history map)

---

## Script Design

### Shared helpers (`demos/scripts/helpers.ts`)

```typescript
addCursorOverlay(page)               // amber cursor dot + click ripple, injected on every page
pause(ms)                            // deliberate beat between interactions
slowType(loc, text, delayMs = 45)    // character-by-character typing
scrollTo(page, selector)             // smooth scroll
highlight(page, selector)            // brief amber outline to draw the eye
showDialog(page, text, { pos })      // branded narration card; pauses while the viewer reads
```

### Per-clip structure
Every clip follows the same shape:
1. `addCursorOverlay(page)`
2. silent auth (`silentLogin` / `silentSignup`) — except `artist-onboarding`, which shows it
3. optional off-screen state (organiser clips)
4. `page.goto(targetPage)` — already authenticated
5. the headline interaction(s), paced with `pause` / `highlight`, narrated with `showDialog`
6. end on a clear state (a confirmation, a published page, a banner)

Most clips run ≤ ~25s; the combined journeys (`artist-onboarding` ~80s, `organiser-review` ~50s)
are intentionally longer. The scripts are the source of truth.

---

## Technical Configuration

### Playwright config (`demos/playwright.config.ts`)

```typescript
export default defineConfig({
  testDir: './scripts',
  testMatch: ['**/artist-*.ts', '**/organiser-*.ts'],  // _setup.ts / helpers.ts excluded
  workers: 1,             // sequential — one video at a time
  timeout: 60000,         // bounded so a stuck selector doesn't waste minutes mid-batch
  use: {
    baseURL: 'http://localhost:3000',
    headless: false,      // visible browser — authenticity matters
    slowMo: 60,           // base delay for all interactions
    video: 'on',
    viewport: { width: 1280, height: 800 },  // desktop — all flows are browser platform
  },
  outputDir: './output/raw',
  cleanOutputDir: false,
});
```

### Video pipeline

Playwright records `.webm` natively. `run.sh` converts each to MP4:

```bash
ffmpeg -i input.webm -c:v libx264 -pix_fmt yuv420p -movflags +faststart output.mp4
```

Output lands in `demos/output/` (gitignored).

### Package (`demos/package.json`)

Minimal — just Playwright and types. Does not share `node_modules` with `web/`.

---

## Taskfile Tasks

```bash
task demo:seed                              # wipe + re-seed (run: always)
task demo:record V=artist-signup            # re-seed, then record one clip by name
task demo:record V=organiser-map-editor     # …any clip; V is the file stem
task demo:convert                           # webm → mp4 for everything recorded
task demo:all                               # re-seed + record every clip (for-loop), then convert
```

- `demo:record` re-seeds first (`deps: [demo:seed]`); `demo:seed` is `run: always` so the
  re-seed actually re-runs before each clip in `demo:all` (organiser clips mutate state).
- `--output=output/raw/{{.V}}` keeps each clip's `.webm` in its own folder; `run.sh` names the
  MP4 after that folder → `output/<clip>.mp4`.

---

## Success Criteria

- Each clip plays without cuts, loading errors, or awkward pauses
- Single-feature clips stay short (≤ ~25s); combined journeys may run longer by design
- Narration (`showDialog`) makes each step legible without a voiceover
- Interactions feel deliberate and human — not robotic
- Every MP4 is a standalone file named `persona-feature` (shareable via email, Notion, WhatsApp)
- `task demo:all` re-records every clip from scratch after any platform change
- `task demo:seed` is idempotent — safe to run multiple times

---

## Out of Scope

- Public visitor / QR moment videos (deferred — not needed for current outreach)
- Mobile app recording (React Native — different toolchain; add a new row to the catalogue when ready)
- Audio / voiceover (silent for now)
- Automatic upload or sharing (manual step after recording)
