# Public App — Design Spec

**Date:** 2026-05-17
**Status:** Approved
**Scope:** Public-facing mobile app only. No artist or organiser management features at launch — those live in the browser platform.

---

## Overview

The public app has one job: help someone at a festival find artists and navigate to their work, and give the general public a reason to discover art between festivals. It is deliberately simple. Zero friction is the guiding principle — a visitor at a festival should be able to open the app, find the map, and navigate to an artist in under a minute without creating an account.

No engagement algorithm. No advertising. No dark patterns.

---

## 1. Accounts

Account creation is optional. The app works fully without one.

Signing in unlocks: saved artists persisting across devices. Without sign-in, saves are local to the device only.

Sign-in is lightweight — email or social auth. A soft prompt to create an account appears when a user first tries to save an artist, not before. The optional account also serves as light bot protection (captcha or similar on sign-up).

**Navigation preference** (Google Maps / Apple Maps / What3Words) is stored locally after first use. If the user is signed in, it syncs to their account.

---

## 2. Festival Detection

When the app is opened, it checks the user's location. If they are at or near a known festival:

- A soft prompt appears: *"It looks like you're at Cheltenham Paint Festival — open the map?"*
- User confirms or dismisses
- Dismissing returns them to the Home screen; they can navigate to the festival manually

No hard redirect. The user is always in control of where the app takes them.

---

## 3. Home / Explore

Editorially curated — not algorithmic. Content is selected and ordered by the platform team, not by engagement signals.

**Home feed contains:**
- Live festivals (nearby first, then wider)
- Coming Soon festival listings
- Recent featured artist blog posts (from the editorial magazine)
- Recent artist profiles (team-selected, not ranked by views or saves)

Tapping a festival card opens the festival page. Tapping an artist opens their profile. Tapping a blog post opens the full post.

---

## 4. Festival Map

Full-screen interactive map using Leaflet.js + OpenStreetMap. This is the primary screen for visitors at a festival.

**Map pins:** each accepted artist has a pin at their assigned wall location. Pins show the artist's photo and name. Tapping a pin opens an artist card popup.

**Artist card popup contains:**
- Photo, name, one-line bio
- What3Words address
- Two actions: **View Profile** and **Navigate**

**Navigate** fires out to the user's preferred navigation app (Google Maps, Apple Maps, or What3Words). Preference is remembered after first use.

**Additional map controls:**
- Filter by medium
- Toggle to list view (same artists, presented as a scrollable list instead of map)

**Two map modes** (organiser-configured, not user-selected):
1. **Geographic** — real map, pins on actual streets
2. **Custom layout** — organiser-uploaded venue plan with pins overlaid. Navigate fires to venue entrance coordinates.

What3Words coordinates are auto-generated for every pin.

---

## 5. Artist Profile

The same profile visible in the browser, rendered for mobile. Accessible from map pins, Discover swipes, blog posts, and QR code scans.

**Profile contains:**
- Photo, name, medium tags, location (if artist has opted in to display it)
- Bio
- Portfolio collections and gallery
- Work map (all their pinned pieces)
- Festival history
- Social links
- "Support this artist" button (external link)

**QR code entry point:** scanning an artist's QR code with the device's native camera opens their profile in the mobile browser. A soft nudge to download the app appears — the profile works fully without the app installed. No hard gate.

---

## 6. Discover

Three modes within one tab.

### Nearby Work
Location-based. Shows all location-pinned artwork within an adjustable radius — this includes collection pins from artist portfolios and festival archive pins, not just live festival murals.

Filter options:
- Radius adjustment
- Filter to a specific festival (e.g. show only CPF 2026 murals)
- Filter by medium

Tapping a piece opens the artist profile.

### Local Artists
Artists based in or regularly working in the user's area. Filterable by medium. Presented as a browsable list with profile photos and one-line bios. Tapping opens the artist profile.

### Random
Full-screen single image, randomly selected from all platform content. Genuinely random — no engagement algorithm, no weighting by popularity or saves.

- Swipe right to save the artist
- Swipe left to pass
- Tap the image to open the artist's full profile
- Saved artists appear in the user's Saves list

Saves record the artist, not the individual image. Saves are a personal collection only — they do not feed into recommendations or any algorithmic ranking. Artists can see how many times they have been saved as a metric in their analytics dashboard.

---

## 7. Community Tab

Contains the **editorial blog feed** only.

Weekly featured artist posts from the platform's editorial team. Each post features one artist — longform, image-led, editorially written. Being featured is an accolade, not a self-submission.

Tapping a post opens the full piece. Each post links through to the featured artist's profile.

Community boards (artist-to-artist discussion) are not part of the public app. They are accessible only through the browser platform and restricted to artists.

---

## Key Constraints

- No organiser or artist management features in the app at launch — ever, unless a future decision is made deliberately
- The Random mode must never be weighted by any engagement signal — it is random, full stop
- The Home feed is editorially curated by the team — no algorithmic ordering
- QR scanning uses the device's native camera — no in-app scanner
- Community tab shows editorial blog content only — community boards are not visible to the public
- Festival detection is a soft prompt — the app never hard-redirects without user confirmation
- Account creation is never required to use the app — it is always optional
- The "Support this artist" link opens externally — the platform takes no commission
