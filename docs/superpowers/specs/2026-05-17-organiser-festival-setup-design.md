# Organiser Festival Setup — Design Spec

**Date:** 2026-05-17
**Status:** Approved
**Scope:** Full organiser journey from festival creation through post-festival archive. Browser platform only.

---

## Overview

Organisers set up and manage festivals entirely through the browser platform. The journey has eleven distinct phases. Two parallel tracks exist for getting artists: direct invitations (always available, can be used exclusively) and open applications (optional, organiser-controlled). Deciding which artist goes where on the map is always a manual decision by the organiser — never automatic.

---

## 1. Festival Creation

On payment of the setup fee, the organiser creates the festival:

- Name, dates (start/end), location, short description
- The festival immediately appears publicly as a **Coming Soon** listing (basic info, no map, no artist list)
- Links to this organiser's previous festivals appear automatically on the listing
- An **organiser-only preview link** is generated — a private URL that shows the full festival page as it will appear when live, for internal review before publishing. Not shared with artists.

---

## 2. Team Management

Multiple team members can be added to co-manage a festival. Two roles:

- **Admin** — full control: publish, delete, configure, invite, manage team
- **Manager** — can review applications, communicate with artists, update map assignments; cannot publish, delete, or change billing

---

## 3. Map Setup

Wall slots are plotted before any artists are assigned. This is a deliberate two-phase process: location first, artist assignment later.

**Each wall slot has:**
- Pin location (lat/lng on real map)
- Dimensions (W × H metres)
- Internal logistics notes — visible to organiser team only, never shown to artists (e.g. "needs cherry picker", "building permission pending", "rough brick surface")

**Dashboard view** shows total slots, filled vs unfilled at a glance.

**Artist assignment** is manual. The organiser drags or selects an accepted/invited artist and assigns them to a slot. Assignment can happen at any point after acceptance but earlier is strongly encouraged — artists need wall dimensions to plan their work.

**Reassignment flow:** if an accepted artist drops out, the organiser can unassign them from their slot and either leave the slot unfilled, assign someone from the waitlist, or re-open the slot for applications.

Once assigned, the artist sees their wall dimensions in their festival dashboard.

---

## 4. Application Form

The form builder lets organisers construct the application form artists will complete.

**Field types:** long text, short text, yes/no, multiple choice, file upload, URLs

**Per question:** the organiser sets the question text and an optional word/character limit.

**Additional controls:**
- Drag-to-reorder questions
- Mark questions as required or optional
- Maximum applications cap (optional hard limit)
- Applicant visibility setting: whether applicants can see total number of applications received
- **Clone from previous year** — carries forward all questions; organiser edits and saves as new version

**Application window:**
- Open date and close date (enforced automatically)
- Or: leave closed entirely and operate invite-only
- Organiser can reopen or extend the window at any time

**Auto-acknowledgment email:** when an artist submits an application, they receive an automatic confirmation email. The organiser can customise the message body. This is on by default.

---

## 5. Invitations

Organisers can invite specific artists directly at any time, regardless of whether the application process is open. The festival does not need to be publicly visible to send invitations.

**Two invite modes:**
- **Confirm only** — artist receives an invitation with festival info and a single accept/decline action. No form.
- **Confirm + questions** — artist receives an invitation and must answer a set of questions (a subset of the application form, or a custom set defined per-invite) before their place is confirmed.

**Gifting subscriptions:** at the point of invitation, the organiser can gift a platform subscription (free or pro tier) to the invited artist. Intended for headline artists being brought in as a pull.

**What the invited artist sees:** festival name, dates, location, description, the organiser's previous festivals, and their invitation. They do not see the open application form or any applicant count.

---

## 6. Application Review

The organiser's applicant dashboard shows all applications with the following tools:

**Status management:**
- Accept / Decline / Waitlist per applicant
- Automated notification sent to artist on any status change (accepted, declined, waitlisted)
- Waitlisted artists are told they are waitlisted, not left in ambiguity

**Internal tools (never visible to artists):**
- Internal notes per applicant — free text, supports multiple notes from different team members
- **Shortlist flag** — marks an applicant for closer consideration
- **Review flag** — marks an applicant for team discussion
- **Drag-to-rank** — within each status bucket (pending, shortlisted, accepted, waitlisted) applicants can be reordered by dragging. Rank order is organiser-internal only.

---

## 7. Artist Practical Info

Once artists are accepted or confirmed via invitation, they need logistics information before the event. This is separate from festival chat.

A dedicated **"Info for Accepted Artists"** section on the organiser dashboard lets the organiser write and publish a practical information block. Contents typically include:
- On-site contact name and number
- Access times and site entry details
- Paint supply situation (supplied or bring your own)
- Parking and transport
- Health and safety basics

This information is visible to accepted artists in their festival dashboard. It is not part of the public festival page.

---

## 8. Communications

Festival communication happens through **community boards** (see `2026-05-17-community-boards-design.md`) — there is no separate festival chat system.

The organiser creates a **private festival channel** within community boards and manually invites accepted artists via a GUI with an Add All option. All festival-specific communication — announcements, Q&A, logistics — happens in that channel. Organiser-to-individual-artist private conversations happen via direct messages.

**Announcement blast:** before go-live, the organiser posts in the private festival channel to notify accepted artists the festival is about to go live.

---

## 9. Go Live

The organiser uses the organiser-only preview link to review the full festival page. When satisfied:

- Organiser clicks **Publish**
- Festival page goes fully public (map, artist list, all content)
- Monthly subscription billing begins from this moment
- All accepted artists receive a notification that the festival is live

The organiser can unpublish the festival (e.g. for postponement) — billing pauses, page returns to Coming Soon state.

---

## 10. During Festival

- Map pins can be updated if an artist's location changes
- Mural status per pin can be marked: **Still being painted / Complete / Removed**
- Organiser can message all artists via festival chat at any time
- If an artist drops out during the festival, their pin can be removed or hidden

---

## 11. Post-Festival

Once the festival's end date passes:

- Subscription billing stops (or reduces to archive rate)
- Organiser marks each mural pin: **Still there / Removed / Unknown**
- Archive page remains permanently live and discoverable
- **Clone for next year:** creates a new festival draft carrying forward the wall slot positions, logistics notes, and application form. Organiser updates dates, reviews/edits everything, pays a new setup fee, and goes again.

---

## Key Constraints

- Wall-to-artist assignment is always manual — the platform never auto-assigns
- Logistics notes per wall slot are never surfaced to artists under any circumstances
- Internal applicant notes, rankings, and flags are never visible to artists
- The organiser preview link must not be indexable or guessable — should use a long random token, not a sequential ID
- Auto-acknowledgment emails are on by default; turning them off is an explicit organiser action
- Invited artists always see the organiser's festival history, even if the festival is not yet public

---

## Decided

- **Waitlist promotion:** when a dropout creates an open slot, the platform shows a nudge to the organiser ("Rosa Vane is next on your waitlist — assign her?") based on their drag-ranked waitlist order. The organiser still makes the assignment manually — nothing is automatic.
- **Team roles:** admin and manager are sufficient for launch. A read-only observer role (for funders, board members) can be added later.
- **Clone scope:** cloning for next year carries forward the main application form only — not custom per-invite question sets.
