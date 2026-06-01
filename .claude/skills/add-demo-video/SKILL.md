---
name: add-demo-video
description: >
  Add a new demo video to the Painttrace platform demo video suite. Use this skill whenever
  the user asks to "add a new demo video", "add a video", "make a video for X", "record a demo
  of Y flow", "add video V05", "add another video to the catalogue", "make a new Playwright demo",
  or wants to extend the demo suite with a new scenario. Also use proactively when a major new
  feature ships and there's no demo video covering it.
---

# Add Demo Video

Adds a new video to the Painttrace demo suite — updates the living catalogue in the spec, writes
the Playwright script, and commits both.

## Context files to read first

Before doing anything, read these (they're small):

- `docs/superpowers/specs/2026-06-01-demo-videos-design.md` — the spec with the catalogue table,
  directory structure, Playwright config, and helper patterns
- `demos/scripts/helpers.ts` — the shared helpers (`slowType`, `pause`, `highlight`, `scrollTo`)
  that every script uses
- Any existing script in `demos/scripts/` for the relevant persona — follow the exact same
  structure (imports, page flow, pacing)

## Step 1: Determine the new video

Read the catalogue table from the spec to find the next ID (V05, V06, etc.).

If the user's request is clear (persona, flow, key moments), proceed. If any of these are missing,
ask — but keep it to one question at a time:

1. **Persona** — Organiser, Artist, or Public?
2. **Title** — short, action-oriented ("Viewing the Festival Map", "Managing Collections")
3. **DB approach** — does this video need a pre-seeded state, or does it start from scratch?
4. **Key moments** — the 4–8 steps the viewer will see; be specific about which pages and actions

## Step 2: Add the catalogue row

Edit `docs/superpowers/specs/2026-06-01-demo-videos-design.md`. Find the Video Catalogue table
and append a new row:

```
| V0N | Persona | Title | Pre-seeded or From scratch | Key moments summary |
```

Keep the key moments concise (one cell, pipe-delimited if needed).

## Step 3: Write the Playwright script

Create `demos/scripts/V0N-<kebab-title>.ts`. Follow the pattern from existing scripts exactly:

```typescript
import { test } from '@playwright/test'
import { slowType, pause, highlight, scrollTo } from './helpers.js'

const API = process.env.API_URL ?? 'http://localhost:8080'

test('V0N — <Title>', async ({ page }) => {
  // Each meaningful section gets a comment header: // ── 1. Description ─────

  // Pre-seeded videos: log in with demo credentials
  // From-scratch videos: go to /signup and create a fresh account

  // Use slowType() for all user-visible text entry (bio, form answers, names)
  // Use pause(1200) between major sections for visual breathing room
  // Use highlight() before clicking an important button to draw the viewer's eye
  // Use scrollTo() before interacting with off-screen elements

  // End on a meaningful state — a confirmation screen, a published page, a dashboard
})
```

### Pacing guide

- `pause(600)` — between steps on the same page
- `pause(1200)` — between pages / major sections
- `pause(2000)` — at the end, before the recording cuts off
- `slowType(locator, text, 80)` — all typed content (80ms per char is the default)

### Admin grant (if the video needs publish access for a fresh artist)

If V03-style: after the artist saves their profile, the script needs to grant access before
clicking "Go Public". Do it programmatically (not on-screen):

```typescript
// Get artist's user ID
const profileRes = await page.request.get(`${API}/profiles/me`)
const { user_id: artistUserId } = await profileRes.json()

// Log in as admin and grant access (not shown in the browser)
const adminLogin = await page.request.post(`${API}/auth/login`, {
  data: { email: 'admin@demo.art', password: 'demo-password-2027' },
})
const { token: adminToken } = await adminLogin.json()
await page.request.post(`${API}/admin/users/${artistUserId}/grants`, {
  headers: { Authorization: `Bearer ${adminToken}` },
  data: { plan: 'artist_basic', duration_days: 365, note: 'Demo access' },
})
// Now continue: click "Go Public" in the browser
```

## Step 4: Commit

Stage and commit both files together:

```bash
git add docs/superpowers/specs/2026-06-01-demo-videos-design.md demos/scripts/V0N-*.ts
git commit -m "feat(demos): add V0N — <Title>"
```

## Step 5: Report back

Tell the user:
- The new video ID and what it shows
- The script path
- How to record it: `task demo:record V=V0N`
- Whether the DB needs re-seeding first (`task demo:seed`) — yes if the video uses pre-seeded data

## Notes

- The catalogue table is the living reference. Every video ever commissioned lives here.
- If the new video needs seed data that doesn't exist yet (new personas, new festival state),
  note it clearly and suggest updating `demos/seed/main.go` — don't silently skip it.
- Keep scripts self-contained: don't extract shared setup into helpers.ts unless the same
  setup appears in 3+ scripts.
- If the user says "make it like V02 but for X", read V02's script first and adapt it directly.
