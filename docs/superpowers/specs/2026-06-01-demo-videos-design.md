# Demo Videos — Design Spec
_Created: 2026-06-01_

## Overview

Automated, reproducible short-form MP4 videos of the real running platform — not static HTML mockups. Primary audience: prospective artists, organisers, and friends. Produced by Playwright scripts driving the live Docker Compose stack, with ffmpeg converting recordings to MP4. Re-runnable as the platform evolves.

This replaces the earlier static-HTML demo video approach (`2026-05-18-playwright-demo-videos-design.md`), which was designed before the platform existed.

---

## Video Catalogue

This table is the living reference. Add rows as new videos are commissioned.

| ID  | Persona    | Title                        | DB approach  | Key moments |
|-----|------------|------------------------------|--------------|-------------|
| V05 | Artist     | Artist Journey               | From scratch + pre-seeded CPF 2027 | Signup page → "Continue with Google" → dashboard → profile pic + headline photo → bio → portfolio collection → publish → view public page → apply to CPF 2027 → submit |
| V06 | Organiser  | Organiser: Review Round + Staged Decisions | Pre-seeded (5 submitted + Sophie as accepted reviewer with scores) | Login → CPF 2027 → applications kanban → **Open review round** → decisions locked (drag handles gone) → **Close round** → ★ scores visible on cards → reorder cards by score → drag to Accept/Waitlist/Decline → Release → post-release banner → map editor (geocode search, place spot, set dimensions + mural status + What3Words/Google/Apple deep-links, drag to position, assign artist) → festival-page spot-assignment summary |

---

## Directory Structure

```
demos/
  seed/
    main.go         ← idempotent seed: drops and re-inserts all demo accounts, festival, applications, images
  scripts/
    V05-artist-journey.ts
    V06-organiser-full.ts
    helpers.ts      ← slowType, pause, highlight, scrollTo
  fixtures/         ← committed image files used during recording (Lady Gabe + CPF murals)
  output/           ← gitignored, MP4s land here
  playwright.config.ts
  package.json      ← separate from web/ — just playwright + @types/node
  run.sh            ← wrapper: seed → record → ffmpeg convert
```

---

## Demo Personas & Seed Data

### Demo organiser
- **Name:** Marcus Webb
- **Email:** `marcus@cpf-demo.art`
- **Password:** `demo-password-2027` (hardcoded in seed, not a real account)
- **Festival:** Cheltenham Paint Festival 2027 — status `open`, 25 pre-seeded applications

### Demo artist (pre-seeded — V05 creates a fresh account; V06 map pins link to these profiles)
- **Name:** Lady Gabe (the primary demo artist persona across all demos and screenshots)
- **Email:** `ladygabe@demo.art`
- **Password:** `demo-password-2027`
- **Profile:** Pre-seeded with avatar (exhibition portrait), headline image, bio, social links, and portfolio images sourced from ladygabe.com
- **Profile status:** `public` at seed time

### V05 signup artist (created fresh during recording)
- V05 creates a fresh throwaway email (`gabe-{timestamp}@demo.art`) to show the real signup flow. The content typed mirrors Lady Gabe's real bio/links for visual consistency.

### Application seed data (for V06)
5 applications from fictional artists against CPF 2027, all `submitted`:
- Kit Harrow (spray paint, large wall) — Sophie score ★4
- Yuki Tanaka (brush, small wall) — Sophie score ★3
- Tomás Cruz (mixed media, medium wall) — Sophie score ★2
- Amara Diallo (spray paint, large wall) — Sophie score ★5
- Rosa Vane (brush, medium wall) — Sophie score ★5

Plus **Sophie Park** (`sophie@cpf-reviewer.art`) seeded as an accepted reviewer with pre-scored applications — so the organiser can open the round, close it, and see ★ averages on cards without needing a live reviewer session.

5 cards in one column gives enough material to show within-column ranking (drag to reorder by score) before deciding, and the viewer watches every card get staged and the Release button enable live.

### `task demo:seed`
Runs `demos/seed/main.go` which:
1. Deletes any existing rows for the demo emails
2. Re-inserts organiser + artist accounts (pre-hashed passwords)
3. Re-inserts festival, application form, applications, and festival spots
4. Seeds portfolio images for Lady Gabe and accepted artists from real photo CDN URLs
5. Safe to re-run at any time — idempotent

---

## Script Design

### Shared helpers (`demos/scripts/helpers.ts`)

```typescript
pause(ms: number)                    // deliberate beat between interactions
slowType(loc, text, delayMs = 80)    // character-by-character typing
scrollTo(page, selector)             // smooth scroll
highlight(page, selector)            // brief amber outline to draw the eye
```

### Per-script flow

#### V05 — Artist Journey (~80s)
1. Sign up fresh (`gabe-{timestamp}@demo.art`) → log in → artist dashboard
2. Profile page: upload avatar (portrait), upload headline photo, type short bio + Instagram
3. Save profile
4. Create collection "Murals 2027" → upload 2 Lady Gabe mural photos
5. Publish profile → status becomes `public`
6. View public artist page — scroll through avatar, bio, headline image, collection
7. Navigate to Applications → CPF 2027 open → click Apply
8. Fill form (mural concept, wall size, medium, portfolio links, insurance, availability)
9. Submit → confirmation screen

#### V06 — Organiser: Review Round + Staged Decisions (~75s)
1. Log in as Marcus Webb (pre-seeded)
2. Navigate to CPF 2027 festival detail
3. Open applications — kanban shows 5 cards in Undecided; "Open review round" banner visible
4. Click **Open review round** → round opens, decisions locked, drag handles disappear
5. Click **Close round** → "Review round closed · scores final" banner, ★ scores now on cards
6. Rank within Undecided by score: drag Rosa Vane (★5) up, Amara Diallo (★5) up
7. Drag Rosa Vane → ✓ Accept, Amara Diallo → ✓ Accept (both ★5)
8. Drag Kit Harrow → ~ Waitlist (★4), Yuki Tanaka → ~ Waitlist (★3)
9. Drag Tomás Cruz → ✗ Decline (★2) — Release button enables ("Release 5 decisions →")
10. Click "Release 5 decisions →" — modal opens; "Yes, release" is disabled
11. Tick "I understand…" checkbox — "Yes, release" enables
12. Click "Yes, release"
13. Post-release banner: "Decisions released · artists notified by email"
14. Scroll to show Accepted/Waitlisted/Declined columns with "Notified ✓" badges
15. Navigate to Map Editor → geocode search for Cheltenham → place a spot
16. Fill the spot panel: What3Words, wall width/height, mural status, internal notes; show the What3Words / Google Maps / Apple Maps deep-links → Save (E23.3)
17. Drag the pin to reposition it (E23.2) → drag an accepted artist from the unassigned rail onto the pin (E23.7)
18. Back on the festival detail page, the **Spot assignments** summary lists assigned artists ✓ and any still unassigned ⚠ (E23.8)

**Seed requirement:** Run `task demo:seed` to reset. All 5 applications must be `submitted`; Sophie Park (`sophie@cpf-reviewer.art`) seeded as an accepted reviewer with pre-scored applications (★ scores: Rosa 5, Amara 5, Kit 4, Yuki 3, Tomás 2).

---

## Technical Configuration

### Playwright config (`demos/playwright.config.ts`)

```typescript
export default defineConfig({
  use: {
    baseURL: 'http://localhost:3000',
    headless: false,      // visible browser — authenticity matters
    slowMo: 60,           // base delay for all interactions
    video: 'on',
    viewport: { width: 1280, height: 800 },  // desktop — all flows are browser platform
  },
  outputDir: './output/raw/',
  workers: 1,             // sequential — one video at a time
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

```yaml
demo:seed:
  desc: "Wipe and re-seed the demo DB accounts"
  cmd: go run demos/seed/seed.go

demo:record:
  desc: "Record one video. Usage: task demo:record V=V02"
  cmd: cd demos && npx playwright test scripts/{{.V}}-*.ts

demo:all:
  desc: "Seed DB then record all four videos in sequence"
  cmds:
    - task: demo:seed
    - task: demo:record V=V01
    - task: demo:record V=V02
    - task: demo:record V=V03
    - task: demo:record V=V04
```

---

## Success Criteria

- Each video plays without cuts, loading errors, or awkward pauses
- Interactions feel deliberate and human — not robotic
- Text typed during recordings is legible at 1080p
- All four MP4s are standalone files (shareable via email, Notion, WhatsApp)
- `task demo:all` re-records everything from scratch after any platform change
- `task demo:seed` is idempotent — safe to run multiple times

---

## Out of Scope

- Public visitor / QR moment videos (deferred — not needed for current outreach)
- Mobile app recording (React Native — different toolchain; add a new row to the catalogue when ready)
- Audio / voiceover (silent for now)
- Automatic upload or sharing (manual step after recording)
