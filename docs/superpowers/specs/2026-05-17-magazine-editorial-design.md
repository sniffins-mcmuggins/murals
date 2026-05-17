# Magazine & Editorial — Design Spec

**Date:** 2026-05-17
**Status:** Approved
**Scope:** How the platform surfaces and manages editorial content. Content creation itself is entirely external — this spec covers only what the platform needs to do.

---

## Overview

The magazine has two streams: digital (weekly featured artist posts via Substack) and print (annual edition, Year 2). Content is created entirely outside the platform — the editorial team writes and designs in Canva and publishes to Substack. The platform's job is to surface that content in the app and link it to the relevant artist profiles.

One artist per week, approached by the editorial team. Being featured is an accolade, not a self-submission. The platform never provides a self-publish interface for artists.

---

## 1. Content Creation (External)

| Stream | Tool | Managed by |
|--------|------|------------|
| Digital posts | Substack | Editorial team |
| Design assets | Canva | Editorial team |
| Print edition | Canva | Editorial team (Year 2) |

Nothing about content creation touches the platform. The platform only becomes relevant at the point of surfacing finished content.

---

## 2. Publishing to the App

When a post goes live on Substack, an editorial team member adds it to the platform via an admin screen:

1. Paste the Substack post URL
2. Platform fetches the content automatically (title, cover image, body text)
3. Team member links the post to the featured artist's platform profile
4. Publish — post appears immediately in the app's blog feed

No scheduling at launch — posts go live immediately on publish. Scheduling can be added later.

The editorial team uses the same admin area as the rest of the platform — no separate editorial role for now.

---

## 3. Content Split: Native vs Substack

| Content | Where it lives |
|---------|---------------|
| Weekly featured artist post (free) | Shown natively in the app |
| Paywalled archive / premium content | Link out to Substack |

Free posts are shown in full within the app — this is the content that drives artist profile views and festival discovery, so keeping people in the app matters here. Paywalled content links out cleanly to Substack, which handles subscriptions and payments for the magazine independently.

Substack also builds its own audience organically — people who find the Substack directly become aware of the platform. This is a benefit, not a problem.

---

## 4. Artist Profile Integration

When a post is published and linked to an artist, it appears on that artist's profile page — visible to anyone who views the profile in the app or browser. Being featured is surfaced as a notable moment in the artist's history on the platform.

---

## 5. Print Edition (Year 2)

Annual large-format print edition. Sold through the platform website, at festivals, and via independent art bookshops. £18–22/copy.

Design is handled externally (Canva). The platform needs an e-commerce or purchase flow for the print edition — this is deferred to Year 2 and will be specced separately.

---

## Key Constraints

- Content creation is always external — the platform never provides authoring tools for editorial content
- Artists cannot submit or self-publish content to the magazine or app feed under any circumstances
- Free weekly posts are shown natively in the app; paywalled content links to Substack
- Linking a post to an artist profile is a manual step — it is never automatic
- Print edition e-commerce is a Year 2 feature, not launch scope
