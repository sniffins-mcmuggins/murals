# Artist Profile & Platform Experience — Design Spec

**Date:** 2026-05-17
**Status:** Approved
**Scope:** Full artist journey from sign-up through ongoing platform use. Browser platform only at launch.

---

## Overview

Artists are the foundation of the platform. The product is almost free for them by design — the platform charges £10/year minimum and takes no further cut of anything. Every feature decision on the artist side should be tested against: does this help an artist build a career?

Artists get a professional profile, a branded QR code, a location-pinned portfolio, festival application management, and analytics. Organisers browse artist profiles when reviewing applications — a well-built profile is a working tool, not just a portfolio site.

---

## 1. Onboarding & Sign-Up

Sign-up requires: email, name, and a basic bio stub. Payment comes immediately after — there is no free trial or unpaid state. The minimum tier is £10/year (or £2/month).

On payment confirmation, the artist's **QR code is generated immediately**. This is the first value moment — the artist has something real and usable before they've built the rest of their profile. They can continue building their profile at their own pace from there.

**Subscription tiers:**

| Tier | Price | Limits |
|------|-------|--------|
| Free | £10/yr or £2/mo | 1 collection, 10 images, basic analytics (3 months) |
| Pro | £35/yr or £4/mo | 5 collections, 10 images each, extended analytics (2 years), full festival history visible to organisers |
| Pro+ | £50/yr or £6/mo | Unlimited collections, unlimited images, full career map |

**Downgrade behaviour:** if an artist lapses or downgrades to a lower tier, any data exceeding the new limit (additional collections, images) is locked — not deleted. It is restored in full if they upgrade again. Artists never lose their work.

---

## 2. Profile

The public-facing profile is what organisers review and what the public lands on when they scan a QR code.

**Fields:**
- Profile photo / avatar
- Name
- Bio — first-person, conversational, generous character limit
- Location — city/region only, never a full address. Display is **opt-in**: the artist controls whether their location is shown publicly (privacy/safeguarding)
- Medium tags (painting, mural, illustration, sculpture, mixed media, etc.)
- Social links (Instagram, website, TikTok, and others)
- "Support this artist" button — the artist pastes in an external link (Buy Me a Coffee, PayPal, or any URL). The platform takes no commission on anything that comes through this link.

**What does not appear on the profile:**
- Blog posts — editorial content is curated and written by the platform's editorial team on a per-artist basis. Artists cannot self-publish to their profile.

---

## 3. QR Code

Generated immediately at sign-up. Encodes the artist's unique profile URL. If the profile URL changes, the QR auto-updates — no reprinting needed.

**Design:** Platform-branded — consistent shape, logo mark, and structure across all artists so the QR is recognisable as the platform at any festival. The artist can change the **colour** of the QR to suit their aesthetic.

**Download:** High-res PNG, print-ready. Suggested sizes: A5 card, wall label.

---

## 4. Portfolio Collections

Collections are named, curated groups of work. Examples: "Bristol 2024", "Cheltenham Festival", "Birds Series".

**Each collection has:**
- Name and short description
- Cover image
- Gallery of images (up to tier limit)
- Optional location pin per image (see below)
- Status: active / archived / ongoing

**Location pinning:** optional. When an artist does pin a piece, exact location is preferred. Input methods: What3Words, Google Maps pin, or Apple Maps pin — consistent with the platform's navigation approach elsewhere. Pinned pieces appear on the artist's profile work map.

**Tier limits:**
- Free: 1 collection, 10 images
- Pro: 5 collections, 10 images each
- Pro+: unlimited collections, unlimited images

Excess collections and images are locked (not deleted) on downgrade, restored on upgrade.

---

## 5. Work Map

The artist's profile includes a map aggregating all location-pinned work. Two sources feed it:

1. **Manual pins** — location pins the artist has added to individual pieces in their collections
2. **Festival pins** — automatically added when an organiser assigns the artist to a wall slot on a festival map. These appear as soon as the assignment is made, so visitors attending the festival can find the artist from day one. The artist does not need to pin their festival work manually.

Map pins are colour-coded by collection. Festival pins are visually distinct from collection pins.

---

## 6. Festival History

The festival history section on the artist's profile shows where they have exhibited.

**Automatic entries:** festivals the artist has participated in through the platform appear automatically — current, upcoming, and past.

**Manual entries:** artists can add festivals that predate the platform (name, year, location, brief description). If the festival they're adding **exists on the platform** (i.e. the organiser has created a retrospective page), the artist can link to it — but the organiser must approve the link to confirm the artist actually participated. Unlinked manual entries (for festivals not on the platform) require no approval.

**Visibility:**
- Free tier: current and upcoming festival appearances visible on profile
- Pro tier: full historical archive visible to organisers reviewing applications — this is meaningful signal for organisers assessing experience

---

## 7. Festival Applications

Artists browse open festival calls directly on the platform.

**Application flow:**
1. Artist views a festival listing (open applications, with deadline shown)
2. Opens the application form
3. Standard fields (name, bio, location, platform profile link) are **pre-filled** from their profile
4. Artist selects **which collection to highlight** in this application — they can choose the most relevant body of work for the specific festival rather than presenting everything
5. Artist answers the organiser's custom questions
6. Submits — receives an auto-acknowledgment email

**Notifications:** artists are notified automatically when their application status changes (accepted, declined, waitlisted). Waitlisted artists are told explicitly they are waitlisted.

---

## 8. Analytics

All analytics are aggregated only — no individual user identification. GDPR-clean.

**Free tier (3-month window):**
- Profile views
- QR code scans
- Social link clicks
- Application views (how many organisers have opened their application)

**Pro tier (2-year history):**
- All of the above
- Breakdown by festival — which festivals drove spikes in profile views and QR scans
- Historical trend view

---

## 9. Community Boards

Platform-wide discussion boards accessible to all artists via the browser platform. Separate from festival chat (which is festival-specific and organiser-initiated). Design detail deferred — covered in a separate spec.

---

## Key Constraints

- The platform takes no commission on donations, sales, or anything passed through the "Support this artist" link
- Location display is opt-in — the platform should never surface an artist's location without their explicit consent
- Blog posts are not self-published by artists under any circumstances — all editorial content is team-curated
- Artist data is never permanently deleted on downgrade — locked and restored
- Festival pins on the work map appear automatically and immediately on organiser assignment — the artist must not need to take any action for their location to be live at a festival
- Organiser approval is required before a manual festival history entry can link to a festival page on the platform
