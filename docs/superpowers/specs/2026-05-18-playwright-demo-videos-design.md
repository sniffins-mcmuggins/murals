# Playwright Demo Videos — Design Spec
_Created: 2026-05-18_

## Overview

Six self-contained video demos of the paint festival platform, automated with Playwright and exported as MP4s. Primary audience: CPF organiser meeting (2026/2027 pitch). Secondary: investor deck.

Each demo is an independent HTML file using the established design system (Cormorant Garamond / DM Sans / DM Mono, ink/amber/clay palette) paired with a Playwright script that automates paced, human-feeling interactions.

---

## Demo Scenarios

### Demo 01 — Public Visitor at the Festival (~90s)
**Narrative:** You're at CPF. You see a huge mural. There's a QR code sticker at the bottom. You scan it.

**Flow:**
1. Home screen — CPF 2026 archive card
2. Tap to enter → festival map
3. Pan map, tap Amara Diallo's pin
4. Popup → "View Profile"
5. Artist profile: bio, gallery, QR section, analytics stats
6. Tap Instagram link (opens, demo ends)

**Viewport:** 390×844 (iPhone 14 — simulates mobile app)

---

### Demo 02 — Artist Profile Management (~2m)
**Narrative:** Rosa logs into her artist dashboard, checks her stats, updates her bio, and downloads her QR code.

**Flow:**
1. Artist dashboard — Rosa Vane, logged-in state
2. Analytics: 342 views, 218 QR scans, 94 link clicks
3. Tap "Edit Profile"
4. Edit bio text (type slowly, visible edit)
5. Tap "Save" — confirmation toast
6. Tap "Download QR Code" — simulated download
7. See CPF 2026 festival badge, tap through to festival map

**Viewport:** 390×844

**New screens required:** Artist profile with edit mode, save confirmation toast, QR download interaction.

---

### Demo 03 — Artist Applying to a Festival (~2.5m)
**Narrative:** Applications for CPF 2027 are open. Kit Harrow finds the festival, applies, and gets a response.

**Flow:**
1. Home screen — CPF 2027 "Applications Open"
2. Tap to view festival page
3. "Apply to CPF 2027" button
4. Application form — fill each CPF question with deliberate typing:
   - Proposed work description
   - Wall size
   - Previous outdoor mural experience (Yes)
   - Three portfolio links
   - Public liability insurance (Yes)
   - Preferred medium (Spray)
   - Festival availability (Full period)
   - Anything else (leave blank)
5. "Submit Application" → confirmation screen ("We'll be in touch by March 2027")
6. Cut to: Notifications view → "CPF 2027: Your application has been accepted"
7. Tap notification → personalised acceptance message with festival details

**Viewport:** 390×844

**New screens required:** Festival "Applications Open" page, application form flow, submission confirmation, notifications view, acceptance message.

---

### Demo 04 — Organiser Creating and Managing (~3m)
**Narrative:** The CPF organiser sets up their 2027 festival, builds the application form, and handles the first wave of applicants.

**Flow:**
1. Organiser dashboard — empty 2027 state
2. "Create New Festival": name, dates, location, description
3. "Build Application Form": shows existing 2026 questions, drag to reorder, add one new question
4. Toggle "Go Live" — festival becomes visible to artists
5. Applications start arriving (animated counter incrementing)
6. Review Kit Harrow's application — view portfolio links, read proposed work
7. Accept Kit → Kit pins to map, counter updates
8. Review Tomás Cruz's application
9. Decline with message: "Thank you for applying — we've reached capacity for community portraiture this year"
10. Send bulk "still reviewing" email to remaining pending applicants

**Viewport:** 1024×768 (desktop dashboard)

**New screens required:** Create festival form, form builder with drag-reorder, go-live toggle, application detail view, decline-with-message modal, bulk action.

---

### Demo 05 — Post-Festival Mural Trail (~90s)
**Narrative:** Six months after CPF 2026, a Cheltenham resident finds which murals are still up.

**Flow:**
1. Home screen — CPF 2026 Archive card
2. Festival archive page → map tab
3. Map with status legend: clay pins "Still there", grey pins "Removed"
4. Tap a still-there pin (Amara's mural)
5. Popup showing status badge + "Navigate" button
6. Artist profile with "CPF 2026 — Archive" badge

**Viewport:** 390×844

**New screens required:** Map pin status variants (still there / removed / unknown), status legend, popup with status badge. (Partially exists in cpf_demo.html — needs status differentiation.)

---

### Demo 06 — The QR Moment (~60s)
**Narrative:** The entire platform in one interaction. Someone scans a sticker on a wall and lands on an artist profile.

**Flow:**
1. Opens directly to Amara Diallo's profile (simulating QR scan landing — no navigation, no home screen)
2. Scroll through: bio, gallery, QR section, "Where to find this work" festival badge
3. Tap Instagram
4. End on the QR section with the tagline visible

**Viewport:** 390×844

**New screens required:** None — uses existing artist profile screen.

---

## File Structure

```
demos/
  01-public-visitor/index.html
  02-artist-profile/index.html
  03-artist-apply/index.html
  04-organiser-manage/index.html
  05-post-festival-trail/index.html
  06-qr-moment/index.html

playwright/
  demo-01-public-visitor.ts
  demo-02-artist-profile.ts
  demo-03-artist-apply.ts
  demo-04-organiser-manage.ts
  demo-05-post-festival-trail.ts
  demo-06-qr-moment.ts
  helpers.ts

output/               ← gitignored

playwright.config.ts
package.json
run-demos.sh
```

---

## Technical Setup

### Playwright Configuration

```typescript
// playwright.config.ts
export default {
  use: {
    headless: false,         // visible browser for authenticity
    slowMo: 80,              // base interaction delay
    video: 'on',
    viewport: { width: 390, height: 844 },  // per-script override for demo 04
  },
  outputDir: './output/',
};
```

### Shared Helpers (`playwright/helpers.ts`)

- `pause(ms)` — named wait for dramatic beats between interactions
- `slowType(locator, text, delay?)` — types character by character (default 80ms/char)
- `scrollTo(page, selector)` — smooth scroll to element
- `highlight(page, selector)` — briefly adds amber outline to draw attention

### Video Pipeline

Each script:
1. Records `.webm` via Playwright's native `recordVideo`
2. `run-demos.sh` converts each to MP4:
   ```bash
   ffmpeg -i input.webm -c:v libx264 -pix_fmt yuv420p -movflags +faststart output.mp4
   ```

### HTML Files

Each demo HTML is self-contained:
- All CSS inlined (copied and extended from `cpf_demo.html`)
- All JS inlined (ARTISTS data, CPF_QUESTIONS, navigation logic)
- No external dependencies except CDN fonts (Google Fonts) and Leaflet (CDN)
- No server required — opened via `file://` protocol

---

## New Screens Inventory

Screens that need to be built (do not exist in `cpf_demo.html`):

| Screen | Demo | Notes |
|---|---|---|
| Artist edit mode | 02 | Bio edit textarea, save button, confirmation toast |
| QR download interaction | 02 | Button + simulated download animation |
| Festival "Applications Open" page | 03 | Full festival info + Apply CTA |
| Application form (fillable) | 03 | CPF_QUESTIONS rendered as form fields |
| Submission confirmation | 03 | "We'll be in touch by March 2027" |
| Notifications view | 03 | List of in-app notifications |
| Acceptance message | 03 | Personalised acceptance with festival details |
| Organiser: create festival form | 04 | Name, dates, location, description |
| Organiser: form builder | 04 | Questions list with drag handles + add question |
| Organiser: go-live toggle | 04 | Toggle with confirmation |
| Organiser: application detail | 04 | Full application view with portfolio links |
| Organiser: decline with message | 04 | Modal with custom message field |
| Organiser: bulk action | 04 | "Send update to N pending applicants" |
| Map pin status variants | 05 | Clay = still there, grey = removed, amber = unknown |

---

## Priority Order

For the CPF organiser meeting, build and record in this order:

1. **Demo 04** (organiser) — most directly relevant to the meeting
2. **Demo 03** (artist apply) — shows how they'll recruit artists
3. **Demo 01** (public visitor) — shows festival visitor experience
4. **Demo 06** (QR moment) — shortest, highest impact
5. **Demo 02** (artist profile) — artist side
6. **Demo 05** (post-festival trail) — long-term value story

---

## Success Criteria

- Each video plays without cuts, loading spinners, or awkward pauses
- Interactions feel deliberate and human (not robotic)
- Text typed during demos is legible at 1080p export
- All six MP4s deliverable as standalone files (email/Notion/slide embeds)
- Scripts are re-runnable — re-recording after HTML changes takes one command
