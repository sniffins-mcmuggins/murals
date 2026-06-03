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
| V01 | Organiser  | Setting Up a Festival        | From scratch | Signup → create festival → build application form → go live |
| V02 | Organiser  | Reviewing Applications       | Pre-seeded   | Log in → inbox of applications → review → accept/decline → artist pinned to map |
| V03 | Artist     | Signing Up & Building a Profile | From scratch | Signup → fill bio + links → upload portfolio image → publish profile |
| V04 | Artist     | Applying to a Festival       | Pre-seeded   | Log in → find CPF 2027 → complete application form → submit |
| V05 | Artist     | Artist Journey (combined)    | From scratch + pre-seeded CPF 2027 | Signup → profile → image upload → publish → apply to CPF 2027 → submit. Supersedes V03+V04 — one session, no second login. |
| V06 | Organiser  | Organiser Full (combined)    | Pre-seeded   | Login → festival detail/form browse → applications inbox → accept → map pin → decline. Supersedes V01+V02 — one session, no setup login. |

---

## Directory Structure

```
demos/
  seed/
    demo.sql        ← pre-seeded data (demo organiser, demo artist, festival, applications)
    seed.go         ← thin Go script: drops demo accounts, re-runs demo.sql against the live DB
  scripts/
    V01-organiser-setup.ts
    V02-organiser-review.ts
    V03-artist-signup.ts
    V04-artist-apply.ts
    helpers.ts      ← slowType, pause, highlight, scrollTo
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

### Demo artist (pre-seeded — used by V02 map pin + V04)
- **Name:** Lady Gabe (the primary demo artist persona across all demos and screenshots)
- **Email:** `ladygabe@demo.art`
- **Password:** `demo-password-2027`
- **Profile:** Pre-seeded with bio, social links, and portfolio images sourced from ladygabe.com
- **Profile status:** `public` at seed time — V04 logs in as this account

### V03 signup artist (created fresh during recording)
- V03 uses a fresh throwaway email (`gabe-signup-demo@demo.art`) so it can show the full signup flow without conflicting with the pre-seeded Lady Gabe account. The content typed during V03 mirrors Lady Gabe's real bio/links for visual consistency.

### Application seed data (for V02)
25 applications from fictional artists against CPF 2027. Mix of statuses:
- 10 `pending` (queue to review)
- 8 `accepted` (already pinned to map)
- 4 `rejected`
- 3 `waitlisted`

Each application includes: proposed work description, wall size preference, medium, portfolio links (3 per artist), public liability insurance confirmation.

### `task demo:seed`
Runs `demos/seed/seed.go` which:
1. Deletes any existing rows for the demo emails
2. Re-inserts organiser + artist accounts (pre-hashed passwords)
3. Re-inserts festival + applications
4. Safe to re-run at any time — idempotent

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

#### V01 — Organiser Setup (~2min)
1. Navigate to `/register` — sign up as new organiser
2. Slow-type name, email, password
3. Redirect to organiser dashboard — empty state
4. Click "Create Festival" → fill: name "Cheltenham Paint Festival 2027", dates, location
5. Save → go to form builder
6. Show pre-populated CPF question set, drag one question to reorder
7. Click "Go Live" → confirmation → festival status becomes `open`
8. End on festival dashboard showing "0 applications"

#### V02 — Organiser Review (~2.5min)
1. Navigate to `/login` — log in as Marcus Webb (pre-seeded)
2. Dashboard: "CPF 2027 — 10 pending applications"
3. Click into first application (fictional artist, rich content)
4. Review: scroll through bio, portfolio links, proposed work
5. Click "Accept" → acceptance confirmation
6. Navigate to map → accepted artist's pin appears
7. Back to inbox → open second application
8. Click "Decline" → type brief message → confirm
9. End on inbox showing updated counts

#### V03 — Artist Signup (~2min)
1. Navigate to `/register` — sign up as fresh artist (email: `gabe-signup-demo@demo.art`)
2. Slow-type name, email, password
3. Redirect to artist dashboard — empty profile state
4. Click "Edit Profile" → fill bio, Instagram, website (Lady Gabe's real content)
5. Upload one portfolio image
6. Click "Publish" → profile status becomes `public`
7. Click "View public profile" → land on public artist profile page
8. End on the live profile

#### V04 — Artist Apply (~2min)
1. Navigate to `/login` — log in as Lady Gabe (pre-seeded, profile already public)
2. Navigate to "Find Festivals" → CPF 2027 listed as open
3. Click "Apply" → application form
4. Slow-type each answer: proposed work, medium (spray), wall size, portfolio links
5. Scroll through remaining questions, fill them
6. Click "Submit Application" → confirmation screen
7. End on confirmation: "We'll be in touch"

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
