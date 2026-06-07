---
name: add-demo-video
description: >
  Add a new demo video clip to the Painttrace demo suite. Use this skill whenever
  the user asks to "add a new demo video", "add a video", "make a video for X", "record a demo
  of Y flow", "add a clip", "add another video to the catalogue", "make a new Playwright demo",
  or wants to extend the demo suite with a new scenario. Also use proactively when a major new
  feature ships and there's no demo clip covering it.
---

# Add Demo Video

The demo suite is a set of **short, single-feature clips** (≤ ~20s each), one Playwright file per
clip, named `persona-feature` so the right one is easy to grab mid-demo. Only `artist-signup`
shows registration/login; every other clip silently injects a session and lands directly on its
page. This skill writes a new clip, updates the living catalogue, and commits.

## Context files to read first

- `docs/superpowers/specs/2026-06-01-demo-videos-design.md` — catalogue table, directory layout,
  silent-auth and off-screen-state design, Playwright config, Taskfile commands
- `demos/scripts/_setup.ts` — silent auth (`silentLogin`, `silentSignup`), lookups
  (`cpfFestivalId`, `myProfileId`), and off-screen organiser state (`openRound`, `closeRound`,
  `stageDecision`, `decideAllAndRelease`, `createSpot`, `assignArtist`)
- `demos/scripts/helpers.ts` — `addCursorOverlay`, `slowType`, `pause`, `highlight`, `scrollTo`,
  and `showDialog` (branded narration card — see "Demo dialogs" below)
- The existing clip closest to the one you're adding — copy its structure exactly

## Step 1: Determine the clip

If the request is clear (persona, feature, the headline moment), proceed. Otherwise ask one
question at a time:

1. **Persona** — Artist or Organiser?
2. **Feature** — the single thing it demonstrates (→ the `persona-feature` name)
3. **Starting state** — which page does it open on, and as whom? (Lady Gabe for most artist
   clips; a fresh silent account if it needs an un-set-up profile; Marcus for organiser clips.)
4. **Off-screen prerequisites** — does the feature need state that must be built first (e.g. an
   accepted artist, a closed round)? That goes in `_setup.ts`, never on camera.

Keep it to one feature. If the user describes a multi-feature journey, split it into several clips.

## Step 2: Add the catalogue row

Edit the Video Catalogue table in the spec. Append a row:

```
| `persona-feature` | Persona | Lands as <whom> | One-line description of the headline moment |
```

## Step 3: Write the clip

Create `demos/scripts/<persona>-<feature>.ts` (the file stem is the MP4 name). The shape:

```typescript
import { test, expect } from '@playwright/test'
import { pause, highlight, addCursorOverlay } from './helpers.js'
import { silentLogin, cpfFestivalId, ORGANISER_EMAIL } from './_setup.js'

test('<persona>-<feature> — <plain description>', async ({ page }) => {
  await addCursorOverlay(page)
  await silentLogin(page /*, ORGANISER_EMAIL */)   // off-screen auth; default = Lady Gabe
  // …optional off-screen state, e.g. await decideAllAndRelease(page, fid, ['Rosa Vane'])
  await page.goto('/the/target/page')              // already authenticated
  // the single headline interaction, paced with pause()/highlight()
  // end on a clear state (a confirmation, a banner, a published page)
})
```

Rules:
- **Don't show login** (except `artist-signup`). Use `silentLogin`/`silentSignup` then `goto`.
- **Never land an artist clip on `/profile`** — Lady Gabe's `setup_completed_at` is null, so it
  redirects to the wizard. Use `/collections`, `/applications`, `/analytics`, `/endorsements`,
  `/artists/{id}`, etc.
- **Off-screen state belongs in `_setup.ts`** (it acts as the logged-in user via `page.request`;
  the session cookie out-ranks the `Authorization` header). Reuse the existing helpers; add a new
  one there if the API call is genuinely new. Remember release requires *every* submitted
  application to have a staged decision (`decideAllAndRelease` handles this).
- **Keep it ≤ ~20s.** Fewer pauses, only the headline steps. If it can't fit, it's two clips.

### Pacing guide
- `pause(600–900)` — between steps on the same page
- `pause(1500)` — between pages / after an important action
- `pause(2000–2500)` — at the end, before the recording cuts off
- `slowType(locator, text)` — all typed content (default 45ms/char)

### Demo dialogs (`showDialog`)
`await showDialog(page, 'one short sentence explaining this step', { pos: 'top' | 'bottom' })`
injects a branded narration card that pauses the walkthrough while the viewer reads, then fades.
Use it to explain *what's happening* — heavily in long/combined clips, once or twice in short
ones. Pick `pos` so the card doesn't cover the element you're about to act on (e.g. `'bottom'`
when the action is a top-of-page button like "Open review round"). Keep each line to one sentence.

### Combined / journey clips
Most clips cover one feature, but a few combine a natural flow (e.g. `artist-onboarding` =
signup + wizard; `organiser-review` = triage + review round + placement summary). These run
longer (>30s) and that's fine — narrate each phase with `showDialog`. To reach a later phase's
starting state, drive the earlier API steps off-screen via `_setup.ts` rather than on camera.

## Step 4: Wire it into the suite

- Add the clip to the `for:` list in `demo:all` (Taskfile.yml, `demo:all` task).
- No config change needed — `testMatch: ['**/artist-*.ts', '**/organiser-*.ts']` already picks up
  any new `persona-feature` file. (A new persona prefix needs a new testMatch entry.)
- If it needs seed data that doesn't exist yet, update `demos/seed/main.go` and note it — don't
  silently skip it.

## Step 5: Record and verify

```bash
task up            # stack must be running (api :8080 + web :3000)
task demo:record V=<persona>-<feature>    # re-seeds, then records (visible browser)
task demo:convert  # webm → output/<clip>.mp4
```

Confirm it passed and the MP4 exists. Check duration: `ffprobe -v error -show_entries
format=duration -of csv=p=0 demos/output/<clip>.mp4`.

## Step 6: Commit

```bash
git add docs/superpowers/specs/2026-06-01-demo-videos-design.md \
        demos/scripts/<persona>-<feature>.ts Taskfile.yml
git commit -m "feat(demos): add <persona>-<feature> clip"
```

(Commit the script + spec + Taskfile. MP4s/webms under `demos/output/` are gitignored.)

## Notes

- The catalogue table is the living reference. Every clip lives there.
- `_setup.ts` is **not** a test file (excluded from `testMatch`) — it's the shared module. Put
  reusable auth/lookup/state logic there, not in `helpers.ts` (which is for recording aids).
- If the user says "make it like X but for Y", read clip X first and adapt it directly.
