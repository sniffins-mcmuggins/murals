---
name: artist-preview-builder
description: >
  Build a private, unlisted "this could be yours" preview profile page for an artist you want to
  recruit onto Render, from their name + links + material you gather. Use whenever the user wants to
  "make a preview for [artist]", "build a prospect page", "do an artist a profile to pitch them",
  "create a private page to send to an artist", mentions cold outreach to artists, lead-gen previews,
  "show an artist what they could have", or wants a shareable hidden link to drive a signup. Produces
  a brand-styled HTML page plus seed-ready JSON so a "yes" converts into a real account in one step.
  Reach for this proactively when the conversation is about recruiting or pitching specific artists.
---

# Artist Preview Builder

The growth move: do the work *for* the artist, then show them what they could have. You assemble a
polished, on-brand Render profile from their existing public work, host it at an unguessable URL, and
send it directly to them. It's flattering, it collapses the imagination gap, and it converts — the
page stays unlisted until they claim it (sign up, pay, or you gift them N months).

This skill is a **guided intake + assembly workflow**, not a scraper. You gather the raw material
(the operator knows where to look); the skill writes the bio in Render's voice, structures the work
into collections, and emits two artifacts:

1. **`preview.html`** — an unlisted, `noindex`, brand-styled page. The thing you send.
2. **`seed.json`** — DB-shaped data (`artist_profiles` / `collections` / `collection_images`) so
   converting a "yes" into a real account is one step, not a rebuild.

## Why no scraping

We deliberately don't auto-scrape Instagram or socials: it's login-walled, against their ToS, returns
compression-degraded images, and carries legal weight for cold outreach to people who haven't opted in.
The artist's **best, highest-res work lives on their portfolio site / Behance**, not their feed. So the
backbone is material the operator gathers from public pages, optionally sped up by fetching clean
portfolio URLs. The *consented* Instagram Graph API import is a proper post-signup feature for later —
not this.

## The workflow

### Step 1 — Collect the intake

You need the fields below. **Ask the operator for whatever isn't already provided**, and tell them
where each is usually found (full guidance in `references/intake-checklist.md`). Don't stall on a
perfect set — a name, a hero image, one collection, and a bio is enough for a compelling first draft;
note what's thin and offer to enrich later.

If the operator gives you the artist's **own website**, use both tools, for different jobs:

- **`scripts/fetch_site_images.py <url>`** — harvests real, high-res image URLs from the page HTML
  (`<img>`, `srcset`, lazy-load `data-src`, `og:image`, CSS backgrounds), filters out logos/icons/
  thumbnails, and ranks by size. WebFetch *summarises* a page and misses most images; this lists them.
  Add `--crawl --max-pages 8` to follow same-domain gallery/work pages, and `--probe` to rank by real
  byte size. Review the candidates and pick the strongest for `hero_image` and the collection images.
- **WebFetch the same URL** — to *read* the bio, voice, location, social links, and any press/festival
  facts. Treat the fetched bio as raw material to rewrite, not gospel.

This only applies to the artist's *own* public site — it's not a social scraper. If a site renders
images purely via JavaScript, the harvester finds nothing; fall back to manual paste.

Then show the operator what you pulled and ask only for the gaps.

The minimum that makes a page worth sending:
- **name** + a one-line **tagline** (what they make, where)
- **hero image** — their single most striking piece (full-bleed background)
- **bio** — even a rough paragraph; you'll rewrite it
- **at least one collection** — a named group of 3+ image URLs
- **social links** — at minimum the one you'll point them at

### Step 2 — Write the bio in Render's voice

Render's voice is warm, editorial, art-forward — it treats the artist as someone with a career worth
taking seriously. Anchor on their *real* words and facts (don't invent shows, clients, or awards), but
lift the register: lead with what's distinctive about the work, ground it in place and medium, keep it
tight (2–4 short paragraphs). If their existing bio is strong, edit lightly rather than rewrite. Never
fabricate biographical claims — this page goes *to the artist*, who will spot anything untrue instantly
and lose trust.

### Step 3 — Assemble the data file

Write the collected material into a JSON file matching the shape in
`references/intake-checklist.md` (filled example: `assets/example-data.json`). Group work into
**collections** the way the artist would — by series, medium, or location (e.g. "Street Murals",
"Studio Work", "Commissions"). Order images strongest-first within each.

Set `claim_url` to wherever the artist should land to sign up (a Render signup URL, optionally with a
referral/gift code). Leave it `#` if not known yet and flag that to the operator.

### Step 4 — Build the artifacts

Run the bundled script (it downloads the images locally by default so the bundle is portable and won't
break if a source goes offline):

```bash
uv run .claude/skills/artist-preview-builder/scripts/build_preview.py \
  --data <path/to/artist.json> \
  --out  previews/<artist-slug>
```

Writes `previews/<artist-slug>/preview.html`, `seed.json`, and an `images/` folder. Open the HTML to
review it before sending. Use `--no-download` only if you deliberately want to hotlink remote images.

### Step 5 — Hand it back to the operator

Report:
- the **path to `preview.html`** (offer to open it / screenshot it for a quick look)
- **how to host it unlisted** — see "Hosting" below; the URL must be unguessable and `noindex`
- a **drafted outreach message** to send with the link (see "Outreach" below)
- anything that came out **thin** (missing collections, weak hero, no stats) and what would strengthen it
- a note that **`seed.json` is the bridge to a real account** when they say yes (see "Conversion")

## Hosting (keep it unlisted)

The page is `noindex, nofollow` and the banner says "not yet public" — but it's still a real URL, so
treat the link as the only secret. Host the `previews/<slug>/` folder as static files at an
**unguessable path** (a random slug, not the artist's name). Any static host works (an S3/CDN prefix, a
throwaway static host). Don't link to it from anywhere public, don't put it in a sitemap, and make it
trivially takedownable — if the artist ever asks, you can pull it instantly. This is their own work
shown back to them; respect that.

## Outreach

Draft a short, warm, non-salesy message that makes clear you *built this for them* and it's private.
Something like:

> Hi [name] — I run Render, a new platform for mural artists. I loved your work so I went ahead and
> built you a profile to show what it could look like: [link]. It's private, just for you. If you like
> it, you can claim it in a couple of clicks — happy to give you the first few months on us. No
> pressure either way, and I'll take it down any time you ask.

Adapt to the operator's relationship with the artist. The "I'll take it down any time" line matters —
it signals respect and lowers the threat of an unsolicited page.

## Conversion: turning a "yes" into a real account

`seed.json` mirrors the DB tables but keeps images as `source_url` (they aren't in S3 yet). When the
artist claims their page, the conversion is:

1. Create their `users` row (signup) and an `artist_profiles` row from `seed.json`'s `artist_profile`.
2. For each collection, create the `collections` row, then for each image **download `source_url` and
   run it through the `/images/presign` → PUT → confirm flow** to get a real `s3_key` + `cdn_url`
   before inserting `collection_images`. The seed deliberately does *not* fake S3 keys.
3. Apply the gift/comp (the "free first N months") via whatever billing/promo path is in use, so the
   profile flips to publicly visible.

> Note: the platform doesn't yet have a hidden-prospect profile state or a gift-months visibility gate
> — today the preview lives *outside* the app as a static page, and conversion seeds a fresh real
> account. If/when a real "draft profile + preview token + comp" path is built into the platform, this
> skill's `seed.json` is already the right shape to feed it.

## What good looks like

- The hero image stops you scrolling; the name is unmistakable.
- The bio reads like a real editorial profile, not SEO filler, and every fact in it is true.
- Collections are coherent groupings, strongest work first, no broken images.
- It's obvious within five seconds that this is *their* page and it's nearly live.
- The operator can send the link with a one-line message and nothing feels scraped or spammy.
