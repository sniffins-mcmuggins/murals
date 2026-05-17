# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Status

Pre-build. No application codebase exists yet — this repo contains planning documents and static HTML demos only. Tech stack decisions are pending (see Outstanding Decisions in README.md).

## What Exists

| File | Purpose |
|------|---------|
| `README.md` | Canonical project reference — read this first every session |
| `cpf_demo.html` | Self-contained static demo for CPF organiser meeting. Leaflet.js + OpenStreetMap, real Cheltenham coordinates, no backend. |
| `project_board_v2.html` | Visual project overview / investor-facing document |
| `paint_festival_platform.pdf` | PDF version of overview for sharing |

### Working with the demo (`cpf_demo.html`)

Open directly in a browser — no server needed. All data is hardcoded JS (`ARTISTS` object, `CPF_QUESTIONS` array). Navigation buttons use real Google Maps and What3Words URLs. Accept/Decline interactions are JS-only state (no persistence).

**Before the CPF meeting:** replace `picsum.photos` placeholder images with real Cheltenham mural photos, and update `CPF_QUESTIONS` with actual CPF application questions.

## Product Architecture (Decided)

Three products sharing one platform:
1. **Public mobile app** — festival maps, artist discovery, QR scanning. No artist/organiser management at launch.
2. **Browser platform** — artist profiles, organiser dashboard, application management. Mobile-responsive but browser-first.
3. **Digital/print magazine** — Substack for digital (no custom CMS needed), external designer for print annual.

**Platform split rationale:** Keeps the app focused and simple. All management tooling stays in the browser at launch.

## Key Technical Decisions (Locked)

- **Maps:** Leaflet.js + OpenStreetMap (free, no API key for basic use)
- **Navigation out:** Google Maps, Apple Maps, What3Words (user preference remembered)
- **QR codes:** Branded, server-generated, encode artist profile URL (auto-updates on URL change), downloadable high-res PNG
- **Chat:** Embedded infrastructure (Stream / Sendbird / Pusher — not built in-house, not Discord)
- **Analytics:** Aggregated only, no individual user tracking — GDPR-clean
- **Artist pricing:** Free £10/yr, Pro £35/yr (5 collections), Pro+ £50/yr (unlimited)
- **Organiser pricing:** £35 setup fee + monthly subscription from go-live (£19/£49/£99 by festival size)

## Outstanding Tech Decisions (TBD)

Framework, app platform (React Native / Flutter / PWA), payment processor, image CDN, hosting, and chat provider are all undecided. Don't assume or implement these without confirming with the user.

## Design System (Demo)

The demo establishes the visual identity — use it as reference for any UI work:

```
Colors:
  --ink:      #1A1A2E  (dark navy — primary dark)
  --amber:    #E8A838  (gold — primary accent)
  --clay:     #C45C3A  (terracotta — secondary accent)
  --offwhite: #FAF7F2  (warm white — background)
  --warm:     #F0EAE0  (warm grey — secondary background)
  --mid:      #8A8896  (mid grey — secondary text)
  --light:    #E2DDD6  (light grey — borders)

Typography:
  Cormorant Garamond (serif) — headings, artist bios, large numbers
  DM Sans — body text, UI labels
  DM Mono — badges, stats, monospace labels (uppercase, letter-spacing)
```

## Mission Constraint

Every feature must serve one of two goals: help an artist make a career, or help the public discover art. Features that don't serve either don't belong. Artists are the foundation — the platform is almost free for them by design.

## Pilot Timeline

- **CPF 2027** (Cheltenham Paint Festival, October 2027) — primary pilot, direct organiser relationship exists
- **Upfest 2027** (Bristol, May/June 2027) — secondary pilot, approach after CPF is confirmed
- Working platform needed by August/September 2027
