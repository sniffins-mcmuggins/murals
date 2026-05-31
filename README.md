# Render — Project README
> Name: **Render** (used throughout the codebase; module path `sniffins-mcmuggins/render`) · Previously considered: Gesso  
> Status: In build · Concept locked · Branding in progress  
> Last updated: May 2026

---

## Table of Contents
1. [Mission & Ethos](#mission--ethos)
2. [What We're Building](#what-were-building)
3. [The Three Products](#the-three-products)
4. [User Types & Journeys](#user-types--journeys)
5. [Features by Product](#features-by-product)
6. [Organiser Review & Selection — Build Plan](#organiser-review--selection--build-plan)
7. [Revenue Model & Pricing](#revenue-model--pricing)
8. [Market Size & ARR Projections](#market-size--arr-projections)
9. [Tech Architecture Notes](#tech-architecture-notes)
10. [Team](#team)
11. [Launch Strategy](#launch-strategy)
12. [Pilot Festivals](#pilot-festivals)
13. [First Steps & Timeline](#first-steps--timeline)
14. [Key Decisions Log](#key-decisions-log)
15. [Outstanding Decisions](#outstanding-decisions)
16. [File Index](#file-index)

---

## Mission & Ethos

**Help artists get work. Drive the public's interest in art. Everything else follows.**

This platform exists specifically for the paint festival world — not as a generic events tool, not as a portfolio site. It is built around the reality of how festivals, public art, and working artists actually operate.

Every feature decision must be tested against the core mission: does this help an artist make a career, or does it help a member of the public discover and engage with art? If it doesn't serve one of those two goals, it doesn't belong in the product.

Artists are the foundation. The platform is almost free for them by design — not as a loss leader, but as a philosophical commitment. The revenue comes from organisers and the magazine. The artists get the platform.

---

## What We're Building

A home for paint festivals and the artists who make them, consisting of three interconnected products:

1. **A public-facing mobile app** — for visitors at festivals and the general public discovering art
2. **A browser-based platform** — for artists managing their presence and organisers running festivals
3. **A print and digital magazine** — editorial voice of the community, Year 1 goal

### The Flywheel
More artists → more attractive to organisers → more festivals → more QR codes on walls → more visitors → more visitors become artists and festival-goers → repeat.

The **branded QR code on every wall** at every festival is the acquisition engine. Every festival is a marketing event for the platform.

---

## The Three Products

### 1. The Public App (mobile)
The simplest of the three. One job: help someone at a festival, or interested in art, discover artists and find their way around.

**Key screens:**
- **Home / Explore** — live festivals nearby, coming soon listings, featured artist blog, recent artist profiles
- **Festival Map** — full-screen interactive map, artist pins, tap-to-navigate
- **Artist Profile** — bio, portfolio collections, festival history, social links
- **Discover** — three modes: Nearby Work (location-based), Local Artists, Random (Tinder-style swipe)
- **Community** — weekly curated blog feed, community boards

**Key interactions:**
- Tap a map pin → artist card popup → View Profile or Navigate
- Navigate fires out to Google Maps, Apple Maps, or What3Words (user preference remembered)
- QR code scan → lands directly on artist profile
- Swipe in Discover → save work, tap through to artist profile

**Important:** No organiser or artist management features in the app at launch. Artists and organisers use the browser platform. This keeps the app fast, focused, and simple.

### 2. The Browser Platform (artists & organisers)
All management tooling lives here. Mobile-responsive but browser-first.

**Artists get:**
- Profile page (bio, portfolio collections, social links, location)
- Branded QR code (generated instantly, downloadable, print-ready)
- Portfolio collections (organised by project/festival/city)
- Work map (location-pinned pieces, navigable by public)
- Festival applications
- Basic analytics
- Community board access

**Organisers get:**
- Festival creation and management
- Custom application form builder
- Applicant dashboard (review, accept, decline, waitlist)
- Interactive map builder (geographic or custom layout)
- Festival chat (group messaging to all accepted artists)
- Retrospective pages for previous years
- Post-festival archive management (mark murals still there / removed / unknown)

### 3. The Magazine (print & digital)
**Digital:** Weekly Substack. One featured artist per week, curated and approached by our editorial team. Not open submission — being featured is an accolade. Free tier + paid tier (~£6/month or £50/year).

**Print:** Annual edition. Large format, image-led, editorial quality. £18–22/copy. Sold at festivals, via platform website, independent art bookshops.

**Content:**
- Featured artist longform (expanded from weekly blog)
- Festival guides and previews
- City art trail guides (using archive map data)
- Process and technique editorial
- Festival news and open calls
- Collector content (prints, originals, commissions)

**Key rule:** One artist per week, approached by our team. The exclusivity and curation is the value. This is not a content feed — it is editorial.

The magazine launches digitally at the same time as the platform. Print edition at the 12-month mark.

---

## User Types & Journeys

### Artists
**Acquisition:** Via festival organisers (vouchers), Hannah's interviews, word of mouth, app discovery.

**Journey:**
1. Sign up (email, basic bio) → immediate value: QR code generated
2. Build profile (bio, portfolio, social links, location)
3. Browse open festival calls on platform
4. Apply to festival — profile pre-fills the form
5. Accepted → notified, pinned on festival map
6. QR code on wall at festival → visitors scan → profile views spike
7. Analytics show traffic → motivates keeping profile current
8. Renews membership annually

**Free tier:** 1 collection, 6→10 images, basic analytics, QR code, applications
**Pro (£35/yr):** 5 collections, 10 images each, extended analytics, full festival history
**Pro + Collections add-on (£50/yr):** Unlimited collections, unlimited images, full career map

### Organisers
**Acquisition:** Email outreach, social media, word of mouth from artists, direct relationships (CPF).

**Journey:**
1. Sign up → browse platform to see existing artist profiles
2. Pay setup fee (~£35) → unlocks festival creation tools
3. Festival listed publicly as "Coming Soon" immediately (basic info, dates, location)
4. Build application form, configure map, set open/close dates
5. Applications come in through platform
6. Review applications → accept/decline/waitlist (automated notifications to artists)
7. Assign accepted artists to map pins
8. Hit go live → monthly subscription begins, full festival page public
9. During festival → update map if things change, message all artists via chat
10. Post-festival → archive page stays live, mark mural statuses
11. Next year → clone festival, update dates, pay setup fee again

**Pricing:**
- Setup fee: ~£35 one-off per festival
- Live subscription: £19/mo (small, ≤20 artists) / £49/mo (medium, 20–75) / £99/mo (large, 75+)
- Subscription runs while festival page is active (typically ~3 months/year)
- Archive is free/reduced once festival ends

### Public / Visitors
No account required. Zero friction. They open the app, find the festival, navigate to artists, scan QR codes. That's it.

The Discover feature gives them a reason to open the app between festivals — nearby art, local artists, random swipe discovery.

---

## Features by Product

### Artist Profile
- Bio (first-person, conversational, generous character limit)
- Profile photo / avatar
- Location (city/region only — never address)
- Medium tags (painting, mural, illustration, sculpture, mixed media, etc.)
- Portfolio collections (see Collections system below)
- Work map (location-pinned pieces from all collections)
- Festival history (current, upcoming, past — pro feature for archive)
- Social links (Instagram, website, TikTok, etc.)
- Branded QR code (downloadable, printable — A5 card, wall label sizes)
- Analytics (profile views, QR scans, link clicks, application views)
- "Support this artist" donation link (Buy Me a Coffee or similar)
- Festival appearance badge (links to festival map, pre-pinned to their location)

### Collections System (Portfolio)
Collections are named, curated groups of work (e.g. "Bristol 2024", "Cheltenham Festival", "Birds Series").

Each collection has:
- Name + short description
- Cover image
- Gallery of images (10 per collection)
- Optional location pins per image
- Status: active / archived / ongoing
- Collection map (shows all pinned work on a small embedded map)

**Tiers:**
- Free: 1 collection, 10 images
- Pro: 5 collections, 10 images each
- Pro + Add-on: Unlimited collections, unlimited images

The artist's main profile map aggregates all collection pins, colour-coded by collection.

### Festival Map
Two modes:
1. **Geographic** — real map (Leaflet + OpenStreetMap), artist pins on actual streets. Fires out to Google Maps / Apple Maps / What3Words for navigation.
2. **Custom layout** — organiser uploads venue floor plan, places pins on top. Navigate fires to venue entrance coordinates.

What3Words coordinates generated automatically for each pin.

Pins show: artist photo, name, one-line bio. Tap → full artist card. Navigate or View Profile.

Filter by medium. List view toggle.

### Coming Soon Listings
When an organiser pays the setup fee, the festival gets an immediate public listing:
- Name, dates, location, short description
- "Notify me" / follow button
- Link to previous year's festival (if exists on platform)
- No map, no artist list until go-live

### Retrospective Pages
New organisers can create archive pages for festivals that predate the platform. Lightweight — name, dates, location, description, photos, artist list. Map is supported (some murals still exist).

Enables immediate credibility for new joiners. Visiting the platform and seeing a seven-year history matters to artists reviewing a festival.

### Organiser Application Form Builder
- Standard pre-built fields (name, contact, platform profile link, portfolio)
- Custom questions: free text, multiple choice, file upload, yes/no, URLs
- Library of suggested questions
- Open/close dates (auto-enforces)
- Optional max applications cap
- Applicant visibility setting

### Festival Chat
- **Festival channel** — created automatically when festival goes live. Organiser messages all accepted artists. Artists can ask questions visible to all.
- **Direct messages** — organiser to individual artist for private conversations
- **Community boards** — platform-wide discussion for all artists. Lives in the app. Separate from festival chat.
- Built on embedded messaging infrastructure (Stream / Sendbird / Pusher) — not Discord, not built in-house at this stage.

### Analytics (Artist)
**Free:** Profile views (3 months), QR scans (3 months), link clicks (3 months)
**Pro:** All of the above, 2-year history, breakdown by festival

**What we track:** Aggregated only. No individual user identification. GDPR-clean.

### Discover (Public App)
Three modes in one tab:
1. **Nearby Work** — location-based, shows pinned art within adjustable radius. Uses collection location pins + festival archive pins.
2. **Local Artists** — artists based in or regularly working in user's area. Filterable by medium.
3. **Random** — full-screen image swipe. Genuinely random across all platform content (no engagement algorithm). Swipe left to pass, right to save. Tap to go to artist profile. Saved images stored in user profile tab.

### Magazine (Editorial Tool)
Internal tool for the editorial team to write, schedule, and publish weekly features. Rich text editor, cover image upload, publish scheduling. Not a self-publish interface for artists — all content is commissioned and edited.

---

## Organiser Review & Selection — Build Plan

This is the platform's competitive front line. [Zealous](https://zealous.co) is the incumbent for creative submissions and judging (clients: The Design Museum, Shakespeare's Globe, Island Records) — but it **cedes public discovery and live-festival navigation entirely.** There is no map, no "explore live festivals," no on-the-ground wayfinding. That uncontested space — our public app, festival maps, and the branded QR on every wall — is our moat.

The trap is that an organiser still *compares us to Zealous on the selection tooling*, and that is where they are strong. So our org-facing pitch must lead with **"selection tooling *and* a living public map your visitors actually use on the day"** — and we have to be credible on the selection half. This section maps each Zealous selection capability to what the API already does and what is left to build. It is the primary roadmap for the organiser product.

### Foundational gap: there is no panellist model

Every review handler in `api/internal/festival/` gates on `fest.OrganiserID == principal.UserID` — **only the festival owner can review applications.** Anonymous review, multi-round selection with different panels, and rubric scoring all assume *multiple reviewers per festival*. The prerequisite for three of the four headline features below is therefore a **festival reviewer / panellist role**: an invited user who can score but not edit the festival. Build this first; everything else layers on it.

**What the API already supports (current state):**

| Capability | Where |
|---|---|
| Submitted → accepted / declined / waitlisted | `review.go`, `waitlist.go`; `applications.status` enum |
| Manual drag-rank within a status bucket | `patch.go` `ReorderApplicationsHandler`; `applications.rank` |
| Shortlist flag + review flag (binary) | `patch.go` `PatchApplicationHandler`; `applications.shortlisted` / `review_flag` |
| Free-text notes per application | `notes.go`; `application_notes` table |
| Custom form fields, open/close dates, max cap | `form.go`; `application_forms` (`fields` jsonb, `open_at`, `close_at`, `max_applications`) |
| Answers keyed by field id | `applications.answers` jsonb |
| Auto-notify artist on accept/decline | `sendApplicationNotification` |

### Gap map (priority order)

**1. Panellist / reviewer accounts** — *prerequisite, build first* · spec: `docs/superpowers/specs/2026-05-29-panellist-accounts-design.md` · issue [#156](https://github.com/sniffins-mcmuggins/murals/issues/156)
- **Zealous:** panels of judges, skip conflict-of-interest entries, "pick up where you left off on any device."
- **Now:** single owner-reviewer only.
- **Build:** `festival_reviewers` table; email-invite flow (reuses the password-reset token machinery); a `resolveFestivalAccess` helper so review handlers allow "owner OR invited reviewer"; advisory reviewers (score + comment, owner decides); auto-hide a reviewer's own application (COI); per-reviewer 1–5 score surfaced as an avg badge on the board.

**2. Criteria-based scoring rubric** · issue [#157](https://github.com/sniffins-mcmuggins/murals/issues/157) (blocked on #156)
- **Zealous:** configurable rubric with per-criterion score ranges (they use 1–7); score distributions shown on the dashboard in real time.
- **Now:** only a binary `review_flag` and manual `rank`. No scores.
- **Build:** `review_criteria` config on `application_forms` (`[{label, min, max}]`); `application_scores` table (`application_id`, `reviewer_id`, `criterion`, `score`); aggregate to a mean to drive ranking. Per [`sqlc-and-schema.md`](.claude/rules/sqlc-and-schema.md) this is new tables + queries + an e2e canary that scores an application and reads the aggregate back (a unit test asserting zero-is-zero will not catch a missing Scan).

**3. Anonymous review toggle** · issue [#158](https://github.com/sniffins-mcmuggins/murals/issues/158) (blocked on #156)
- **Zealous:** auto-hides artist name and personal details; identities revealed only after scores are locked. No manual redaction.
- **Now:** `ListApplicationsByFormWithArtist` always joins and returns the full artist profile.
- **Build:** `anonymous_review bool` on `application_forms`; when true, `toEnrichedResponse` strips name / avatar / social / profile link and returns only answers + work images; reveal once the reviewer has scored (or on explicit organiser override). Low effort, high-credibility selling point — equitable selection with zero admin.

**4. Multi-round selection** · issue [#159](https://github.com/sniffins-mcmuggins/murals/issues/159) (blocked on #156)
- **Zealous:** screening → shortlist → final, with different panellists *and* criteria per round.
- **Now:** the single `shortlisted` bool is a poor-man's two-stage.
- **Build:** formalise rounds — a `round` concept owning its own criteria set and reviewer set, with applications advancing round-by-round. Largest lift; needed for Upfest-scale volume (250+ artists). Ships after the CPF pilot.

**5. Quick-selection mode** — *mostly already possible*
- **Zealous:** fast yes/no screening pass before detailed review.
- **Now:** the shortlist toggle + drag-rank already deliver this; it is a UI affordance, not new API.
- **Build:** a keyboard-driven "triage" view in the web platform over the existing `PatchApplicationHandler`. Web-only, no schema change.

**6. Trackable submission links**
- **Zealous:** per-channel links measuring which marketing drove submissions.
- **Now:** none.
- **Build:** capture a `source` string on `applications` at submit time; aggregate per festival. Fits the GDPR-aggregate-only analytics stance (no individual tracking).

### Submission richness (artist side — supporting)

- **Media embeds** — Vimeo / YouTube / SoundCloud / **Sketchfab (3D)**. Add an `embed` form-field type in `web/src/components/DynamicForm.tsx`; validates and stores a provider URL in `answers`. Sidesteps image-storage cost and is high-value for mural artists (video walkthroughs, 3D mockups, site plans).
- **Portfolio reuse** — `SubmitApplicationHandler` already loads the artist profile; extend it to pre-fill answers from existing collections so applying is near one-click. Directly serves "help an artist make a career."
- **Portfolio-based opportunity matching** — Zealous recommends open calls matching a portfolio. We can do this *better* with festival geography ("open calls near you / in cities you've painted"). Year 2.

### Sequencing

1. **Panellist accounts** — unblocks 2–4.
2. **Rubric scoring + anonymous toggle** — the two features organisers compare directly against Zealous.
3. **Quick-select triage UI + trackable links** — cheap wins, no/low schema change.
4. **Multi-round + opportunity matching** — post-CPF, sized for Upfest scale.

### Pricing tension to resolve

Zealous runs **no setup fee + first 20 submissions free + ~2-minute no-card signup**, billed on submission volume with no annual lock-in (33% off annual from Apr 2026), and paid calls at 2.2% + 20p capped £2. Our model is a **£35 setup fee + monthly subscription from go-live**. Their land-grab is optimised for exactly the "just try it" adoption our setup fee blocks. Not a decision to change pricing — a flag to weigh: the setup fee is friction at precisely the moment an organiser is comparing us to a free trial. See [Outstanding Decisions](#outstanding-decisions).

---

## Revenue Model & Pricing

### Artist Tiers
| Tier | Price | What's included |
|------|-------|-----------------|
| Free membership | £10/year or £2/month | Profile, QR code, 1 collection (10 images), basic analytics, applications |
| Pro | £35/year or £4/month | 5 collections, extended analytics (2yr), full festival history visible to organisers |
| Pro + Collections | £50/year or £6/month | Unlimited collections, unlimited images, full career map |

### Organiser
| Item | Price | Notes |
|------|-------|-------|
| Setup fee | ~£35 one-off | Per festival. Unlocks form builder, map, application management. Festival listed as Coming Soon. |
| Small (≤20 artists) | £19/month | Active while festival page is live |
| Medium (20–75 artists) | £49/month | Active while festival page is live |
| Large (75+ artists) | £99/month | Active while festival page is live |

Pricing is **flat** — no increases for returning organisers. Existing customers are grandfathered at their original rate permanently.

Archive pages: free/reduced once festival passes end date.

### Enterprise (Three Tiers)
Large organisations running multiple festivals.

| Tier | Price | For | Key extras |
|------|-------|-----|------------|
| Organisation | £5,400/year (£450/mo) | Arts bodies, city councils, 5–20 festivals/year | Unified dashboard, staff accounts, funder reporting |
| Foundation | £15,000/year | National/international foundations, 20–50+ festivals | Custom branding, role-based permissions, dedicated account manager, quarterly data reports |
| Global | £40,000/year (negotiated) | International arts agencies, commercial festival companies | White-label platform, API access, SLAs, bespoke integrations |

First Global client should be acquired at discount/free for reference credibility.

### Magazine
| Stream | Price | Notes |
|--------|-------|-------|
| Digital (Substack free) | £0 | Selected articles: festival news, open calls |
| Digital (Substack paid) | £50/year or £5/month | Full features, full archive |
| Print (annual) | £18–22/copy | ~55% margin after print costs |
| Print advertising | £400–800/page | Festival and brand partners |
| Brand partnerships | £2,000–2,500/partner | Paint brands (Posca, Montana, Liquitex, etc.) |

### Artist Print Commissions
12% commission on print/original sales through artist profiles. Year 2 feature.

---

## Market Size & ARR Projections

### European Paint Festival Market (Est.)
| Country | Est. Total Festivals |
|---------|---------------------|
| UK | ~80 |
| Spain | ~60 |
| Germany | ~50 |
| Italy | ~40 |
| France | ~35 |
| Portugal | ~25 |
| Netherlands | ~20 |
| Poland | ~20 |
| Scandinavia | ~25 |
| Other | ~75 |
| **Total** | **~430** |

### ARR Projections (50% European penetration)
| Year | Festivals | Artists | Total Revenue | True ARR |
|------|-----------|---------|---------------|----------|
| Year 1 (UK pilot) | 40 | 2,000 | £71,480 | £57,080 |
| Year 2 (EU expansion) | 120 | 6,000 | £228,140 | £200,440 |
| Year 3 (50% EU) | 218 | 12,000 | £613,970 | £578,000 |

### Year 3 Breakdown by Stream
| Stream | Year 1 | Year 2 | Year 3 |
|--------|--------|--------|--------|
| Artist memberships | £36,500 | £118,800 | £258,000 |
| Festival setup fees | £1,400 | £4,200 | £7,630 |
| Festival subscriptions | £5,880 | £19,800 | £39,240 |
| Digital magazine | £12,500 | £40,000 | £90,000 |
| Print magazine | £13,200 | £27,500 | £55,000 |
| Magazine ad sales | £2,000 | £6,000 | £11,200 |
| Brand partnerships | — | £4,000 | £7,500 |
| Enterprise | — | £4,000 | £128,200 |
| Print commissions (12%) | — | £3,840 | £16,200 |
| **Total** | **£71,480** | **£228,140** | **£613,970** |

**Note:** Enterprise is the most underutilised revenue line. The three-tier model (Organisation / Foundation / Global) targets organisations with real budgets who were previously underpriced at £2,000–3,000/year.

---

## Tech Architecture Notes

### Platform Split
- **Browser-based:** Artist management, organiser management, editorial tools
- **Mobile app:** Public-facing only at launch. Artist/organiser features added to app later only if warranted.
- Rationale: Keeps the app simple, focused, and maintainable. Reduces scope at launch significantly.

### Map
- **Library:** Leaflet.js + OpenStreetMap tiles (free, reliable, no API key required for basic use)
- **Navigation out:** Google Maps (`https://www.google.com/maps/dir/?api=1&destination=LAT,LNG`), Apple Maps (`https://maps.apple.com/?daddr=LAT,LNG`), What3Words (`https://what3words.com/word1.word2.word3`)
- **User preference** for navigation app remembered after first use
- **Two map modes:** Geographic (real map) and Custom Layout (uploaded venue plan with pins overlaid)
- **What3Words:** Coordinates auto-generated per pin — no W3W API needed for display, W3W URL used for navigation

### QR Codes
- Branded — platform visual identity incorporated into QR design (logo/mark at centre, brand colours)
- Consistent style across all artists — recognisable as the platform at a festival
- Each QR encodes the artist's unique profile URL
- If profile URL changes, QR auto-updates (no reprint needed)
- Generated server-side, downloadable as high-res PNG, print guide included
- Suggested sizes: A5 card, wall label

### Chat / Messaging
- **Do not build from scratch**
- Use embedded infrastructure: Stream Chat, Sendbird, or Pusher Channels
- Feels like our product to end users, handled by experts underneath
- Festival chat (private per-festival channels) + Community boards (open platform-wide)
- Not Discord — breaks the experience, wrong aesthetic, requires separate account

### Magazine
- **Digital:** Substack (handles subscriptions, payments, distribution, archive)
- Platform website embeds/links to Substack
- **Print:** Designed externally (freelance print designer), produced annually
- No custom magazine CMS needed — Substack for digital, InDesign for print

### Analytics
- Basic aggregated analytics only at launch
- No individual user tracking — GDPR-clean
- Artist sees: profile views, QR scans, link clicks, application views
- Pro artists see: 2-year history, breakdown by festival
- No selling data, no advertising in the platform products

### Database Considerations
- Artist profiles, portfolio images, collection data
- Festival data, maps, application forms and responses
- User accounts (artists, organisers, public optional)
- Analytics events (anonymised)
- Magazine content (or handled by Substack)

### Image Storage (decided)
- **Local/CI:** MinIO (S3-compatible), see `infra/docker-compose.yml`
- **Prod:** S3 + CDN, served via `CDNBaseURL`. Browser uploads use presigned PUT URLs (`/images/presign` → PUT → `/images/confirm`)
- Images are central to the product — performance matters

---

## Team

| Role | Person | Responsibility |
|------|--------|----------------|
| CTO & Co-founder | — | Full platform build (browser + app), tech decisions, infrastructure |
| Developer | — | Second developer — build split TBD |
| Brand Lead & Co-founder | — | Visual identity, QR code design, marketing, organiser acquisition |
| Editorial Lead & Co-founder | Hannah | Artist interviews, weekly blog curation, magazine editorial voice |

### Planned Hires
| Role | Timing | Notes |
|------|--------|-------|
| Part-time community manager | Month 6+ | Social media, artist engagement, organic growth. £500–800/mo freelance. |
| Mobile developer | Month 9+ | If CTO and Dev 2 need dedicated mobile support |
| Festival & partnerships lead | Month 12+ | Someone embedded in the festival circuit. Not a salesperson — a community person who closes deals. Ideally an artist who believes in the platform. |
| Freelance print designer | Year 1 end | Annual magazine layout. InDesign. Project-based. |
| Account manager | Year 2 | For enterprise clients. Full hire. |

---

## Launch Strategy

### Founding Members
- First **100 artists** join free (founding member status, price locked)
- First **10 festivals** get free setup fee + free live period
- Each launch organiser receives **20 artist vouchers** to distribute to their community
  - Vouchers = free one-month artist membership
  - Warm introductions via organisers rather than cold sign-ups
  - Organiser has skin in the game — actively recruits their artist community
- Email capture live from day one (even before platform build)

### Organiser Referral Incentive
- Each organiser gets a unique referral link/code
- Artist signs up via their link → attributed to that organiser
- After 5 artist referrals → organiser earns one month's subscription credit or reduction on next setup fee
- Framing: community support, not formal affiliate scheme

### Geographic Strategy
- **Year 1:** UK only. Prove the model.
- **Year 2:** European expansion begins. Spain, France, Germany primary targets.
- **Year 3:** 50% European penetration. Global starts.
- **Enterprise:** Target international organisations from Year 2 for reference credibility.

---

## Pilot Festivals

### Cheltenham Paint Festival 2027 (Primary Pilot)
- **Why:** CTO has direct personal relationship with CPF organiser
- **When:** October 2027 (CPF runs annually in October, est. 2017)
- **First meeting:** A few weeks from now
- **Demo:** Static HTML demo (`cpf_demo.html`) built with real Cheltenham coordinates — Brewery Quarter, High Street, Winchcombe Street, Regent Arcade, Montpellier Walk, Bath Road
- **Pre-meeting prep:**
  - Obtain previous years' application questions (CPF organiser or public sources)
  - Take photos of existing murals around Cheltenham (we live there)
  - Load real murals as retrospective pins in demo
  - Update demo with actual CPF branding/photos before meeting
- **Ask from CPF organiser:** Informal commitment to use platform for 2027 applications. Input on organiser tools during build. Access to previous application questions.
- **Deliverable:** Working platform with CPF 2027 live by August/September 2027

### Upfest 2027 (Secondary Pilot)
- **Why:** Europe's largest street art festival (~250 artists, Bristol). Major credibility.
- **When:** May/June 2027 (Upfest runs annually May/June in Bedminster, Bristol)
- **Approach:** After CPF commitment secured. Lead with "Cheltenham Paint Festival are already on board." CPF organiser endorsement as door-opener. Artist network (Hannah's interviews) as secondary route in.
- **Scale difference:** Upfest has 250+ artists vs CPF's smaller footprint. Different demo focus — emphasise scale, application volume management, large map.

### Demo Strategy for Both
- **Two demos, subtly different** — CPF reflects their curated town-centre feel, Upfest reflects their sprawling multi-street scale
- **Leave something incomplete on purpose** — lets organiser feel like they've shaped the product
- **Previous year's festivals pre-loaded as retrospectives** — immediate credibility

---

## First Steps & Timeline

### Phase 1: Foundation (Now → Month 6)
- [ ] Secure domain (renderltd.com confirmed available, or TBD name)
- [ ] Brand identity work begins with brand lead — name, visual language, QR code design
- [ ] Hannah begins approaching artists for first Substack interviews (before platform exists)
- [ ] Email capture page live (simple, branded, founding member sign-up)
- [ ] Tech stack decisions locked
- [ ] CPF organiser conversation (within weeks)
- [ ] Obtain CPF previous application questions
- [ ] Take photos of existing Cheltenham murals for demo
- [ ] Update CPF demo with real photos and questions

### Phase 2: Build (Month 3 → Month 12)
- [ ] Core platform: artist profiles, QR code generation, portfolio collections
- [ ] Analytics (basic)
- [ ] Organiser tools: application form builder, applicant dashboard
- [ ] Festival map (geographic mode first)
- [ ] 20–30 artist profiles live before public launch (Hannah's network)
- [ ] Substack digital magazine launches (whenever brand is locked)
- [ ] CPF and Upfest conversations convert to commitments

### Phase 3: Soft Launch (Month 12)
- [ ] Founding member campaign opens (100 artists, 10 festivals)
- [ ] Platform publicly accessible
- [ ] First organiser setup fees taken
- [ ] Upfest conversations solidified

### Phase 4: Pilot (Month 15–18)
- [ ] CPF 2027 applications open through platform
- [ ] Upfest 2027 applications open through platform
- [ ] QR codes printed and on real walls
- [ ] Festival maps live and navigable

### Phase 5: Post-Pilot (Month 18+)
- [ ] Print magazine issue one (timed with a festival if possible)
- [ ] European expansion outreach begins
- [ ] First enterprise conversations
- [ ] Artist commissions feature (12% commission on print sales)

---

## Key Decisions Log

| Decision | Choice Made | Rationale |
|----------|-------------|-----------|
| Platform split | Browser for artists/organisers, app for public | Keeps app simple, reduces launch scope |
| Map library | Leaflet + OpenStreetMap | Free, no API key, reliable, works offline with cached tiles |
| Chat infrastructure | Embedded (Stream/Sendbird/Pusher) | Don't build from scratch, don't use Discord |
| Magazine distribution | Substack (digital), external designer (print) | No custom CMS needed |
| Artist pricing | £10/yr free, £35/yr pro, £50/yr pro+ | Low enough to filter bots, high enough to matter |
| Organiser pricing | Setup fee + monthly from go-live | Organiser pays for value from the moment it exists |
| Enterprise | Three tiers (£5.4k / £15k / £40k) | Previous £2-3k massively undervalued these customers |
| Artist blog | Curated weekly, one artist, approached by team | Exclusivity creates aspiration and quality |
| QR code | Branded platform design, not generic | Platform recognition at every festival wall |
| Collections | Named groups of work, 10 images each, tiered | More natural than hard image limits |
| Navigation | Google Maps + Apple Maps + What3Words | Three options, preference remembered |
| Chat | Festival channels + community boards | Two separate spaces, different purposes |
| Discover | Three modes: Nearby, Local Artists, Random swipe | Gives public reason to open app between festivals |
| Retrospective pages | Supported with maps | Previous murals still navigable and discoverable |
| Founding members | 100 artists free + 10 festivals free + 20 vouchers each | Warm acquisition via organiser networks |
| Pricing escalation | None for existing customers | Loyalty and trust over short-term revenue |
| Magazine advertising | In print only, not in app/platform | App and platform products are ad-free |

---

## Outstanding Decisions

| Decision | Status | Notes |
|----------|--------|-------|
| **Platform name** | Decided | **Render** — used throughout the codebase (module `sniffins-mcmuggins/render`). Final branding/logo still in progress. |
| **Tech stack** | Decided | Go + chi + pgx + sqlc (API), Next.js App Router (web). See [Tech Architecture Notes](#tech-architecture-notes). |
| **App platform** | Decided | React Native (no Expo) — `mobile/`. |
| **Payment processor** | Decided | Stripe — wired end-to-end (`api/internal/billing`). |
| **Image CDN** | Decided | MinIO locally, S3 + CDN (`CDNBaseURL`) in prod. |
| **Hosting** | TBD | AWS / GCP / Vercel / Railway. Local + CI run on Docker Compose (`infra/`). |
| **Chat provider** | TBD | Stream vs Sendbird vs Pusher — evaluate pricing and features. Not yet implemented. |
| **Artist commission marketplace** | Year 2 | Not Year 1. Feature design needed. |
| **Custom map layouts** | Year 1 or 2? | Geographic map for pilot. Custom layout (indoor/venue) to follow. |
| **Offline map support** | TBD | Would improve festival day experience significantly. |
| **Enterprise onboarding** | Year 2 | Process design needed when first client approaches. |
| **API for arts councils** | Year 2+ | Anonymous data for funder reporting. Design TBD. |
| **Organiser setup fee vs free trial** | Open | Zealous offers no setup fee + first 20 submissions free. Our £35 setup fee is friction at the comparison moment. Consider a free-trial tier (e.g. first festival or first N applications free) without abandoning the fee. See [Organiser Review & Selection — Build Plan](#organiser-review--selection--build-plan). |
| **Panellist / reviewer accounts** | Specced — issue [#156](https://github.com/sniffins-mcmuggins/murals/issues/156) | Prerequisite for rubric scoring (#157), anonymous review (#158), and multi-round (#159). Currently review is single-owner only. |

---

## Local Development

### Prerequisites

- Go ≥ 1.22
- Node ≥ 20
- Docker (with Compose plugin)
- [Task](https://taskfile.dev/installation/) (`brew install go-task` on macOS)

### Quickstart

```bash
task up        # Start the full local stack (api, web, db, minio, prometheus)
task e2e       # Run end-to-end tests against the running stack
task down      # Stop the stack
```

### All available commands

```
task --list
```

| Command | What it does |
|---------|-------------|
| `task up` | Start docker-compose stack (detached) |
| `task down` | Stop docker-compose stack |
| `task test` | Run all tests (api + web + mobile in parallel) |
| `task lint` | Run all linters |
| `task generate` | Regenerate OpenAPI types + sqlc queries |
| `task db:migrate` | Apply pending migrations |
| `task db:migrate:down` | Roll back last migration |
| `task db:new -- <name>` | Scaffold a new migration file pair |
| `task db:seed` | Load seed data |
| `task db:generate` | Generate sqlc Go types from SQL queries |
| `task openapi:gen` | Generate Go server interfaces + TS client |
| `task e2e` | Run Playwright end-to-end tests |
| `task api:dev` | Start Go API with hot reload (air) |
| `task web:dev` | Start Next.js dev server |
| `task mobile:ios` | Run RN app on iOS simulator |
| `task mobile:android` | Run RN app on Android emulator |

Per-app Taskfiles (`api/`, `web/`, `mobile/`) expose the same targets via `task -d <dir> <target>` or through the root includes (`task api:test`, `task web:lint`, etc.).

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full development workflow.

---

## File Index

```
/
├── README.md                     ← This file. Full project context.
├── Taskfile.yml                  ← Root task runner (delegates to per-app Taskfiles)
├── api/                          ← Go REST API (cmd/api, internal/*)
├── web/                          ← Next.js browser platform
├── mobile/                       ← React Native public app (no Expo)
├── db/                           ← Migrations, seed data, sqlc config
├── openapi/                      ← OpenAPI spec + generated TS client
├── infra/                        ← docker-compose, prometheus config
├── docs/superpowers/specs/       ← Design specs and build plans
├── cpf_demo.html                 ← Static demo for CPF organiser meeting
└── .github/workflows/            ← CI (added in E1.3)
```

### Demo Notes (`cpf_demo.html`)
- Self-contained single HTML file
- No backend, no database — all static and JS
- Uses Leaflet.js (loaded from CDN — requires internet connection)
- Real Cheltenham coordinates for artist pins:
  - Rosa Vane — The Brewery Quarter: `51.8994, -2.0755`
  - Joel Marsh — Winchcombe Street: `51.9021, -2.0758`
  - Amara Diallo — High Street: `51.9009, -2.0783`
  - Kit Harrow — Regent Arcade: `51.9013, -2.0795`
  - Suki Endo — Montpellier Walk: `51.8971, -2.0835`
  - Tomás Cruz — Bath Road: `51.8978, -2.0811`
- Navigation buttons use real URLs (Google Maps, What3Words)
- Accept/Decline interactions update UI state in JS only
- **Before CPF meeting:** Replace placeholder images with real Cheltenham mural photos, update application questions with real CPF questions

---

## Issue & Board Conventions

**Board:** https://github.com/users/sniffins-mcmuggins/projects/1

### Issue naming

All issues use `[EX]` (epic) or `[EX.Y]` (task) prefixes. No `feat:`, `Epic:`, or `Design:` prefixes.

| Epic range | Coverage |
|---|---|
| E1–E10 | Phase 1 foundations (done) |
| E11 | Production infrastructure |
| E12–E14 | Auth, Stripe, E2E (done) |
| E15 | Profile visibility & publish flow |
| E16 | Private beta portal |
| E17 | Content moderation |
| E18 | Endorsements |
| E19 | AI onboarding (icebox) |
| E20 | Refer-an-artist |
| E21 | Public mobile: GPS audio, festival trail, save/seen-it |
| E22 | Organiser review & selection (panellist, rubric, anon, multi-round) |

**Next epic: E23.** See `.claude/rules/issue-labels.md` for the full label set and hygiene rules.

### Labels

Three categories — always apply at least one from each:

- **Type:** `type:epic` · `type:task` · `type:planning`
- **Area:** `area:api` · `area:web` · `area:mobile` · `area:db` · `area:infra` · `area:ci` · `area:openapi` · `area:e2e`
- **Priority:** `priority:p0` (CPF must-have) · `priority:p1` (launch nice-to-have) · `priority:p2` (post-pilot)
- **State:** `blocked` · `security` · `good-first-subagent`

### Milestones

| Milestone | Due | For |
|---|---|---|
| Beta Launch | Aug 2027 | Working platform live for founding members |
| CPF 2027 Pilot | Oct 2027 | CPF applications open through the platform |

All P0 issues should be assigned to one of these milestones.

### Board columns

`Icebox` → `Backlog` → `Ready` → `In progress` → `In review` → `Done`

- **Ready**: max 6 items — genuinely startable in the next sprint.
- **In progress**: max 2–3 items at once.
- Scripts: `uv run scripts/sync-done-to-board.py --apply` (mark closed items Done).

---

*This README is the canonical reference for the project. Update it as decisions are made. When using Claude Code, share this file as context at the start of every session.*
