# Community Boards — Design Spec

**Date:** 2026-05-17
**Status:** Approved
**Scope:** Platform-wide discussion system for artists. Replaces the festival chat feature previously described in the organiser spec — private festival channels are a subset of community boards, not a separate system.

---

## Overview

Community boards are the social layer of the platform — a place for artists to talk practically, share work, celebrate each other, and stay connected between festivals. They are artist-only. The public cannot access them.

Built on embedded messaging infrastructure (Stream / Sendbird / Pusher — not built in-house). Accessible from both the browser platform and the mobile app, so artists can communicate on festival day from their phones.

---

## 1. Channel Structure

Two types of channel:

**Public channels** — platform-wide, visible and joinable by all artists. Structure is defined by the platform team, not freely created by artists. Initial set of channels to be decided by the team (e.g. Open Calls, Kit & Materials, Festival Talk, Show Your Work, Help & Questions).

A **Feature Request** section within the boards lets artists suggest new public channels. The platform team reviews and creates them.

**Private channels** — created by organisers for specific festivals. Only invited artists can see or join them. Private channels replace the dedicated festival chat feature — all festival-specific organiser-to-artist communication happens here.

---

## 2. Format

Forum-style within each channel: artists create posts, others reply underneath. Not a flat real-time chat feed.

Posts and replies support text. Image/media support to be confirmed at implementation.

Posts can be pinned within a channel by moderators.

---

## 3. Private Festival Channels

When an organiser wants to communicate with their accepted artists, they create a private channel for the festival:

- Organiser creates the channel and names it (e.g. "CPF 2027 — Artists")
- A GUI presents all accepted artists with an **Add All** option and individual toggles
- Organiser invites manually — nothing is automatic
- Accepted artists receive a notification and can join
- The organiser can post announcements, artists can ask questions visible to all members
- Organiser-to-artist direct messages (see §5) handle private conversations

This covers everything previously described as festival chat in the organiser spec.

---

## 4. Moderation

Platform team only at launch. Moderators can:
- Pin and unpin posts
- Remove posts and replies
- Warn or remove artists from channels
- Create and archive public channels

Trusted artist moderators can be granted channel-level moderation rights later — this is not a launch feature.

Artists can report any post or reply for review.

---

## 5. Direct Messages

Artists can DM each other directly. DMs are one-to-one and private. Organisers can also DM individual artists directly (as previously described).

---

## 6. Notifications

Artists are notified when:
- Someone replies to their post
- Someone mentions them
- They are added to a private channel
- A new post is made in a channel they follow

**In-app notifications:** always on.
**Email notifications:** opt-in. Artists control which events trigger an email in their notification settings.

---

## 7. Access

| User type | Access |
|-----------|--------|
| Artists (browser) | Full access — all public channels, private channels they're invited to, DMs |
| Artists (mobile app) | Full access — same as browser |
| Public app users | No access — community boards are not visible to the public |
| Organisers | Can create and post in private festival channels; access to public channels as artist-equivalent if they also hold an artist account |

The Community tab in the public app shows the editorial blog feed only. Community boards require an artist account and are never surfaced to the general public.

---

## Key Constraints

- Community boards are artist-only — no public access under any circumstances
- Public channel structure is defined by the platform team, not freely created by artists
- Private festival channels replace dedicated festival chat — there is no separate chat system
- Private channel invites are always manual — artists are never auto-added
- Built on embedded infrastructure — not built in-house
- Moderation is platform-team-only at launch
